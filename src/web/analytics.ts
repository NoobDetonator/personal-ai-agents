import type Database from 'better-sqlite3';

/**
 * Consultas de analytics do painel web. Recebe o banco e a lista de agentes
 * como parametros (sem estado global) para permitir teste unitario isolado.
 *
 * Fontes de dados:
 *  - messages: tokens historicos (existem desde o inicio do projeto)
 *  - usage_events: custo, cache e duracao por chamada (historico novo)
 *  - tasks: status, criacao e atualizacao
 */

export type AnalyticsRange = '24h' | '7d' | '30d';

export interface AnalyticsAgentInfo {
  id: string;
  name: string;
  team: string | null;
}

export interface AnalyticsFilters {
  range: AnalyticsRange;
  agent?: string;
  team?: string;
}

export interface KpiPair {
  current: number;
  previous: number;
}

export interface AnalyticsSeriesPoint {
  bucket: string;
  input: number;
  output: number;
  cost: number;
}

export interface AgentLoadRow {
  agentId: string;
  name: string;
  team: string | null;
  inputTokens: number;
  outputTokens: number;
  messages: number;
  tasksDone: number;
  tasksFailed: number;
  tasksActive: number;
}

export interface AnalyticsResult {
  range: AnalyticsRange;
  since: string;
  bucketUnit: 'hour' | 'day';
  kpis: {
    tokens: KpiPair;
    inputTokens: number;
    outputTokens: number;
    cost: KpiPair & { known: boolean };
    cacheRate: KpiPair;
    tasksDone: KpiPair;
    tasksFailed: KpiPair;
    successRate: KpiPair;
    activeAgents: KpiPair;
    tasksInProgress: number;
    tasksPending: number;
    avgCallMs: number | null;
  };
  series: AnalyticsSeriesPoint[];
  taskStatus: Record<string, number>;
  agentLoad: AgentLoadRow[];
}

export const ANALYTICS_RANGES: AnalyticsRange[] = ['24h', '7d', '30d'];

const RANGE_HOURS: Record<AnalyticsRange, number> = { '24h': 24, '7d': 168, '30d': 720 };

/** Formata um timestamp no formato que o SQLite grava com datetime('now') (UTC). */
function toSqliteUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

const pad = (n: number): string => String(n).padStart(2, '0');
const localDay = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localHour = (d: Date): string => `${localDay(d)} ${pad(d.getHours())}:00`;

