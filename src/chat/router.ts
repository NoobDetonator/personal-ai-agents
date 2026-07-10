import type { ChatContext } from './cli.js';
import { looksFabricated, looksUnfinished, ANTI_FABRICATION_RETRY_HINT, CONTINUE_HINT } from '../agents/agent.js';
import { findCommand } from './commands.js';
import * as renderer from './renderer.js';
import { processGroupMessage } from './group-chat.js';
import { getConfig } from '../config/loader.js';
import { saveDirectMessage, getOrCreateConversation } from '../db/conversation-helpers.js';
import { compressHistory } from './history-compressor.js';

// Memory nudge: every N user messages, remind the agent to persist learnings
let messagesSinceNudge = 0;

const NUDGE_HINT =
  '[Lembrete de memoria] Antes de responder, reflita sobre a conversa recente: se surgiram fatos importantes sobre o usuario, salve com saveMemory; se aconteceu algo relevante hoje, registre com appendDailyNote; se voce dominou um processo repetivel, crie/melhore uma skill. Depois responda normalmente.';

const ONBOARDING_HINT =
  '[Onboarding em andamento] Voce ainda esta conhecendo o usuario. Conduza uma entrevista LEVE (1-2 perguntas por vez, sem interrogatorio): como ele quer ser chamado, trabalho/funcoes, gostos/interesses, e como prefere que as coisas sejam feitas (tom, nivel de detalhe, autonomia). Registre cada descoberta com updateUserProfile na secao certa. Quando tiver o essencial — ou se o usuario quiser pular — chame finishOnboarding e siga a conversa normalmente.';

