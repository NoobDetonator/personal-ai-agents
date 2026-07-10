import readline from 'node:readline';
import type { ModelMessage } from 'ai';
import type { Agent } from '../agents/agent.js';
import type { GroupChat } from './group-chat.js';
import { route } from './router.js';
import { commands, findCommand } from './commands.js';
import { getAvailableModels } from '../config/models.js';
import { listSkillMetas } from '../skills/loader.js';
import { renderWelcome, getPromptString, renderSystemMessage } from './renderer.js';
import { buildToolSet } from '../tools/index.js';
import { dispatchMessage } from '../comms/dispatcher.js';
import * as registry from '../agents/registry.js';
import { loadLastConversation, getOrCreateConversation, listConversations } from '../db/conversation-helpers.js';
import { registerReadline, setAtMainPrompt } from './confirm.js';

export interface ChatContext {
  activeAgent: Agent;
  messageHistory: ModelMessage[];
  groupChat: GroupChat | null;
  shouldExit: boolean;
  buildToolsForAgent: (agent: Agent) => void;
  conversationId: string | null;
}

/** Tab completion: command names, then context-aware arguments. */
function completer(line: string): [string[], string] {
  if (!line.startsWith('/')) return [[], line];

  const parts = line.split(/\s+/);

  // Completing the command itself
  if (parts.length <= 1) {
    const names = commands.map(c => c.name);
    const hits = names.filter(n => n.startsWith(line));
    return [hits.length > 0 ? hits : names, line];
  }

  // Completing an argument
  const found = findCommand(parts[0]);
  if (!found) return [[], line];

  const prefix = parts[parts.length - 1];
  let candidates: string[] = [];

  switch (found.command.name) {
    case '/agente':
    case '/deletar':
    case '/grupo':
      candidates = registry.listAgentIds();
      break;
    case '/skill':
      candidates = listSkillMetas().map(s => s.id);
      break;
    case '/modelo':
      candidates = getAvailableModels().map(m => m.id);
      break;
    case '/retomar':
    case '/fork': {
      // Completa com ids de conversas de todos os agentes registrados
      candidates = registry.listAgentIds()
        .flatMap(id => listConversations(id, 10))
        .map(c => c.id.slice(0, 8));
      break;
    }
    default:
      return [[], line];
  }

  const hits = candidates.filter(c => c.startsWith(prefix));
  return [hits.length > 0 ? hits : candidates, prefix];
}

function buildToolsForAgent(agent: Agent): void {
  const tools = buildToolSet(agent.id, dispatchMessage, (newAgent) => {
    buildToolsForAgent(newAgent);
  });
  agent.setTools(tools);
}

export function initAllAgentTools(): void {
  for (const agent of registry.listAgents()) {
    buildToolsForAgent(agent);
  }
}

export async function startCli(): Promise<void> {
  const config = (await import('../config/loader.js')).getConfig();

  const defaultAgent = registry.getAgent(config.defaultAgent) ?? registry.listAgents()[0];
  if (!defaultAgent) {
    console.error('Nenhum agente encontrado. Algo deu errado na inicializacao.');
    process.exit(1);
  }

  const { conversationId, messages } = loadLastConversation(
    defaultAgent.id,
    config.display.maxHistoryMessages
  );

  const ctx: ChatContext = {
    activeAgent: defaultAgent,
    messageHistory: messages,
    groupChat: null,
    shouldExit: false,
    buildToolsForAgent,
    conversationId: conversationId ?? getOrCreateConversation(defaultAgent.id),
  };

  renderWelcome(defaultAgent.name);

  if (messages.length > 0) {
    renderSystemMessage(`Conversa anterior restaurada (${messages.length} mensagens)`);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer,
  });

  registerReadline(rl);

  // First contact: the principal introduces herself and interviews the user
  if (!config.user.onboarded) {
    renderSystemMessage(`Primeiro contato — ${defaultAgent.name} vai se apresentar e te conhecer melhor.`);
    await route(
      '[Sistema] Este e o primeiro contato com o usuario. Apresente-se brevemente como a assistente principal ' +
      '(que tambem pode montar times de agentes para ele) e comece a entrevista de onboarding de forma leve e natural.',
      ctx
    );
  }

  let rlClosed = false;

  const promptLoop = (): void => {
    // stdin may have closed (EOF/Ctrl+D) while an agent turn was in flight
    if (rlClosed) return;

    if (ctx.shouldExit) {
      rl.close();
      return;
    }

    const prompt = getPromptString(ctx.activeAgent.name, ctx.groupChat !== null);

    setAtMainPrompt(true);
    rl.question(prompt, async (input) => {
      setAtMainPrompt(false);

      if (input === null || input === undefined) {
        ctx.shouldExit = true;
        rl.close();
        return;
      }

      await route(input, ctx);

      if (ctx.shouldExit && !rlClosed) {
        rl.close();
        return;
      }

      promptLoop();
    });
  };

  // Resolve only when the CLI actually closes — otherwise main() would run
  // its cleanup (closing the DB, scheduler and watchers) right after startup
  await new Promise<void>((resolve) => {
    rl.on('close', () => {
      rlClosed = true;
      registerReadline(null);
      console.log('\n  Ate mais! 👋\n');
      resolve();
    });

    promptLoop();
  });
}
