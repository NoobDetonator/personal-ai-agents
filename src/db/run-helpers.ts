import { randomUUID } from 'node:crypto';
import { getDb } from './connection.js';

// Persistência de runs e run_events (ADR 0003). Um run é uma execução de
// mensagem/delegação/schedule/heartbeat; run_events reconstroem a timeline após
// refresh e permitem auditar tool calls.

export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting_confirmation'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export type RunKind = 'chat' | 'delegation' | 'schedule' | 'heartbeat';

export type RunEventType =
  | 'text_delta'
  | 'tool_start'
  | 'tool_result'
  | 'skill_activated'
  | 'agent_created'
  | 'delegation_start'
  | 'delegation_end'
  | 'confirmation'
  | 'status'
  | 'error';

/** Estados terminais: nunca transicionam para outro estado. */
const TERMINAL: ReadonlySet<RunStatus> = new Set(['done', 'failed', 'cancelled', 'timed_out']);

export function isTerminalStatus(status: RunStatus): boolean {
  return TERMINAL.has(status);
}

export interface Run {
  id: string;
  project_id: string;
  conversation_id: string | null;
  agent_id: string;
  parent_run_id: string | null;
  kind: RunKind;
  status: RunStatus;
  started_at: string | null;
  finished_at: string | null;
  error_code: string | null;
  error_message: string | null;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cost_usd: number | null;
  duration_ms: number | null;
  created_at: string;
}

export interface RunEvent {
  id: string;
  run_id: string;
  sequence: number;
  type: RunEventType;
  payload_json: string | null;
  created_at: string;
}

export interface CreateRunInput {
  projectId: string;
  conversationId?: string | null;
  agentId: string;
  kind?: RunKind;
  parentRunId?: string | null;
}

export function createRun(input: CreateRunInput): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO runs (id, project_id, conversation_id, agent_id, parent_run_id, kind, status, started_at)
     VALUES (?, ?, ?, ?, ?, ?, 'running', datetime('now'))`,
  ).run(
    id,
    input.projectId,
    input.conversationId ?? null,
    input.agentId,
    input.parentRunId ?? null,
    input.kind ?? 'chat',
  );
  return id;
}

export function getActiveRunForConversation(conversationId: string): Run | null {
  const row = getDb().prepare(
    `SELECT * FROM runs
     WHERE conversation_id = ? AND status IN ('queued', 'running', 'waiting_confirmation')
     ORDER BY created_at DESC, rowid DESC LIMIT 1`,
  ).get(conversationId) as Record<string, unknown> | undefined;
  return row ? (row as unknown as Run) : null;
}

export function createRunIfConversationIdle(input: CreateRunInput): string {
  const db = getDb();
  return db.transaction(() => {
    if (input.conversationId && getActiveRunForConversation(input.conversationId)) {
      throw new Error('RUN_ALREADY_ACTIVE');
    }
    return createRun(input);
  })();
}

/** Finaliza runs que ficaram ativos apos reinicio inesperado do processo. */
export function recoverInterruptedRuns(): number {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id FROM runs WHERE status IN ('queued', 'running', 'waiting_confirmation')`,
  ).all() as Array<{ id: string }>;
  for (const row of rows) {
    appendRunEvent(row.id, 'error', {
      status: 'failed',
      code: 'process_restarted',
      message: 'Execucao interrompida porque o processo foi reiniciado.',
    });
    finishRun(row.id, {
      status: 'failed',
      errorCode: 'process_restarted',
      errorMessage: 'Execucao interrompida porque o processo foi reiniciado.',
    });
  }
  return rows.length;
}

export function getRun(runId: string): Run | null {
  const row = getDb().prepare('SELECT * FROM runs WHERE id = ?').get(runId) as Record<string, unknown> | undefined;
  return row ? (row as unknown as Run) : null;
}

/** Run mais recente de uma conversa (para retomada). */
export function getLatestRunForConversation(conversationId: string): Run | null {
  const row = getDb().prepare(
    'SELECT * FROM runs WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
  ).get(conversationId) as Record<string, unknown> | undefined;
  return row ? (row as unknown as Run) : null;
}

/**
 * Anexa um evento ao run com número de sequência monotônico por run. A leitura
 * do próximo sequence e a inserção acontecem numa transação para evitar corrida.
 * Retorna o sequence atribuído.
 */
export function appendRunEvent(runId: string, type: RunEventType, payload?: unknown): number {
  const db = getDb();
  const append = db.transaction(() => {
    const row = db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM run_events WHERE run_id = ?')
      .get(runId) as { next: number };
    const seq = row.next;
    db.prepare(
      `INSERT INTO run_events (id, run_id, sequence, type, payload_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(randomUUID(), runId, seq, type, payload === undefined ? null : JSON.stringify(payload));
    return seq;
  });
  return append();
}

/** Eventos de um run com sequence > afterSeq, em ordem. Base da retomada. */
export function listRunEvents(runId: string, afterSeq = 0): RunEvent[] {
  return getDb().prepare(
    'SELECT * FROM run_events WHERE run_id = ? AND sequence > ? ORDER BY sequence ASC',
  ).all(runId, afterSeq) as RunEvent[];
}

/**
 * Atualiza o status de um run. Recusa transições a partir de um estado terminal
 * (um run failed/cancelled/timed_out nunca vira done). Retorna false se recusado.
 */
export function setRunStatus(runId: string, status: RunStatus): boolean {
  const db = getDb();
  const current = getRun(runId);
  if (!current) return false;
  if (isTerminalStatus(current.status)) return false;
  db.prepare('UPDATE runs SET status = ? WHERE id = ?').run(status, runId);
  return true;
}

export interface FinishRunInput {
  status: Extract<RunStatus, 'done' | 'failed' | 'cancelled' | 'timed_out'>;
  errorCode?: string;
  errorMessage?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  costUsd?: number | null;
  durationMs?: number | null;
}

/**
 * Encerra um run num estado terminal e registra um evento 'status'. Recusa se o
 * run já está terminal (idempotência do encerramento). Retorna o status final.
 */
export function finishRun(runId: string, input: FinishRunInput): RunStatus | null {
  const db = getDb();
  const current = getRun(runId);
  if (!current) return null;
  if (isTerminalStatus(current.status)) return current.status;

  db.prepare(
    `UPDATE runs SET status = ?, finished_at = datetime('now'),
       error_code = ?, error_message = ?,
       input_tokens = ?, output_tokens = ?, cached_tokens = ?,
       cost_usd = ?, duration_ms = ?
     WHERE id = ?`,
  ).run(
    input.status,
    input.errorCode ?? null,
    input.errorMessage ?? null,
    input.inputTokens ?? 0,
    input.outputTokens ?? 0,
    input.cachedTokens ?? 0,
    input.costUsd ?? null,
    input.durationMs ?? null,
    runId,
  );

  if (current.conversation_id) {
    db.prepare('UPDATE conversations SET last_run_status = ? WHERE id = ?')
      .run(input.status, current.conversation_id);
  }

  appendRunEvent(runId, 'status', { status: input.status, errorMessage: input.errorMessage ?? null });
  return input.status;
}
