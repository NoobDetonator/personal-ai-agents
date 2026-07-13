import type Database from 'better-sqlite3';

export type AnalyticsRange = '24h' | '7d' | '30d';
export interface AnalyticsAgentInfo { id: string; name: string; team: string | null; }
export interface AnalyticsFilters { range: AnalyticsRange; agent?: string; team?: string; projects?: string[]; }
export interface KpiPair { current: number; previous: number; }
export interface AnalyticsSeriesPoint { bucket: string; input: number; output: number; cost: number; }
export interface AgentLoadRow {
  agentId: string; name: string; team: string | null;
  inputTokens: number; outputTokens: number; messages: number;
  tasksDone: number; tasksFailed: number; tasksActive: number;
  runs: number; runsDone: number; runsFailed: number; runsTimedOut: number; toolCalls: number;
}
export interface ProjectAnalyticsRow {
  projectId: string; name: string; status: string;
  inputTokens: number; outputTokens: number; cost: number; costKnown: boolean;
  tasks: number; runs: number; timeouts: number; toolCalls: number;
}
export interface AnalyticsResult {
  range: AnalyticsRange;
  since: string;
  bucketUnit: 'hour' | 'day';
  scope: { projects: string[]; allProjects: boolean };
  kpis: {
    tokens: KpiPair; inputTokens: number; outputTokens: number;
    cost: KpiPair & { known: boolean }; cacheRate: KpiPair;
    tasksDone: KpiPair; tasksFailed: KpiPair; successRate: KpiPair;
    activeAgents: KpiPair; tasksInProgress: number; tasksPending: number; avgCallMs: number | null;
  };
  operational: {
    runs: KpiPair; runsDone: number; runsFailed: number; runsTimedOut: number; runsCancelled: number;
    successRate: KpiPair; toolCalls: KpiPair; toolCallRate: KpiPair;
    toolResults: number; toolFailures: number; toolSuccessRate: number; skillActivations: number;
    avgRunMs: number | null;
  };
  series: AnalyticsSeriesPoint[];
  taskStatus: Record<string, number>;
  runStatus: Record<string, number>;
  agentLoad: AgentLoadRow[];
  projectBreakdown: ProjectAnalyticsRow[];
}

export const ANALYTICS_RANGES: AnalyticsRange[] = ['24h', '7d', '30d'];
const RANGE_HOURS: Record<AnalyticsRange, number> = { '24h': 24, '7d': 168, '30d': 720 };

function toSqliteUtc(ms: number): string { return new Date(ms).toISOString().slice(0, 19).replace('T', ' '); }
const pad = (n: number): string => String(n).padStart(2, '0');
const localDay = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localHour = (d: Date): string => `${localDay(d)} ${pad(d.getHours())}:00`;

function valuesCond(column: string, values: string[] | null): { sql: string; params: string[] } {
  if (values == null) return { sql: '', params: [] };
  if (!values.length) return { sql: ' AND 1 = 0', params: [] };
  return { sql: ` AND ${column} IN (${values.map(() => '?').join(',')})`, params: values };
}
function projectCond(column: string, projects: string[] | undefined): { sql: string; params: string[] } {
  return projects?.length ? valuesCond(`COALESCE(${column}, 'legacy')`, [...new Set(projects)]) : { sql: '', params: [] };
}
function scopedAgentIds(agents: AnalyticsAgentInfo[], filters: AnalyticsFilters): string[] | null {
  if (filters.agent) return [filters.agent];
  if (filters.team) return agents.filter(agent => agent.team === filters.team).map(agent => agent.id);
  return null;
}
function taskAgentCond(filters: AnalyticsFilters): { sql: string; params: string[] } {
  if (filters.agent) return { sql: ' AND t.assignee = ?', params: [filters.agent] };
  if (filters.team) return { sql: ' AND t.team = ?', params: [filters.team] };
  return { sql: '', params: [] };
}
function ratio(numerator: number, denominator: number): number { return denominator > 0 ? numerator / denominator : 0; }

