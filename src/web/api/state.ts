import type http from 'node:http';
import { getConfig, updateConfig } from '../../config/loader.js';
import { getDb } from '../../db/connection.js';
import { readSoul, readMemory, readDailyNote } from '../../agents/personality.js';
import { getAvailableModels, MODEL_CATALOG } from '../../config/models.js';
import { getPendingConfirmations, resolveConfirmation, type ConfirmAnswer } from '../../chat/confirm.js';
import { refreshHeartbeat } from '../../heartbeat/engine.js';
import { getSessionUsage } from '../../agents/usage.js';
import { listProfiles } from '../../agents/prompt-composer.js';
import { resolveAgentProfileProvenance } from '../../agents/profile-provenance.js';
import { getMcpStatus } from '../../mcp/manager.js';
import { listActiveDelegations } from '../../tools/tasks.js';
import { getAnalytics, ANALYTICS_RANGES, type AnalyticsRange } from '../analytics.js';
import { emitBus } from '../bus.js';
import { json, readBody } from '../http.js';
import { getProjectSettings, listProjects } from '../../projects/service.js';
import { getLatestRunForConversation, isTerminalStatus, listRunEvents, type RunStatus } from '../../db/run-helpers.js';

const providerByModel = new Map(MODEL_CATALOG.map(model => [model.id, model.provider]));

export function apiState(params?: URLSearchParams): unknown {
  const config = getConfig();
  const db = getDb();
  const requestedProject = params?.get('project') ?? null;
  const projectSettings = requestedProject ? getProjectSettings(requestedProject) : null;
  const usageScope = projectSettings ? " AND COALESCE(project_id, 'legacy') = ?" : '';
  const usageParams = projectSettings ? [requestedProject] : [];
  const tokenRows = db.prepare(
    `SELECT agent_id, SUM(input_tokens) AS inp, SUM(output_tokens) AS outp,
            SUM(CASE WHEN usage_known = 0 THEN 1 ELSE 0 END) AS unmetered
     FROM usage_events WHERE agent_id IS NOT NULL${usageScope} GROUP BY agent_id`,
  ).all(...usageParams) as Array<{ agent_id: string; inp: number; outp: number; unmetered: number }>;
  const tokensByAgent = new Map(tokenRows.map(row => [row.agent_id, {
    input: row.inp ?? 0, output: row.outp ?? 0, unmetered: row.unmetered ?? 0,
  }]));
  const latestModels = new Map<string, string>();
  const latestRows = db.prepare(
    `SELECT agent_id, model FROM usage_events
     WHERE agent_id IS NOT NULL${usageScope} ORDER BY datetime(created_at) DESC, rowid DESC`,
  ).all(...usageParams) as Array<{ agent_id: string; model: string }>;
  for (const row of latestRows) if (!latestModels.has(row.agent_id)) latestModels.set(row.agent_id, row.model);
  const today = db.prepare(
    `SELECT SUM(input_tokens) AS inp, SUM(output_tokens) AS outp
     FROM usage_events WHERE created_at >= date('now')${usageScope}`,
  ).get(...usageParams) as { inp: number | null; outp: number | null };
  const profiles = listProfiles();

  return {
    agents: Object.entries(config.agents).map(([id, agent]) => ({
      id,
      name: agent.name,
      description: agent.description,
      role: agent.role ?? 'worker',
      parent: agent.parent ?? null,
      team: agent.team ?? null,
      temporary: agent.temporary ?? false,
      fast: agent.thinking === false,
      enabled: agent.enabled,
      provider: providerByModel.get(latestModels.get(id) ?? '') ?? projectSettings?.default_provider ?? agent.provider ?? config.ai.provider,
      model: latestModels.get(id) ?? projectSettings?.default_model ?? agent.model ?? config.ai.model,
      configuredModel: projectSettings?.default_model ?? agent.model ?? config.ai.model,
      modelSource: latestModels.has(id) ? 'last_usage' : projectSettings?.default_model ? 'project' : 'configuration',
      profileProvenance: resolveAgentProfileProvenance(agent, profiles),
      tokens: tokensByAgent.get(id) ?? { input: 0, output: 0, unmetered: 0 },
    })),
    config: {
      provider: projectSettings?.default_provider ?? config.ai.provider,
      model: projectSettings?.default_model ?? config.ai.model,
      modelSource: projectSettings?.default_model ? 'project' : 'global',
      shellMode: config.shell.mode,
      heartbeatEnabled: config.heartbeat.enabled,
      heartbeatIntervalMin: config.heartbeat.intervalMin,
      nudgeEvery: config.memory.nudgeEvery,
      onboarded: config.user.onboarded,
      showToolCalls: config.display.showToolCalls,
    },
    tokensToday: { input: today.inp ?? 0, output: today.outp ?? 0 },
    sessionUsage: getSessionUsage(),
    pendingConfirmations: getPendingConfirmations(),
    activeDelegations: listActiveDelegations(),
    mcp: getMcpStatus(),
  };
}

