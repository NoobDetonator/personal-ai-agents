import type { ModelMessage } from 'ai';
import type { Agent } from '../agents/agent.js';
import type { ChatContext } from './cli.js';
import * as renderer from './renderer.js';
import { getConfig } from '../config/loader.js';
import { getDb } from '../db/connection.js';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// --- Types ---

export interface GroupMessage {
  agentId: string | null;
  agentName: string | null;
  role: 'user' | 'agent';
  content: string;
  timestamp: Date;
  round: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface GroupChatConfig {
  maxRounds: number;
  convergenceThreshold: number;
  enableSessionFile: boolean;
}

export interface GroupChat {
  id: string;
  participants: Agent[];
  messageHistory: GroupMessage[];
  sessionFilePath: string;
  roundNumber: number;
  config: GroupChatConfig;
}

// Only one group discussion can run at a time (prevents nested tool loops)
let groupRunning = false;

// --- Hierarchy helpers ---

function rankOf(agentId: string): number {
  const role = getConfig().agents[agentId]?.role ?? 'worker';
  return role === 'principal' ? 2 : role === 'manager' ? 1 : 0;
}

function roleLabel(agentId: string): string {
  const role = getConfig().agents[agentId]?.role ?? 'worker';
  return role === 'principal' ? 'principal (lidera)' : role === 'manager' ? 'manager' : 'worker';
}

/** Workers speak first (rotating among peers for variety); highest rank closes the round. */
function speakingOrder(participants: Agent[], round: number): Agent[] {
  const byRank = new Map<number, Agent[]>();
  for (const a of participants) {
    const r = rankOf(a.id);
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r)!.push(a);
  }

  const ordered: Agent[] = [];
  for (const rank of Array.from(byRank.keys()).sort((a, b) => a - b)) {
    const peers = byRank.get(rank)!;
    const shift = round % peers.length;
    ordered.push(...peers.slice(shift), ...peers.slice(0, shift));
  }
  return ordered;
}

function highestRanked(participants: Agent[]): Agent {
  return [...participants].sort((a, b) => rankOf(b.id) - rankOf(a.id))[0];
}

// --- Lifecycle (interactive /grupo mode) ---

export function createGroup(agents: Agent[]): GroupChat {
  const config = getConfig();
  const id = randomUUID();
  const sessionFilePath = path.join(process.cwd(), 'data', 'group-sessions', `${id.slice(0, 8)}.md`);

  const group: GroupChat = {
    id,
    participants: agents,
    messageHistory: [],
    sessionFilePath,
    roundNumber: 0,
    config: {
      maxRounds: config.groupChat.maxRounds,
      convergenceThreshold: config.groupChat.convergenceThreshold,
      enableSessionFile: config.groupChat.enableSessionFile,
    },
  };

  persistNewGroupConversation(id, agents);

  if (group.config.enableSessionFile) {
    writeSessionFile(group);
  }

  return group;
}

export function startGroupChat(ctx: ChatContext, agents: Agent[]): void {
  ctx.groupChat = createGroup(agents);
  renderer.renderGroupHeader(agents.map(a => a.name));
  renderer.renderSystemMessage(`Rodadas por turno: ${ctx.groupChat.config.maxRounds} | Use /rodadas <N> para ajustar`);
}

export function stopGroupChat(ctx: ChatContext): void {
  if (!ctx.groupChat) {
    renderer.renderSystemMessage('Voce nao esta em um chat de grupo.');
    return;
  }

  if (ctx.groupChat.config.enableSessionFile && fs.existsSync(ctx.groupChat.sessionFilePath)) {
    renderer.renderSystemMessage(`Historico salvo em: ${ctx.groupChat.sessionFilePath}`);
  }

  ctx.groupChat = null;
  renderer.renderSuccess(`Voltando ao chat individual com ${ctx.activeAgent.name}.`);
}

// --- Main engine (shared by interactive mode and the startGroupDiscussion tool) ---

export async function processGroupMessage(input: string, ctx: ChatContext): Promise<void> {
  if (!ctx.groupChat) return;
  await runGroupTurn(ctx.groupChat, input);
}