/** Condicao SQL para restringir uma coluna de agente ao escopo do filtro. */
function agentCond(column: string, ids: string[] | null): { sql: string; params: string[] } {
  if (ids == null) return { sql: '', params: [] };
  if (ids.length === 0) return { sql: ' AND 1 = 0', params: [] };
  return { sql: ` AND ${column} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

/** Condicao SQL para o board de tarefas (por responsavel ou equipe). */
function taskCond(filters: AnalyticsFilters): { sql: string; params: string[] } {
  if (filters.agent) return { sql: ' AND assignee = ?', params: [filters.agent] };
  if (filters.team) return { sql: ' AND team = ?', params: [filters.team] };
  return { sql: '', params: [] };
}

function scopedAgentIds(agents: AnalyticsAgentInfo[], filters: AnalyticsFilters): string[] | null {
  if (filters.agent) return [filters.agent];
  if (filters.team) return agents.filter(a => a.team === filters.team).map(a => a.id);
  return null;
}

export function getAnalytics(
  db: Database.Database,
  agents: AnalyticsAgentInfo[],
  filters: AnalyticsFilters,
): AnalyticsResult {
  const hours = RANGE_HOURS[filters.range];
  const nowMs = Date.now();
  const since = toSqliteUtc(nowMs - hours * 3_600_000);
  const prevSince = toSqliteUtc(nowMs - 2 * hours * 3_600_000);
  const ids = scopedAgentIds(agents, filters);
  const msgCond = agentCond('agent_id', ids);
  const tCond = taskCond(filters);

  // --- Tokens (messages: unica fonte com historico completo) ---
  const tokenRow = db.prepare(
    `SELECT
       SUM(CASE WHEN created_at >= ? THEN input_tokens + output_tokens ELSE 0 END) AS cur,
       SUM(CASE WHEN created_at < ? THEN input_tokens + output_tokens ELSE 0 END) AS prev,
       SUM(CASE WHEN created_at >= ? THEN input_tokens ELSE 0 END) AS curIn,
       SUM(CASE WHEN created_at >= ? THEN output_tokens ELSE 0 END) AS curOut
     FROM messages WHERE created_at >= ?${msgCond.sql}`
  ).get(since, since, since, since, prevSince, ...msgCond.params) as
    { cur: number | null; prev: number | null; curIn: number | null; curOut: number | null };

  // --- Agentes ativos (emitiram mensagem no periodo) ---
  const activeRow = db.prepare(
    `SELECT
       COUNT(DISTINCT CASE WHEN created_at >= ? THEN agent_id END) AS cur,
       COUNT(DISTINCT CASE WHEN created_at < ? THEN agent_id END) AS prev
     FROM messages WHERE agent_id IS NOT NULL AND created_at >= ?${msgCond.sql}`
  ).get(since, since, prevSince, ...msgCond.params) as { cur: number; prev: number };

  // --- Custo, cache e duracao (usage_events) ---
  const usageRow = db.prepare(
    `SELECT
       SUM(CASE WHEN created_at >= ? THEN COALESCE(cost_usd, 0) ELSE 0 END) AS curCost,
       SUM(CASE WHEN created_at < ? THEN COALESCE(cost_usd, 0) ELSE 0 END) AS prevCost,
       SUM(CASE WHEN created_at >= ? AND cost_usd IS NULL THEN 1 ELSE 0 END) AS curUnknown,
       SUM(CASE WHEN created_at >= ? THEN cached_tokens ELSE 0 END) AS curCached,
       SUM(CASE WHEN created_at >= ? THEN input_tokens ELSE 0 END) AS curInput,
       SUM(CASE WHEN created_at < ? THEN cached_tokens ELSE 0 END) AS prevCached,
       SUM(CASE WHEN created_at < ? THEN input_tokens ELSE 0 END) AS prevInput,
       AVG(CASE WHEN created_at >= ? THEN duration_ms END) AS curAvgMs
     FROM usage_events WHERE created_at >= ?${msgCond.sql}`
  ).get(since, since, since, since, since, since, since, since, prevSince, ...msgCond.params) as {
    curCost: number | null; prevCost: number | null; curUnknown: number | null;
    curCached: number | null; curInput: number | null;
    prevCached: number | null; prevInput: number | null;
    curAvgMs: number | null;
  };

  // --- Tarefas ---
  const taskRow = db.prepare(
    `SELECT
       SUM(CASE WHEN status = 'done' AND updated_at >= ? THEN 1 ELSE 0 END) AS done,
       SUM(CASE WHEN status = 'failed' AND updated_at >= ? THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN status = 'done' AND updated_at < ? AND updated_at >= ? THEN 1 ELSE 0 END) AS prevDone,
       SUM(CASE WHEN status = 'failed' AND updated_at < ? AND updated_at >= ? THEN 1 ELSE 0 END) AS prevFailed,
       SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS inProgress,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
     FROM tasks WHERE 1 = 1${tCond.sql}`
  ).get(since, since, since, prevSince, since, prevSince, ...tCond.params) as {
    done: number | null; failed: number | null; prevDone: number | null; prevFailed: number | null;
    inProgress: number | null; pending: number | null;
  };

  // --- Donut: status das tarefas (periodo + tudo que segue aberto) ---
  const statusRows = db.prepare(
    `SELECT status, COUNT(*) AS c FROM tasks
     WHERE (updated_at >= ? OR status IN ('pending', 'in_progress'))${tCond.sql}
     GROUP BY status`
  ).all(since, ...tCond.params) as Array<{ status: string; c: number }>;
  const taskStatus: Record<string, number> = {};
  for (const row of statusRows) taskStatus[row.status] = row.c;

  // --- Serie temporal (tokens de messages, custo de usage_events) ---
  const bucketUnit: 'hour' | 'day' = filters.range === '24h' ? 'hour' : 'day';
  const bucketExpr = bucketUnit === 'hour'
    ? "strftime('%Y-%m-%d %H:00', created_at, 'localtime')"
    : "strftime('%Y-%m-%d', created_at, 'localtime')";

  const tokenBuckets = db.prepare(
    `SELECT ${bucketExpr} AS bucket, SUM(input_tokens) AS inp, SUM(output_tokens) AS outp
     FROM messages WHERE created_at >= ?${msgCond.sql} GROUP BY bucket`
  ).all(since, ...msgCond.params) as Array<{ bucket: string; inp: number; outp: number }>;

  const costBuckets = db.prepare(
    `SELECT ${bucketExpr} AS bucket, SUM(COALESCE(cost_usd, 0)) AS cost
     FROM usage_events WHERE created_at >= ?${msgCond.sql} GROUP BY bucket`
  ).all(since, ...msgCond.params) as Array<{ bucket: string; cost: number }>;

  const tokenByBucket = new Map(tokenBuckets.map(b => [b.bucket, b]));
  const costByBucket = new Map(costBuckets.map(b => [b.bucket, b.cost]));

  const series: AnalyticsSeriesPoint[] = [];
  const stepMs = bucketUnit === 'hour' ? 3_600_000 : 86_400_000;
  const steps = bucketUnit === 'hour' ? hours : hours / 24;
  for (let i = steps - 1; i >= 0; i--) {
    const d = new Date(nowMs - i * stepMs);
    const key = bucketUnit === 'hour' ? localHour(d) : localDay(d);
    const tokens = tokenByBucket.get(key);
    series.push({
      bucket: key,
      input: tokens?.inp ?? 0,
      output: tokens?.outp ?? 0,
      cost: costByBucket.get(key) ?? 0,
    });
  }

  // --- Carga por agente ---
  const msgByAgent = db.prepare(
    `SELECT agent_id, SUM(input_tokens) AS inp, SUM(output_tokens) AS outp, COUNT(*) AS msgs
     FROM messages WHERE created_at >= ? AND agent_id IS NOT NULL${msgCond.sql} GROUP BY agent_id`
  ).all(since, ...msgCond.params) as Array<{ agent_id: string; inp: number; outp: number; msgs: number }>;

  const assigneeCond = agentCond('assignee', ids);
  const tasksByAgent = db.prepare(
    `SELECT assignee,
       SUM(CASE WHEN status = 'done' AND updated_at >= ? THEN 1 ELSE 0 END) AS done,
       SUM(CASE WHEN status = 'failed' AND updated_at >= ? THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS active
     FROM tasks WHERE assignee IS NOT NULL${assigneeCond.sql} GROUP BY assignee`
  ).all(since, since, ...assigneeCond.params) as
    Array<{ assignee: string; done: number; failed: number; active: number }>;

  const agentById = new Map(agents.map(a => [a.id, a]));
  const loadById = new Map<string, AgentLoadRow>();
  const ensureRow = (agentId: string): AgentLoadRow => {
    let row = loadById.get(agentId);
    if (!row) {
      const info = agentById.get(agentId);
      row = {
        agentId,
        name: info?.name ?? agentId,
        team: info?.team ?? null,
        inputTokens: 0,
        outputTokens: 0,
        messages: 0,
        tasksDone: 0,
        tasksFailed: 0,
        tasksActive: 0,
      };
      loadById.set(agentId, row);
    }
    return row;
  };
  for (const m of msgByAgent) {
    const row = ensureRow(m.agent_id);
    row.inputTokens = m.inp ?? 0;
    row.outputTokens = m.outp ?? 0;
    row.messages = m.msgs;
  }
  for (const t of tasksByAgent) {
    const row = ensureRow(t.assignee);
    row.tasksDone = t.done ?? 0;
    row.tasksFailed = t.failed ?? 0;
    row.tasksActive = t.active ?? 0;
  }
  const agentLoad = Array.from(loadById.values())
    .sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens))
    .slice(0, 10);

  const done = taskRow.done ?? 0;
  const failed = taskRow.failed ?? 0;
  const prevDone = taskRow.prevDone ?? 0;
  const prevFailed = taskRow.prevFailed ?? 0;
  const curInput = usageRow.curInput ?? 0;
  const prevInput = usageRow.prevInput ?? 0;

  return {
    range: filters.range,
    since,
    bucketUnit,
    kpis: {
      tokens: { current: tokenRow.cur ?? 0, previous: tokenRow.prev ?? 0 },
      inputTokens: tokenRow.curIn ?? 0,
      outputTokens: tokenRow.curOut ?? 0,
      cost: {
        current: usageRow.curCost ?? 0,
        previous: usageRow.prevCost ?? 0,
        known: (usageRow.curUnknown ?? 0) === 0,
      },
      cacheRate: {
        current: curInput > 0 ? (usageRow.curCached ?? 0) / curInput : 0,
        previous: prevInput > 0 ? (usageRow.prevCached ?? 0) / prevInput : 0,
      },
      tasksDone: { current: done, previous: prevDone },
      tasksFailed: { current: failed, previous: prevFailed },
      successRate: {
        current: done + failed > 0 ? done / (done + failed) : 0,
        previous: prevDone + prevFailed > 0 ? prevDone / (prevDone + prevFailed) : 0,
      },
      activeAgents: { current: activeRow.cur ?? 0, previous: activeRow.prev ?? 0 },
      tasksInProgress: taskRow.inProgress ?? 0,
      tasksPending: taskRow.pending ?? 0,
      avgCallMs: usageRow.curAvgMs,
    },
    series,
    taskStatus,
    agentLoad,
  };
}