export async function route(input: string, ctx: ChatContext): Promise<void> {
  const trimmed = input.trim();
  if (!trimmed) return;

  // "/" alone = quick menu: current model + numbered model list
  if (trimmed === '/') {
    const config = getConfig();
    renderer.renderSystemMessage(
      `Agente: ${ctx.activeAgent.name} | Modelo: ${config.ai.model} (${config.ai.provider})`
    );
    const modelo = findCommand('/modelo');
    if (modelo) {
      await modelo.command.execute([], ctx);
    }
    renderer.renderSystemMessage('Troque de modelo com /<numero> (ex: /2). Todos os comandos: /ajuda');
    return;
  }

  // "/<numero>" = shorthand for /modelo <numero>
  const modelShorthand = trimmed.match(/^\/(\d+)$/);
  if (modelShorthand) {
    const modelo = findCommand('/modelo');
    if (modelo) {
      await modelo.command.execute([modelShorthand[1]], ctx);
    }
    return;
  }

  // Check if it's a command
  if (trimmed.startsWith('/')) {
    const result = findCommand(trimmed);
    if (result) {
      await result.command.execute(result.args, ctx);
      return;
    }
    renderer.renderError(`Comando desconhecido: ${trimmed.split(' ')[0]}. Digite /ajuda para ver os comandos.`);
    return;
  }

  // Group chat mode
  if (ctx.groupChat) {
    await processGroupMessage(trimmed, ctx);
    return;
  }

  // Regular chat with active agent
  const config = getConfig();

  // Add user message to history
  ctx.messageHistory.push({ role: 'user' as const, content: trimmed });

  // Compress history when exceeding max messages
  const maxMessages = config.display.maxHistoryMessages;
  if (ctx.messageHistory.length > maxMessages) {
    ctx.messageHistory = await compressHistory(ctx.messageHistory, ctx.activeAgent);
  }

  // Transient system hints (not persisted in history)
  const hints: string[] = [];

  // Recall seletivo de memorias profundas (side-query barata, fail-open)
  if (config.memory.recall) {
    const { recallRelevantMemories } = await import('../agents/recall.js');
    const recalled = await recallRelevantMemories(ctx.activeAgent.id, trimmed);
    if (recalled) {
      renderer.renderSystemMessage('(memorias relevantes recuperadas)');
      hints.push(recalled);
    }
  }

  // Onboarding interview (until the principal calls finishOnboarding)
  if (!config.user.onboarded && ctx.activeAgent.id === config.defaultAgent) {
    hints.push(ONBOARDING_HINT);
  }

  // Periodic memory nudge (+ lembrete de limpar temporarios ociosos)
  messagesSinceNudge++;
  if (config.memory.nudgeEvery > 0 && messagesSinceNudge >= config.memory.nudgeEvery) {
    let nudge = NUDGE_HINT;
    const { listTemporaries } = await import('../agents/gc.js');
    const idleTemps = listTemporaries().filter(t => !t.busy);
    if (idleTemps.length > 0) {
      nudge += `\nAlem disso: ha agentes temporarios ociosos (${idleTemps.map(t => t.id).join(', ')}). Se o trabalho deles ja terminou, delete-os com deleteAgent.`;
    }
    hints.push(nudge);
    messagesSinceNudge = 0;
  }

  const systemHint = hints.length > 0 ? hints.join('\n\n') : undefined;

  try {
    const streamHandlers = {
      onTextDelta: (text: string) => renderer.renderStreamChunk(text),
      onToolCall: (toolName: string) => renderer.renderStreamToolCall(toolName, config.display.showToolCalls),
    };

    renderer.renderStreamStart(ctx.activeAgent.id, ctx.activeAgent.name);
    let result = await ctx.activeAgent.chatStream(ctx.messageHistory, streamHandlers, { systemHint });
    renderer.renderStreamEnd();

    // Auto-continuacao: turno cortado no meio do trabalho (limite de passos/
    // tokens) ou terminado com promessa nao cumprida → continua (max 2x)
    let continuations = 0;
    while (looksUnfinished(result.text, result.finishReason) && continuations < 2) {
      continuations++;
      renderer.renderSystemMessage('(turno interrompido no meio do trabalho — continuando automaticamente...)');

      if (!ctx.conversationId) {
        ctx.conversationId = getOrCreateConversation(ctx.activeAgent.id);
      }
      ctx.messageHistory.push({ role: 'assistant' as const, content: result.text });
      ctx.messageHistory.push({ role: 'user' as const, content: CONTINUE_HINT });
      saveDirectMessage(ctx.conversationId, 'assistant', result.text, ctx.activeAgent.id, result.inputTokens, result.outputTokens);
      saveDirectMessage(ctx.conversationId, 'user', CONTINUE_HINT, null);

      renderer.renderStreamStart(ctx.activeAgent.id, ctx.activeAgent.name);
      result = await ctx.activeAgent.chatStream(ctx.messageHistory, streamHandlers, { systemHint });
      renderer.renderStreamEnd();
    }

    // Anti-fabricacao: alegou execucao sem chamar nenhuma ferramenta →
    // descarta a resposta e refaz o turno uma unica vez, com correcao
    if (looksFabricated(result.text, result.toolCallCount)) {
      renderer.renderSystemMessage('(anti-fabricacao: a resposta alegou execucao sem usar ferramentas — refazendo o turno)');
      renderer.renderStreamStart(ctx.activeAgent.id, ctx.activeAgent.name);
      result = await ctx.activeAgent.chatStream(ctx.messageHistory, streamHandlers, {
        systemHint: [systemHint, ANTI_FABRICATION_RETRY_HINT].filter(Boolean).join('\n\n'),
      });
      renderer.renderStreamEnd();

      // Fabricou de novo: nunca entregar alegacao falsa — registra a verdade
      // no historico (quebra o ciclo de imitacao nas proximas conversas)
      if (looksFabricated(result.text, result.toolCallCount)) {
        renderer.renderError('O agente alegou execucao sem chamar ferramentas duas vezes. Resposta descartada — NADA foi executado.');
        result = {
          ...result,
          text:
            '[Aviso do sistema] Minha resposta anterior foi descartada: eu aleguei ter executado uma acao sem realmente chamar a ferramenta. NADA foi executado. Por favor, repita o pedido para que eu execute de verdade.',
        };
      }
    }

    // Add assistant response to history
    ctx.messageHistory.push({ role: 'assistant' as const, content: result.text });

    // Persist to DB
    if (!ctx.conversationId) {
      ctx.conversationId = getOrCreateConversation(ctx.activeAgent.id);
    }
    saveDirectMessage(ctx.conversationId, 'user', trimmed, null);
    saveDirectMessage(ctx.conversationId, 'assistant', result.text, ctx.activeAgent.id, result.inputTokens, result.outputTokens);

    if (config.display.showTokenUsage) {
      renderer.renderTokenUsage(result.inputTokens, result.outputTokens, result.cachedInputTokens);
    }
  } catch (error) {
    renderer.renderStreamEnd();
    const errMsg = error instanceof Error ? error.message : 'Erro desconhecido';
    renderer.renderError(`Falha ao comunicar com ${ctx.activeAgent.name}: ${errMsg}`);

    // Remove the failed user message from history
    ctx.messageHistory.pop();
  }
}