export async function runGroupTurn(groupChat: GroupChat, input: string): Promise<{ synthesis: string | null }> {
  if (groupRunning) {
    renderer.renderError('Ja existe uma discussao em grupo em andamento.');
    return { synthesis: null };
  }
  groupRunning = true;

  try {
    const config = getConfig();
    const { participants, config: groupConfig } = groupChat;

    const userMsg: GroupMessage = {
      agentId: null,
      agentName: null,
      role: 'user',
      content: input,
      timestamp: new Date(),
      round: 0,
    };
    groupChat.messageHistory.push(userMsg);
    persistMessage(groupChat.id, userMsg);

    for (let round = 0; round < groupConfig.maxRounds; round++) {
      groupChat.roundNumber = round;

      if (round > 0) {
        renderer.renderRoundSeparator(round, groupConfig.maxRounds);
      }

      const roundResponses: GroupMessage[] = [];
      const orderedAgents = speakingOrder(participants, round);

      for (const agent of orderedAgents) {
        const msg = await agentTurn(agent, groupChat, config.display.showToolCalls, config.display.showTokenUsage);
        if (msg) {
          roundResponses.push(msg);
        }
      }

      if (groupConfig.enableSessionFile) {
        writeSessionFile(groupChat);
      }

      if (round < groupConfig.maxRounds - 1) {
        if (!checkShouldContinue(roundResponses, groupConfig)) {
          renderer.renderSystemMessage(`(Conversa convergiu apos ${round + 1} rodada(s))`);
          break;
        }
      }
    }

    // Final synthesis by the highest-ranked participant
    let synthesis: string | null = null;
    const leader = highestRanked(participants);
    const agentResponses = groupChat.messageHistory.filter(m => m.role === 'agent');
    if (agentResponses.length > 1) {
      renderer.renderSystemMessage(`--- Sintese final (${leader.name}) ---`);
      const msg = await agentTurn(
        leader,
        groupChat,
        config.display.showToolCalls,
        config.display.showTokenUsage,
        '[Moderador]: A discussao encerrou. Como o membro de maior patente, sintetize em poucas linhas as conclusoes e decisoes acionaveis do grupo.'
      );
      synthesis = msg?.content ?? null;

      if (groupConfig.enableSessionFile) {
        writeSessionFile(groupChat);
      }
    } else if (agentResponses.length === 1) {
      synthesis = agentResponses[0].content;
    }

    return { synthesis };
  } finally {
    groupRunning = false;
  }
}

async function agentTurn(
  agent: Agent,
  groupChat: GroupChat,
  showToolCalls: boolean,
  showTokenUsage: boolean,
  extraInstruction?: string,
): Promise<GroupMessage | null> {
  try {
    const messagesForAgent = buildMessagesForAgent(agent, groupChat);
    if (extraInstruction) {
      messagesForAgent.push({ role: 'user' as const, content: extraInstruction });
    }

    renderer.renderStreamStart(agent.id, agent.name);
    const result = await agent.chatStream(messagesForAgent, {
      onTextDelta: (text) => renderer.renderStreamChunk(text),
      onToolCall: (toolName) => renderer.renderStreamToolCall(toolName, showToolCalls),
    });
    renderer.renderStreamEnd();

    const agentMsg: GroupMessage = {
      agentId: agent.id,
      agentName: agent.name,
      role: 'agent',
      content: result.text,
      timestamp: new Date(),
      round: groupChat.roundNumber,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };

    groupChat.messageHistory.push(agentMsg);
    persistMessage(groupChat.id, agentMsg);

    if (showTokenUsage) {
      renderer.renderTokenUsage(result.inputTokens, result.outputTokens, result.cachedInputTokens);
    }

    return agentMsg;
  } catch (error) {
    renderer.renderStreamEnd();
    renderer.renderError(`${agent.name} nao conseguiu responder: ${error instanceof Error ? error.message : 'erro'}`);
    return null;
  }
}

// --- Programmatic discussion (startGroupDiscussion tool) ---

export async function runGroupDiscussion(agents: Agent[], topic: string, rounds: number): Promise<string> {
  const group = createGroup(agents);
  group.config.maxRounds = Math.max(1, Math.min(3, rounds));

  renderer.renderGroupHeader(agents.map(a => a.name));
  const { synthesis } = await runGroupTurn(group, topic);

  if (group.config.enableSessionFile && fs.existsSync(group.sessionFilePath)) {
    renderer.renderSystemMessage(`Historico do grupo salvo em: ${group.sessionFilePath}`);
  }

  return synthesis ?? '(A discussao nao produziu respostas.)';
}

export function isGroupRunning(): boolean {
  return groupRunning;
}

// --- Context Builder (Critical for quality) ---

