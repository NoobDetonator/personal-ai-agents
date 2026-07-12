import type { ModelMessage } from 'ai';
import { getConfig } from '../config/loader.js';
import { getAgent } from '../agents/registry.js';
import { loadConversationById } from '../db/conversation-helpers.js';
import {
  createRun,
  appendRunEvent,
  finishRun,
  setRunStatus,
  getRun,
  type RunStatus,
} from '../db/run-helpers.js';
import {
  getConversationContext,
  saveRunMessage,
} from '../projects/conversation-service.js';
import { buildProjectContext } from '../projects/service.js';
import { runWithProjectContext } from '../projects/context.js';
import { emitBus } from '../web/bus.js';

// ChatRunService: orquestra um turno de chat como um Run, independente da CLI
// (sem readline nem renderer de terminal). Persiste run_events para retomada e
// emite no bus para o streaming SSE. Ver docs/adr/0003.

export interface TurnHandlers {
  onTextDelta: (text: string) => void;
  onToolCall: (toolName: string) => void;
}

export interface TurnOutcome {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  toolCallCount: number;
  finishReason: string;
}

export type TurnExecutor = (args: {
  agentId: string;
  messages: ModelMessage[];
  handlers: TurnHandlers;
  abortSignal: AbortSignal;
}) => Promise<TurnOutcome>;

export interface StartChatRunInput {
  conversationId: string;
  text: string;
  /** Executor do turno (injetável em testes). Padrão: o agente real. */
  executor?: TurnExecutor;
  /** Timeout do turno em ms. Padrão: delegation.timeoutSec. */
  timeoutMs?: number;
}

export interface StartChatRunResult {
  runId: string;
  /** Resolve quando o run termina (útil para testes e encerramento gracioso). */
  done: Promise<RunStatus | null>;
}

const activeRuns = new Map<string, AbortController>();

/** Executor padrão: usa o agente registrado e seu streaming. */
const defaultExecutor: TurnExecutor = async ({ agentId, messages, handlers, abortSignal }) => {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agente não encontrado: ${agentId}`);
  return agent.chatStream(
    messages,
    { onTextDelta: handlers.onTextDelta, onToolCall: handlers.onToolCall },
    { abortSignal },
  );
};

let executorOverride: TurnExecutor | null = null;

/**
 * Substitui o executor padrão do turno (usado por previews/dev sem LLM). Em
 * produção nunca é chamado — o executor real (agente) permanece o padrão.
 */
export function setChatExecutorOverride(fn: TurnExecutor | null): void {
  executorOverride = fn;
}

/**
 * Inicia um turno de chat: cria o run, persiste a mensagem do usuário e dispara
 * a execução assíncrona. Retorna imediatamente com o runId; o streaming continua
 * pelo bus/SSE e os eventos ficam persistidos em run_events.
 */
export function startChatRun(input: StartChatRunInput): StartChatRunResult {
  const ctx = getConversationContext(input.conversationId);
  if (!ctx) {
    throw new Error(`Conversa não encontrada: ${input.conversationId}`);
  }

  const runId = createRun({
    projectId: ctx.projectId,
    conversationId: input.conversationId,
    agentId: ctx.agentId,
    kind: 'chat',
  });

  saveRunMessage({
    conversationId: input.conversationId,
    role: 'user',
    content: input.text,
    agentId: null,
    runId,
    status: 'complete',
  });
  appendRunEvent(runId, 'status', { status: 'running' });
  emitBus('stream_start', {
    agentId: ctx.agentId,
    projectId: ctx.projectId,
    conversationId: input.conversationId,
    runId,
  });

  const executor = input.executor ?? executorOverride ?? defaultExecutor;
  const timeoutMs = input.timeoutMs ?? getConfig().delegation.timeoutSec * 1000;
  const done = executeRun(runId, ctx.projectId, ctx.agentId, input.conversationId, executor, timeoutMs);
  return { runId, done };
}

async function executeRun(
  runId: string,
  projectId: string,
  agentId: string,
  conversationId: string,
  executor: TurnExecutor,
  timeoutMs: number,
): Promise<RunStatus | null> {
  const controller = new AbortController();
  activeRuns.set(runId, controller);

  const startedAt = Date.now();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const projectCtx = buildProjectContext(projectId, { conversationId, runId });
    const maxHistory = getConfig().display.maxHistoryMessages;
    const messages = loadConversationById(conversationId, maxHistory);

    const handlers: TurnHandlers = {
      onTextDelta: (text) => {
        const seq = appendRunEvent(runId, 'text_delta', { text });
        emitBus('stream_delta', { agentId, text, projectId, conversationId, runId, seq });
      },
      onToolCall: (toolName) => {
        const seq = appendRunEvent(runId, 'tool_start', { tool: toolName });
        emitBus('tool_call', { agentId, toolName, projectId, conversationId, runId, seq });
      },
    };

    const outcome = await runWithProjectContext(projectCtx, () =>
      executor({ agentId, messages, handlers, abortSignal: controller.signal }),
    );

    saveRunMessage({
      conversationId,
      role: 'assistant',
      content: outcome.text,
      agentId,
      runId,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
      status: 'complete',
    });

    const status = finishRun(runId, {
      status: 'done',
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
      cachedTokens: outcome.cachedInputTokens,
      durationMs: Date.now() - startedAt,
    });
    emitBus('stream_end', { agentId, text: outcome.text, projectId, conversationId, runId });
    return status;
  } catch (error) {
    const aborted = controller.signal.aborted;
    const status: RunStatus = aborted ? (timedOut ? 'timed_out' : 'cancelled') : 'failed';
    const message = error instanceof Error ? error.message : String(error);
    appendRunEvent(runId, 'error', { message, status });
    const final = finishRun(runId, {
      status,
      errorCode: status,
      errorMessage: message,
      durationMs: Date.now() - startedAt,
    });
    emitBus('error', { text: message, agentId, projectId, conversationId, runId });
    return final;
  } finally {
    clearTimeout(timer);
    activeRuns.delete(runId);
  }
}

/**
 * Cancela um run em andamento. Retorna false se o run não está ativo (já
 * terminou ou não existe). O status final vira 'cancelled'.
 */
export function cancelRun(runId: string): boolean {
  const controller = activeRuns.get(runId);
  if (!controller) return false;
  controller.abort();
  return true;
}

/** Marca um run como aguardando confirmação (best-effort; ignora se terminal). */
export function markRunWaitingConfirmation(runId: string): void {
  const run = getRun(runId);
  if (run && run.status === 'running') {
    setRunStatus(runId, 'waiting_confirmation');
    appendRunEvent(runId, 'confirmation', { status: 'waiting' });
  }
}

export function isRunActive(runId: string): boolean {
  return activeRuns.has(runId);
}