export function getAnalytics(db: Database.Database, agents: AnalyticsAgentInfo[], filters: AnalyticsFilters): AnalyticsResult {
  const hours = RANGE_HOURS[filters.range];
  const nowMs = Date.now();
  const since = toSqliteUtc(nowMs - hours * 3_600_000);
  const prevSince = toSqliteUtc(nowMs - 2 * hours * 3_600_000);
  const ids = scopedAgentIds(agents, filters);
  const msgAgent = valuesCond('m.agent_id', ids);
  const usageAgent = valuesCond('u.agent_id', ids);
  const runAgent = valuesCond('r.agent_id', ids);
  const taskAgent = taskAgentCond(filters);
  const msgProject = projectCond('c.project_id', filters.projects);
  const usageProject = projectCond('u.project_id', filters.projects);
  const runProject = projectCond('r.project_id', filters.projects);
  const runtimeAgent = valuesCond('e.agent_id', ids);
  const runtimeProject = projectCond('e.project_id', filters.projects);
  const taskProject = projectCond('t.project_id', filters.projects);

  const tokenRow = db.prepare(
    `SELECT
       SUM(CASE WHEN m.created_at >= ? THEN m.input_tokens + m.output_tokens ELSE 0 END) AS cur,
       SUM(CASE WHEN m.created_at < ? THEN m.input_tokens + m.output_tokens ELSE 0 END) AS prev,
       SUM(CASE WHEN m.created_at >= ? THEN m.input_tokens ELSE 0 END) AS curIn,
       SUM(CASE WHEN m.created_at >= ? THEN m.output_tokens ELSE 0 END) AS curOut
     FROM messages m LEFT JOIN conversations c ON c.id = m.conversation_id
     WHERE m.created_at >= ?${msgAgent.sql}${msgProject.sql}`,
  ).get(since, since, since, since, prevSince, ...msgAgent.params, ...msgProject.params) as
    { cur: number | null; prev: number | null; curIn: number | null; curOut: number | null };

  const activeRow = db.prepare(
    `SELECT
       COUNT(DISTINCT CASE WHEN m.created_at >= ? THEN m.agent_id END) AS cur,
       COUNT(DISTINCT CASE WHEN m.created_at < ? THEN m.agent_id END) AS prev
     FROM messages m LEFT JOIN conversations c ON c.id = m.conversation_id
     WHERE m.agent_id IS NOT NULL AND m.created_at >= ?${msgAgent.sql}${msgProject.sql}`,
  ).get(since, since, prevSince, ...msgAgent.params, ...msgProject.params) as { cur: number; prev: number };

  const usageRow = db.prepare(
    `SELECT
       SUM(CASE WHEN u.created_at >= ? THEN COALESCE(u.cost_usd, 0) ELSE 0 END) AS curCost,
       SUM(CASE WHEN u.created_at < ? THEN COALESCE(u.cost_usd, 0) ELSE 0 END) AS prevCost,
       SUM(CASE WHEN u.created_at >= ? AND (u.cost_usd IS NULL OR u.usage_known = 0) THEN 1 ELSE 0 END) AS curUnknown,
       SUM(CASE WHEN u.created_at >= ? THEN u.cached_tokens ELSE 0 END) AS curCached,
       SUM(CASE WHEN u.created_at >= ? THEN u.input_tokens ELSE 0 END) AS curInput,
       SUM(CASE WHEN u.created_at < ? THEN u.cached_tokens ELSE 0 END) AS prevCached,
       SUM(CASE WHEN u.created_at < ? THEN u.input_tokens ELSE 0 END) AS prevInput,
       AVG(CASE WHEN u.created_at >= ? THEN u.duration_ms END) AS curAvgMs
     FROM usage_events u WHERE u.created_at >= ?${usageAgent.sql}${usageProject.sql}`,
  ).get(since, since, since, since, since, since, since, since, prevSince, ...usageAgent.params, ...usageProject.params) as {
    curCost: number | null; prevCost: number | null; curUnknown: number | null;
    curCached: number | null; curInput: number | null; prevCached: number | null; prevInput: number | null; curAvgMs: number | null;
  };

  const taskRow = db.prepare(
    `SELECT
       SUM(CASE WHEN t.status = 'done' AND t.updated_at >= ? THEN 1 ELSE 0 END) AS done,
       SUM(CASE WHEN t.status = 'failed' AND t.updated_at >= ? THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN t.status = 'done' AND t.updated_at < ? AND t.updated_at >= ? THEN 1 ELSE 0 END) AS prevDone,
       SUM(CASE WHEN t.status = 'failed' AND t.updated_at < ? AND t.updated_at >= ? THEN 1 ELSE 0 END) AS prevFailed,
       SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS inProgress,
       SUM(CASE WHEN t.status = 'pending' THEN 1 ELSE 0 END) AS pending
     FROM tasks t WHERE 1 = 1${taskAgent.sql}${taskProject.sql}`,
  ).get(since, since, since, prevSince, since, prevSince, ...taskAgent.params, ...taskProject.params) as {
    done: number | null; failed: number | null; prevDone: number | null; prevFailed: number | null;
    inProgress: number | null; pending: number | null;
  };

  const statusRows = db.prepare(
    `SELECT t.status, COUNT(*) AS c FROM tasks t
     WHERE (t.updated_at >= ? OR t.status IN ('pending', 'in_progress'))${taskAgent.sql}${taskProject.sql}
     GROUP BY t.status`,
  ).all(since, ...taskAgent.params, ...taskProject.params) as Array<{ status: string; c: number }>;
  const taskStatus: Record<string, number> = {};
  for (const row of statusRows) taskStatus[row.status] = row.c;

  const runRow = db.prepare(
    `SELECT
       SUM(CASE WHEN r.created_at >= ? THEN 1 ELSE 0 END) AS cur,
       SUM(CASE WHEN r.created_at < ? THEN 1 ELSE 0 END) AS prev,
       SUM(CASE WHEN r.created_at >= ? AND r.status = 'done' THEN 1 ELSE 0 END) AS done,
       SUM(CASE WHEN r.created_at >= ? AND r.status = 'failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN r.created_at >= ? AND r.status = 'timed_out' THEN 1 ELSE 0 END) AS timedOut,
       SUM(CASE WHEN r.created_at >= ? AND r.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
       SUM(CASE WHEN r.created_at < ? AND r.status = 'done' THEN 1 ELSE 0 END) AS prevDone,
       SUM(CASE WHEN r.created_at < ? AND r.status IN ('failed', 'timed_out') THEN 1 ELSE 0 END) AS prevFailed,
       AVG(CASE WHEN r.created_at >= ? THEN r.duration_ms END) AS avgMs
     FROM runs r WHERE r.created_at >= ?${runAgent.sql}${runProject.sql}`,
  ).get(since, since, since, since, since, since, since, since, since, prevSince, ...runAgent.params, ...runProject.params) as {
    cur: number | null; prev: number | null; done: number | null; failed: number | null; timedOut: number | null;
    cancelled: number | null; prevDone: number | null; prevFailed: number | null; avgMs: number | null;
  };

  const toolRow = db.prepare(
    `SELECT
       SUM(CASE WHEN r.created_at >= ? THEN 1 ELSE 0 END) AS curCalls,
       SUM(CASE WHEN r.created_at < ? THEN 1 ELSE 0 END) AS prevCalls,
       COUNT(DISTINCT CASE WHEN r.created_at >= ? THEN r.id END) AS curRuns,
       COUNT(DISTINCT CASE WHEN r.created_at < ? THEN r.id END) AS prevRuns
     FROM run_events e JOIN runs r ON r.id = e.run_id
     WHERE e.type = 'tool_start' AND r.created_at >= ?${runAgent.sql}${runProject.sql}`,
  ).get(since, since, since, since, prevSince, ...runAgent.params, ...runProject.params) as
    { curCalls: number | null; prevCalls: number | null; curRuns: number | null; prevRuns: number | null };

  const runtimeRow = db.prepare(
    `SELECT
       SUM(CASE WHEN e.type = 'tool_result' AND e.created_at >= ? THEN 1 ELSE 0 END) AS results,
       SUM(CASE WHEN e.type = 'tool_result' AND e.created_at >= ?
                 AND json_extract(e.payload_json, '$.success') = 0 THEN 1 ELSE 0 END) AS failures,
       SUM(CASE WHEN e.type = 'skill_activated' AND e.created_at >= ? THEN 1 ELSE 0 END) AS skills
     FROM agent_runtime_events e
     WHERE e.created_at >= ?${runtimeAgent.sql}${runtimeProject.sql}`,
  ).get(since, since, since, since, ...runtimeAgent.params, ...runtimeProject.params) as
    { results: number | null; failures: number | null; skills: number | null };

  const runStatusRows = db.prepare(
    `SELECT r.status, COUNT(*) AS c FROM runs r
     WHERE (r.created_at >= ? OR r.status IN ('queued', 'running', 'waiting_confirmation'))${runAgent.sql}${runProject.sql}
     GROUP BY r.status`,
  ).all(since, ...runAgent.params, ...runProject.params) as Array<{ status: string; c: number }>;
  const runStatus: Record<string, number> = {};
  for (const row of runStatusRows) runStatus[row.status] = row.c;

  const bucketUnit: 'hour' | 'day' = filters.range === '24h' ? 'hour' : 'day';
  const bucketExpr = bucketUnit === 'hour'
    ? "strftime('%Y-%m-%d %H:00', created_at, 'localtime')"
    : "strftime('%Y-%m-%d', created_at, 'localtime')";
  const tokenBuckets = db.prepare(
    `SELECT ${bucketExpr.replaceAll('created_at', 'm.created_at')} AS bucket,
       SUM(m.input_tokens) AS inp, SUM(m.output_tokens) AS outp
     FROM messages m LEFT JOIN conversations c ON c.id = m.conversation_id
     WHERE m.created_at >= ?${msgAgent.sql}${msgProject.sql} GROUP BY bucket`,
  ).all(since, ...msgAgent.params, ...msgProject.params) as Array<{ bucket: string; inp: number; outp: number }>;
  const costBuckets = db.prepare(
    `SELECT ${bucketExpr.replaceAll('created_at', 'u.created_at')} AS bucket, SUM(COALESCE(u.cost_usd, 0)) AS cost
     FROM usage_events u WHERE u.created_at >= ?${usageAgent.sql}${usageProject.sql} GROUP BY bucket`,
  ).all(since, ...usageAgent.params, ...usageProject.params) as Array<{ bucket: string; cost: number }>;
  const tokenByBucket = new Map(tokenBuckets.map(bucket => [bucket.bucket, bucket]));
  const costByBucket = new Map(costBuckets.map(bucket => [bucket.bucket, bucket.cost]));
  const series: AnalyticsSeriesPoint[] = [];
  const stepMs = bucketUnit === 'hour' ? 3_600_000 : 86_400_000;
  const steps = bucketUnit === 'hour' ? hours : hours / 24;
  for (let index = steps - 1; index >= 0; index--) {
    const date = new Date(nowMs - index * stepMs);
    const key = bucketUnit === 'hour' ? localHour(date) : localDay(date);
    const tokens = tokenByBucket.get(key);
    series.push({ bucket: key, input: tokens?.inp ?? 0, output: tokens?.outp ?? 0, cost: costByBucket.get(key) ?? 0 });
  }

  const msgByAgent = db.prepare(
    `SELECT m.agent_id, SUM(m.input_tokens) AS inp, SUM(m.output_tokens) AS outp, COUNT(*) AS msgs
     FROM messages m LEFT JOIN conversations c ON c.id = m.conversation_id
     WHERE m.created_at >= ? AND m.agent_id IS NOT NULL${msgAgent.sql}${msgProject.sql} GROUP BY m.agent_id`,
  ).all(since, ...msgAgent.params, ...msgProject.params) as Array<{ agent_id: string; inp: number; outp: number; msgs: number }>;
  const taskAssignee = valuesCond('t.assignee', ids);
  const tasksByAgent = db.prepare(
    `SELECT t.assignee,
       SUM(CASE WHEN t.status = 'done' AND t.updated_at >= ? THEN 1 ELSE 0 END) AS done,
       SUM(CASE WHEN t.status = 'failed' AND t.updated_at >= ? THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS active,
       MAX(t.team) AS team
     FROM tasks t WHERE t.assignee IS NOT NULL${taskAssignee.sql}${taskProject.sql} GROUP BY t.assignee`,
  ).all(since, since, ...taskAssignee.params, ...taskProject.params) as
    Array<{ assignee: string; done: number; failed: number; active: number; team: string | null }>;
  const runsByAgent = db.prepare(
    `SELECT r.agent_id, COUNT(*) AS runs,
       SUM(CASE WHEN r.status = 'done' THEN 1 ELSE 0 END) AS done,
       SUM(CASE WHEN r.status = 'failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN r.status = 'timed_out' THEN 1 ELSE 0 END) AS timedOut,
       (SELECT COUNT(*) FROM run_events e WHERE e.run_id IN
         (SELECT r2.id FROM runs r2 WHERE r2.agent_id = r.agent_id AND r2.created_at >= ?${runProject.sql.replaceAll('r.', 'r2.')})
         AND e.type = 'tool_start') AS tools
     FROM runs r WHERE r.created_at >= ?${runAgent.sql}${runProject.sql} GROUP BY r.agent_id`,
  ).all(since, ...runProject.params, since, ...runAgent.params, ...runProject.params) as
    Array<{ agent_id: string; runs: number; done: number; failed: number; timedOut: number; tools: number }>;

  const agentById = new Map(agents.map(agent => [agent.id, agent]));
  const loadById = new Map<string, AgentLoadRow>();
  const ensureRow = (agentId: string, historicalTeam: string | null = null): AgentLoadRow => {
    let row = loadById.get(agentId);
    if (!row) {
      const info = agentById.get(agentId);
      row = {
        agentId, name: info?.name ?? agentId, team: info?.team ?? historicalTeam,
        inputTokens: 0, outputTokens: 0, messages: 0, tasksDone: 0, tasksFailed: 0, tasksActive: 0,
        runs: 0, runsDone: 0, runsFailed: 0, runsTimedOut: 0, toolCalls: 0,
      };
      loadById.set(agentId, row);
    } else if (!row.team && historicalTeam) row.team = historicalTeam;
    return row;
  };
  for (const message of msgByAgent) Object.assign(ensureRow(message.agent_id), { inputTokens: message.inp ?? 0, outputTokens: message.outp ?? 0, messages: message.msgs });
  for (const task of tasksByAgent) Object.assign(ensureRow(task.assignee, task.team), { tasksDone: task.done ?? 0, tasksFailed: task.failed ?? 0, tasksActive: task.active ?? 0 });
  for (const run of runsByAgent) Object.assign(ensureRow(run.agent_id), { runs: run.runs, runsDone: run.done ?? 0, runsFailed: run.failed ?? 0, runsTimedOut: run.timedOut ?? 0, toolCalls: run.tools ?? 0 });
  const agentLoad = Array.from(loadById.values())
    .sort((a, b) => (b.inputTokens + b.outputTokens + b.runs) - (a.inputTokens + a.outputTokens + a.runs)).slice(0, 20);

  const projectRows = db.prepare('SELECT id, name, status FROM projects ORDER BY name').all() as Array<{ id: string; name: string; status: string }>;
  const selectedProjects = filters.projects?.length ? new Set(filters.projects) : null;
  const breakdown = new Map<string, ProjectAnalyticsRow>();
  for (const project of projectRows) {
    if (selectedProjects && !selectedProjects.has(project.id)) continue;
    breakdown.set(project.id, { projectId: project.id, name: project.name, status: project.status, inputTokens: 0, outputTokens: 0, cost: 0, costKnown: true, tasks: 0, runs: 0, timeouts: 0, toolCalls: 0 });
  }
  const ensureProject = (projectId: string): ProjectAnalyticsRow => {
    let row = breakdown.get(projectId);
    if (!row) {
      row = { projectId, name: projectId, status: 'historical', inputTokens: 0, outputTokens: 0, cost: 0, costKnown: true, tasks: 0, runs: 0, timeouts: 0, toolCalls: 0 };
      breakdown.set(projectId, row);
    }
    return row;
  };
  const messageProjects = db.prepare(
    `SELECT COALESCE(c.project_id, 'legacy') AS projectId, SUM(m.input_tokens) AS inp, SUM(m.output_tokens) AS outp
     FROM messages m LEFT JOIN conversations c ON c.id = m.conversation_id
     WHERE m.created_at >= ?${msgAgent.sql}${msgProject.sql} GROUP BY projectId`,
  ).all(since, ...msgAgent.params, ...msgProject.params) as Array<{ projectId: string; inp: number; outp: number }>;
  for (const row of messageProjects) Object.assign(ensureProject(row.projectId), { inputTokens: row.inp ?? 0, outputTokens: row.outp ?? 0 });
  const usageProjects = db.prepare(
    `SELECT COALESCE(u.project_id, 'legacy') AS projectId, SUM(COALESCE(u.cost_usd, 0)) AS cost,
       SUM(CASE WHEN u.cost_usd IS NULL OR u.usage_known = 0 THEN 1 ELSE 0 END) AS unknown
     FROM usage_events u WHERE u.created_at >= ?${usageAgent.sql}${usageProject.sql} GROUP BY projectId`,
  ).all(since, ...usageAgent.params, ...usageProject.params) as Array<{ projectId: string; cost: number; unknown: number }>;
  for (const row of usageProjects) Object.assign(ensureProject(row.projectId), { cost: row.cost ?? 0, costKnown: (row.unknown ?? 0) === 0 });
  const taskProjects = db.prepare(
    `SELECT COALESCE(t.project_id, 'legacy') AS projectId, COUNT(*) AS tasks FROM tasks t
     WHERE (t.updated_at >= ? OR t.status IN ('pending', 'in_progress'))${taskAgent.sql}${taskProject.sql} GROUP BY projectId`,
  ).all(since, ...taskAgent.params, ...taskProject.params) as Array<{ projectId: string; tasks: number }>;
  for (const row of taskProjects) ensureProject(row.projectId).tasks = row.tasks;
  const runProjects = db.prepare(
    `SELECT COALESCE(r.project_id, 'legacy') AS projectId, COUNT(*) AS runs,
       SUM(CASE WHEN r.status = 'timed_out' THEN 1 ELSE 0 END) AS timeouts
     FROM runs r WHERE r.created_at >= ?${runAgent.sql}${runProject.sql} GROUP BY projectId`,
  ).all(since, ...runAgent.params, ...runProject.params) as Array<{ projectId: string; runs: number; timeouts: number }>;
  for (const row of runProjects) Object.assign(ensureProject(row.projectId), { runs: row.runs, timeouts: row.timeouts ?? 0 });
  const toolProjects = db.prepare(
    `SELECT COALESCE(r.project_id, 'legacy') AS projectId, COUNT(*) AS tools
     FROM run_events e JOIN runs r ON r.id = e.run_id
     WHERE e.type = 'tool_start' AND r.created_at >= ?${runAgent.sql}${runProject.sql} GROUP BY projectId`,
  ).all(since, ...runAgent.params, ...runProject.params) as Array<{ projectId: string; tools: number }>;
  for (const row of toolProjects) ensureProject(row.projectId).toolCalls = row.tools;

  const projectBreakdown = Array.from(breakdown.values())
    .sort((a, b) => (b.inputTokens + b.outputTokens + b.runs + b.tasks) - (a.inputTokens + a.outputTokens + a.runs + a.tasks));

  const done = taskRow.done ?? 0, failed = taskRow.failed ?? 0;
  const prevDone = taskRow.prevDone ?? 0, prevFailed = taskRow.prevFailed ?? 0;
  const curRuns = runRow.cur ?? 0, prevRuns = runRow.prev ?? 0;
  const runDone = runRow.done ?? 0, runFailures = (runRow.failed ?? 0) + (runRow.timedOut ?? 0);
  const previousRunFailures = runRow.prevFailed ?? 0;
  const curInput = usageRow.curInput ?? 0, prevInput = usageRow.prevInput ?? 0;

  return {
    range: filters.range, since, bucketUnit,
    scope: { projects: filters.projects?.length ? [...new Set(filters.projects)] : [], allProjects: !filters.projects?.length },
    kpis: {
      tokens: { current: tokenRow.cur ?? 0, previous: tokenRow.prev ?? 0 }, inputTokens: tokenRow.curIn ?? 0, outputTokens: tokenRow.curOut ?? 0,
      cost: { current: usageRow.curCost ?? 0, previous: usageRow.prevCost ?? 0, known: (usageRow.curUnknown ?? 0) === 0 },
      cacheRate: { current: ratio(usageRow.curCached ?? 0, curInput), previous: ratio(usageRow.prevCached ?? 0, prevInput) },
      tasksDone: { current: done, previous: prevDone }, tasksFailed: { current: failed, previous: prevFailed },
      successRate: { current: ratio(done, done + failed), previous: ratio(prevDone, prevDone + prevFailed) },
      activeAgents: { current: activeRow.cur ?? 0, previous: activeRow.prev ?? 0 },
      tasksInProgress: taskRow.inProgress ?? 0, tasksPending: taskRow.pending ?? 0, avgCallMs: usageRow.curAvgMs,
    },
    operational: {
      runs: { current: curRuns, previous: prevRuns }, runsDone: runDone, runsFailed: runRow.failed ?? 0,
      runsTimedOut: runRow.timedOut ?? 0, runsCancelled: runRow.cancelled ?? 0,
      successRate: { current: ratio(runDone, runDone + runFailures), previous: ratio(runRow.prevDone ?? 0, (runRow.prevDone ?? 0) + previousRunFailures) },
      toolCalls: { current: toolRow.curCalls ?? 0, previous: toolRow.prevCalls ?? 0 },
      toolCallRate: { current: ratio(toolRow.curRuns ?? 0, curRuns), previous: ratio(toolRow.prevRuns ?? 0, prevRuns) },
      toolResults: runtimeRow.results ?? 0,
      toolFailures: runtimeRow.failures ?? 0,
      toolSuccessRate: ratio((runtimeRow.results ?? 0) - (runtimeRow.failures ?? 0), runtimeRow.results ?? 0),
      skillActivations: runtimeRow.skills ?? 0,
      avgRunMs: runRow.avgMs,
    },
    series, taskStatus, runStatus, agentLoad, projectBreakdown,
  };
}
