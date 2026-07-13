import type { ChatContext } from './cli.js';
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

  let recalledContext: string | undefined;
  // Recall seletivo de memorias profundas (side-query barata, fail-open)
  if (config.memory.recall) {
    const { recallRelevantMemories } = await import('../agents/recall.js');
    const recalled = await recallRelevantMemories(ctx.activeAgent.id, trimmed);
    if (recalled) {
      renderer.renderSystemMessage('(memorias relevantes recuperadas)');
      recalledContext = recalled;
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
    renderer.renderStreamStart(ctx.activeAgent.id, ctx.activeAgent.name);
    const result = await ctx.activeAgent.runGuardedTurn(
      ctx.messageHistory,
      {
        onTextDelta: (text) => renderer.renderStreamChunk(text),
        onToolCall: (toolName) => renderer.renderStreamToolCall(toolName, config.display.showToolCalls),
        onGuardRetry: (reason) => renderer.renderSystemMessage(
          reason === 'unfinished'
            ? '(turno interrompido - continuando automaticamente...)'
            : reason === 'missing_tool'
              ? '(execucao obrigatoria: nenhuma ferramenta relevante foi usada - refazendo...)'
              : '(anti-fabricacao: faltou evidencia real - refazendo o turno...)',
        ),
      },
      {
        systemHint,
        contextData: recalledContext,
      },
    );
    renderer.renderStreamEnd();

    ctx.messageHistory.push({ role: 'assistant' as const, content: result.text });

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