function buildMessagesForAgent(agent: Agent, groupChat: GroupChat): ModelMessage[] {
  const others = groupChat.participants.filter(a => a.id !== agent.id);

  const messages: ModelMessage[] = [];

  const rolesLine = groupChat.participants
    .map(a => `${a.name} — ${roleLabel(a.id)}`)
    .join('; ');

  const contextLines = [
    `[Contexto do grupo]`,
    `Voce esta em uma conversa em grupo com: ${others.map(a => a.name).join(', ')} e o usuario.`,
    `Papeis e hierarquia: ${rolesLine}.`,
    `Regras:`,
    `- Mantenha sua personalidade unica`,
    `- Pode concordar, discordar ou complementar os outros — cite nomes`,
    `- Respeite a hierarquia: a palavra final e de quem esta acima; se um superior pedir algo, atenda`,
    `- Seja conciso mas substantivo - evite respostas longas demais`,
    `- Quando achar que a conversa ja foi bem explorada, responda brevemente`,
    `- Nao repita o que outros ja disseram`,
  ];

  if (rankOf(agent.id) === Math.max(...groupChat.participants.map(p => rankOf(p.id)))) {
    contextLines.push(`- Voce e o membro de maior patente presente: conduza a discussao rumo a conclusoes uteis`);
  }

  if (groupChat.config.enableSessionFile) {
    contextLines.push(`- O historico completo esta em: ${groupChat.sessionFilePath}`);
  }

  messages.push({ role: 'user' as const, content: contextLines.join('\n') });
  messages.push({ role: 'assistant' as const, content: 'Entendido, estou no grupo.' });

  // Map conversation history with intelligent role assignment
  for (const msg of groupChat.messageHistory) {
    if (msg.role === 'user') {
      messages.push({
        role: 'user' as const,
        content: `[Usuario]: ${msg.content}`,
      });
    } else if (msg.agentId === agent.id) {
      messages.push({
        role: 'assistant' as const,
        content: msg.content,
      });
    } else {
      messages.push({
        role: 'user' as const,
        content: `[${msg.agentName}]: ${msg.content}`,
      });
    }
  }

  // Trim if history is too long
  const maxMessages = getConfig().display.maxHistoryMessages;
  if (messages.length > maxMessages + 2) {
    const contextPair = messages.slice(0, 2);
    const recentMessages = messages.slice(-(maxMessages));
    return [...contextPair, ...recentMessages];
  }

  return messages;
}

// --- Convergence Detection ---

function checkShouldContinue(roundResponses: GroupMessage[], config: GroupChatConfig): boolean {
  if (roundResponses.length === 0) return false;

  // Heuristic 1: All responses are very short → converging
  const allShort = roundResponses.every(r => r.content.length < config.convergenceThreshold);
  if (allShort) return false;

  // Heuristic 2: Agreement patterns in Portuguese
  const agreementPatterns = [
    /^(concordo|exato|isso|perfeito|com certeza|verdade|sim|pois e|realmente|exatamente|de acordo)/i,
    /^(nao tenho nada a adicionar|acho que cobrimos|e isso ai|resumindo|enfim)/i,
  ];
  const allAgree = roundResponses.every(r =>
    agreementPatterns.some(p => p.test(r.content.trim()))
  );
  if (allAgree) return false;

  return true;
}

// --- Session File ---

function writeSessionFile(groupChat: GroupChat): void {
  const dir = path.dirname(groupChat.sessionFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const lines: string[] = [
    `# Sessao de Grupo`,
    ``,
    `**ID:** ${groupChat.id.slice(0, 8)}`,
    `**Participantes:** ${groupChat.participants.map(a => a.name).join(', ')}`,
    `**Rodadas completadas:** ${groupChat.roundNumber + 1}`,
    `**Total de mensagens:** ${groupChat.messageHistory.length}`,
    ``,
    `---`,
    ``,
  ];

  const recentMessages = groupChat.messageHistory.slice(-30);
  if (groupChat.messageHistory.length > 30) {
    lines.push(`> Mostrando as ultimas 30 de ${groupChat.messageHistory.length} mensagens`);
    lines.push(``);
  }

  for (const msg of recentMessages) {
    const time = msg.timestamp.toLocaleTimeString('pt-BR');
    if (msg.role === 'user') {
      lines.push(`### [${time}] Usuario`);
    } else {
      lines.push(`### [${time}] ${msg.agentName} (rodada ${msg.round + 1})`);
    }
    lines.push(``);
    lines.push(msg.content);
    lines.push(``);
  }

  fs.writeFileSync(groupChat.sessionFilePath, lines.join('\n'), 'utf-8');
}

// --- DB Persistence ---

function persistNewGroupConversation(id: string, agents: Agent[]): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO conversations (id, agent_id, type, title) VALUES (?, ?, 'group', ?)`
    ).run(id, agents[0].id, `Grupo: ${agents.map(a => a.name).join(', ')}`);

    const insertParticipant = db.prepare(
      `INSERT INTO group_participants (conversation_id, agent_id) VALUES (?, ?)`
    );
    for (const agent of agents) {
      insertParticipant.run(id, agent.id);
    }
  } catch {
    // DB persistence is best-effort, don't break the chat
  }
}

function persistMessage(conversationId: string, msg: GroupMessage): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, agent_id, input_tokens, output_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      conversationId,
      msg.role === 'user' ? 'user' : 'assistant',
      msg.role === 'user' ? msg.content : `[${msg.agentName}]: ${msg.content}`,
      msg.agentId,
      msg.inputTokens ?? 0,
      msg.outputTokens ?? 0,
    );
  } catch {
    // DB persistence is best-effort
  }
}