export function apiAgent(id: string, projectId?: string | null): unknown | null {
  const config = getConfig();
  const agent = config.agents[id];
  if (!agent) return null;
  const db = getDb();
  const conversations = db.prepare(
    `SELECT c.id, c.title, c.type, c.updated_at,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
     FROM conversations c
     WHERE c.agent_id = ? OR c.id IN (SELECT conversation_id FROM group_participants WHERE agent_id = ?)
     ORDER BY c.updated_at DESC LIMIT 30`,
  ).all(id, id);
  const commands = db.prepare(
    'SELECT command, cwd, exit_code, created_at FROM command_log WHERE agent_id = ? ORDER BY created_at DESC LIMIT 30',
  ).all(id);
  const projectSettings = projectId ? getProjectSettings(projectId) : null;
  const scope = projectSettings ? " AND COALESCE(project_id, 'legacy') = ?" : '';
  const params = projectSettings ? [id, projectId] : [id];
  const tokens = db.prepare(
    `SELECT SUM(input_tokens) AS inp, SUM(output_tokens) AS outp, COUNT(*) AS calls,
            SUM(CASE WHEN usage_known = 0 THEN 1 ELSE 0 END) AS unmetered
     FROM usage_events WHERE agent_id = ?${scope}`,
  ).get(...params) as { inp: number | null; outp: number | null; calls: number; unmetered: number | null };
  const messageCount = db.prepare('SELECT COUNT(*) AS count FROM messages WHERE agent_id = ?').get(id) as { count: number };
  const latestUsage = db.prepare(
    `SELECT model FROM usage_events WHERE agent_id = ?${scope} ORDER BY datetime(created_at) DESC, rowid DESC LIMIT 1`,
  ).get(...params) as { model: string } | undefined;

  return {
    id,
    ...agent,
    model: latestUsage?.model ?? projectSettings?.default_model ?? agent.model ?? config.ai.model,
    provider: providerByModel.get(latestUsage?.model ?? '') ?? projectSettings?.default_provider ?? agent.provider ?? config.ai.provider,
    configuredModel: projectSettings?.default_model ?? agent.model ?? config.ai.model,
    modelSource: latestUsage ? 'last_usage' : projectSettings?.default_model ? 'project' : 'configuration',
    profileProvenance: resolveAgentProfileProvenance(agent),
    soul: readSoul(id),
    memory: readMemory(id),
    dailyNote: readDailyNote(id),
    conversations,
    commands,
    stats: {
      inputTokens: tokens.inp ?? 0, outputTokens: tokens.outp ?? 0, messages: messageCount.count,
      calls: tokens.calls, unmeteredCalls: tokens.unmetered ?? 0,
    },
  };
}

export function apiAnalytics(params: URLSearchParams): unknown {
  const config = getConfig();
  const rawRange = params.get('range') ?? '7d';
  const range: AnalyticsRange = (ANALYTICS_RANGES as string[]).includes(rawRange) ? rawRange as AnalyticsRange : '7d';
  const idPattern = /^[a-z0-9_-]+$/i;
  const agent = params.get('agent') ?? undefined;
  const team = params.get('team') ?? undefined;
  const knownProjects = new Set(listProjects().map(project => project.id));
  const projects = [...new Set(params.getAll('project'))]
    .filter(id => idPattern.test(id) && knownProjects.has(id))
    .slice(0, 50);
  const agents = Object.entries(config.agents).map(([id, value]) => ({ id, name: value.name, team: value.team ?? null }));

  return getAnalytics(getDb(), agents, {
    range,
    agent: agent && idPattern.test(agent) ? agent : undefined,
    team: team && idPattern.test(team) ? team : undefined,
    projects: projects.length ? projects : undefined,
  });
}

export function apiConversation(id: string): unknown | null {
  const db = getDb();
  const meta = db.prepare(
    `SELECT id, project_id, agent_id, title, archived, pinned, last_run_status,
            model_override, provider_override
     FROM conversations WHERE id = ?`,
  ).get(id) as Record<string, unknown> | undefined;
  if (!meta) return null;
  const config = getConfig();
  const projectId = String(meta.project_id ?? 'legacy');
  const projectSettings = getProjectSettings(projectId);
  const agent = config.agents[String(meta.agent_id)];
  const inheritedModel = projectSettings?.default_model ?? agent?.model ?? config.ai.model;
  const inheritedProvider = projectSettings?.default_provider ?? agent?.provider ?? config.ai.provider;
  meta.inherited_model = inheritedModel;
  meta.inherited_provider = inheritedProvider;
  meta.inherited_source = projectSettings?.default_model ? 'project' : agent?.model ? 'agent' : 'global';
  meta.effective_model = meta.model_override ?? inheritedModel;
  meta.effective_provider = meta.provider_override ?? inheritedProvider;
  meta.model_source = meta.model_override ? 'conversation' : meta.inherited_source;
  const messages = db.prepare(
    `SELECT role, content, agent_id, run_id, sequence, status, metadata_json, input_tokens, output_tokens, created_at
     FROM messages WHERE conversation_id = ? ORDER BY sequence ASC, created_at ASC LIMIT 300`,
  ).all(id);
  const runEvents = db.prepare(
    `SELECT e.run_id, e.sequence, e.type, e.payload_json
     FROM run_events e JOIN runs r ON r.id = e.run_id
     WHERE r.conversation_id = ? AND e.type IN ('tool_start', 'tool_result')
     ORDER BY e.run_id, e.sequence`,
  ).all(id);
  const latest = getLatestRunForConversation(id);
  const activeRun = latest && !isTerminalStatus(latest.status as RunStatus)
    ? { id: latest.id, status: latest.status, agentId: latest.agent_id, events: listRunEvents(latest.id) }
    : null;
  return { id, meta, messages, runEvents, activeRun };
}

export function apiGroups(): unknown {
  return getDb().prepare(
    `SELECT c.id, c.title, c.updated_at,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
     FROM conversations c WHERE c.type = 'group' ORDER BY c.updated_at DESC LIMIT 30`,
  ).all();
}

export function apiSchedules(): unknown {
  return getDb().prepare(
    'SELECT id, agent_id, cron_expr, task_prompt, enabled, last_run FROM schedules ORDER BY created_at DESC',
  ).all();
}

export async function handleSettings(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await readBody(req);
  const config = getConfig();
  let heartbeatChanged = false;
  if (body.shellMode === 'auto' || body.shellMode === 'confirm' || body.shellMode === 'off') {
    updateConfig({ shell: { ...config.shell, mode: body.shellMode } });
  }
  if (typeof body.heartbeatEnabled === 'boolean') {
    updateConfig({ heartbeat: { ...getConfig().heartbeat, enabled: body.heartbeatEnabled } });
    heartbeatChanged = true;
  }
  if (typeof body.heartbeatIntervalMin === 'number' && body.heartbeatIntervalMin >= 1) {
    updateConfig({ heartbeat: { ...getConfig().heartbeat, intervalMin: Math.floor(body.heartbeatIntervalMin) } });
    heartbeatChanged = true;
  }
  if (typeof body.nudgeEvery === 'number' && body.nudgeEvery >= 0) {
    updateConfig({ memory: { ...getConfig().memory, nudgeEvery: Math.floor(body.nudgeEvery) } });
  }
  if (typeof body.showToolCalls === 'boolean') {
    updateConfig({ display: { ...getConfig().display, showToolCalls: body.showToolCalls } });
  }
  if (typeof body.model === 'string') {
    const model = getAvailableModels().find(candidate => candidate.id === body.model);
    if (model) updateConfig({ ai: { ...getConfig().ai, provider: model.provider, model: model.id } });
  }
  if (heartbeatChanged) refreshHeartbeat();
  emitBus('system', { text: 'Configuracoes alteradas pelo painel web.' });
  json(res, 200, { success: true, config: (apiState() as { config: unknown }).config });
}

export async function handleConfirm(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await readBody(req);
  const id = String(body.id ?? '');
  const raw = String(body.answer ?? 'n');
  const answer: ConfirmAnswer = raw === 'a' || raw === 'always' ? 'always' : raw === 's' || raw === 'yes' ? 'yes' : 'no';
  const ok = resolveConfirmation(id, answer);
  json(res, ok ? 200 : 404, { success: ok });
}
