import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { getConfig, updateConfig } from '../config/loader.js';
import { getDb } from '../db/connection.js';
import { readSoul, readMemory, readDailyNote } from '../agents/personality.js';
import { readUserProfile } from '../agents/user-profile.js';
import { listSkillMetas } from '../skills/loader.js';
import { getAvailableModels } from '../config/models.js';
import { listTaskRows, listActiveDelegations, cancelDelegation } from '../tools/tasks.js';
import {
  getPendingConfirmations,
  resolveConfirmation,
  onPendingChange,
  type ConfirmAnswer,
} from '../chat/confirm.js';
import { refreshHeartbeat } from '../heartbeat/engine.js';
import { onBusEvent, emitBus, type BusEvent } from './bus.js';
import { getSessionUsage } from '../agents/usage.js';
import { listProfiles } from '../agents/prompt-composer.js';
import { resolveAgentProfileProvenance } from '../agents/profile-provenance.js';
import { getMcpStatus } from '../mcp/manager.js';
import { getAnalytics, ANALYTICS_RANGES, type AnalyticsRange } from './analytics.js';
import { WebSecurity } from './security.js';
import {
  listProjects,
  getProject,
  getProjectSettings,
  createProject,
  updateProject,
  archiveProject,
  deleteProject,
  assignAgentToProject,
  updateProjectSettings,
} from '../projects/service.js';
import {
  listProjectFiles,
  readProjectFile,
  readProjectRawFile,
  searchProjectFiles,
  diffProjectFile,
  writeProjectFile,
  createProjectDirectory,
  renameProjectPath,
  deleteProjectPath,
  ProjectFileError,
} from '../projects/files-service.js';
import {
  listProjectMemories,
  readProjectMemory,
  deleteProjectMemory,
  clearProjectMemories,
  deleteProjectConversation,
  exportProjectData,
  listAuditEvents,
  auditEvent,
  ProjectDataError,
} from '../projects/data-service.js';
import {
  listProjectConversations,
  createProjectConversation,
  patchConversation,
} from '../projects/conversation-service.js';
import { startChatRun, cancelRun } from '../chat/run-service.js';
import { listProjectTemplates } from '../projects/templates.js';
import { getRun, listRunEvents, getLatestRunForConversation, isTerminalStatus, type RunStatus } from '../db/run-helpers.js';
import { forkConversation } from '../db/conversation-helpers.js';
import {
  createProjectBackup,
  listProjectBackups,
  readProjectBackup,
  deleteProjectBackup,
  ProjectBackupError,
} from '../projects/backup-service.js';

// web/ estatico fica na raiz do projeto (fora de src/, sem build)
const STATIC_DIR = path.join(process.cwd(), 'web');
const LUCIDE_FILE = path.join(process.cwd(), 'node_modules', 'lucide', 'dist', 'umd', 'lucide.min.js');
const LOOPBACK_HOST = '127.0.0.1';
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const SESSION_TOKEN = randomBytes(32).toString('hex');

let server: http.Server | null = null;
let webSecurity: WebSecurity | null = null;
const sseClients = new Set<http.ServerResponse>();
let unsubscribeBus: (() => void) | null = null;
let sseKeepAlive: NodeJS.Timeout | null = null;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function setSecurityHeaders(res: http.ServerResponse): void {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function tokensEqual(candidate: string | undefined, expected: string): boolean {
  if (!candidate) return false;
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return candidateBuffer.length === expectedBuffer.length && timingSafeEqual(candidateBuffer, expectedBuffer);
}

export function getWebPanelUrl(port: number = getConfig().web.port): string {
  return `http://localhost:${port}/?token=${encodeURIComponent(SESSION_TOKEN)}`;
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  setSecurityHeaders(res);
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Content-Type deve ser application/json');
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    totalBytes += buffer.length;
    if (totalBytes > MAX_BODY_BYTES) {
      req.resume();
      throw new HttpError(413, `Corpo excede o limite de ${MAX_BODY_BYTES} bytes`);
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch {
    throw new HttpError(400, 'JSON invalido');
  }
}

// --- API handlers ---

function apiState(): unknown {
  const config = getConfig();
  const db = getDb();

  const tokenRows = db.prepare(
    `SELECT agent_id, SUM(input_tokens) AS inp, SUM(output_tokens) AS outp
     FROM messages WHERE agent_id IS NOT NULL GROUP BY agent_id`
  ).all() as Array<{ agent_id: string; inp: number; outp: number }>;
  const tokensByAgent = new Map(tokenRows.map(r => [r.agent_id, { input: r.inp ?? 0, output: r.outp ?? 0 }]));

  const today = db.prepare(
    `SELECT SUM(input_tokens) AS inp, SUM(output_tokens) AS outp
     FROM messages WHERE created_at >= date('now')`
  ).get() as { inp: number | null; outp: number | null };

  const profiles = listProfiles();
  const agents = Object.entries(config.agents).map(([id, cfg]) => ({
    id,
    name: cfg.name,
    description: cfg.description,
    role: cfg.role ?? 'worker',
    parent: cfg.parent ?? null,
    team: cfg.team ?? null,
    temporary: cfg.temporary ?? false,
    fast: cfg.thinking === false,
    enabled: cfg.enabled,
    provider: cfg.provider ?? config.ai.provider,
    model: cfg.model ?? config.ai.model,
    profileProvenance: resolveAgentProfileProvenance(cfg, profiles),
    tokens: tokensByAgent.get(id) ?? { input: 0, output: 0 },
  }));

  return {
    agents,
    config: {
      provider: config.ai.provider,
      model: config.ai.model,
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

function apiAgent(id: string): unknown | null {
  const config = getConfig();
  const cfg = config.agents[id];
  if (!cfg) return null;

  const db = getDb();
  const conversations = db.prepare(
    `SELECT c.id, c.title, c.type, c.updated_at,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
     FROM conversations c
     WHERE c.agent_id = ? OR c.id IN (SELECT conversation_id FROM group_participants WHERE agent_id = ?)
     ORDER BY c.updated_at DESC LIMIT 30`
  ).all(id, id);

  const commands = db.prepare(
    'SELECT command, cwd, exit_code, created_at FROM command_log WHERE agent_id = ? ORDER BY created_at DESC LIMIT 30'
  ).all(id);

  const tokens = db.prepare(
    'SELECT SUM(input_tokens) AS inp, SUM(output_tokens) AS outp, COUNT(*) AS msgs FROM messages WHERE agent_id = ?'
  ).get(id) as { inp: number | null; outp: number | null; msgs: number };

  return {
    id,
    ...cfg,
    profileProvenance: resolveAgentProfileProvenance(cfg),
    soul: readSoul(id),
    memory: readMemory(id),
    dailyNote: readDailyNote(id),
    conversations,
    commands,
    stats: { inputTokens: tokens.inp ?? 0, outputTokens: tokens.outp ?? 0, messages: tokens.msgs },
  };
}

function apiAnalytics(params: URLSearchParams): unknown {
  const config = getConfig();
  const rawRange = params.get('range') ?? '7d';
  const range: AnalyticsRange = (ANALYTICS_RANGES as string[]).includes(rawRange)
    ? rawRange as AnalyticsRange
    : '7d';

  const idPattern = /^[a-z0-9_-]+$/i;
  const agent = params.get('agent') ?? undefined;
  const team = params.get('team') ?? undefined;
  const knownProjects = new Set(listProjects().map(project => project.id));
  const projects = [...new Set(params.getAll('project'))]
    .filter(id => idPattern.test(id) && knownProjects.has(id))
    .slice(0, 50);

  const agents = Object.entries(config.agents).map(([id, cfg]) => ({
    id,
    name: cfg.name,
    team: cfg.team ?? null,
  }));

  return getAnalytics(getDb(), agents, {
    range,
    agent: agent && idPattern.test(agent) ? agent : undefined,
    team: team && idPattern.test(team) ? team : undefined,
    projects: projects.length ? projects : undefined,
  });
}

function apiConversation(id: string): unknown | null {
  const db = getDb();
  const meta = db.prepare(
    `SELECT id, project_id, agent_id, title, archived, pinned, last_run_status FROM conversations WHERE id = ?`
  ).get(id) as Record<string, unknown> | undefined;

  if (!meta) return null;

  const messages = db.prepare(
    `SELECT role, content, agent_id, run_id, sequence, status, metadata_json, input_tokens, output_tokens, created_at
     FROM messages WHERE conversation_id = ? ORDER BY sequence ASC, created_at ASC LIMIT 300`
  ).all(id);
  const runEvents = db.prepare(
    `SELECT e.run_id, e.sequence, e.type, e.payload_json
     FROM run_events e JOIN runs r ON r.id = e.run_id
     WHERE r.conversation_id = ? AND e.type IN ('tool_start', 'tool_result')
     ORDER BY e.run_id, e.sequence`,
  ).all(id);

  // Run em andamento: devolve seus eventos para reconstruir a bolha parcial
  // após um refresh no meio do streaming.
  const latest = getLatestRunForConversation(id);
  const activeRun = latest && !isTerminalStatus(latest.status as RunStatus)
    ? { id: latest.id, status: latest.status, agentId: latest.agent_id, events: listRunEvents(latest.id) }
    : null;

  return { id, meta, messages, runEvents, activeRun };
}

function apiGroups(): unknown {
  const db = getDb();
  return db.prepare(
    `SELECT c.id, c.title, c.updated_at,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
     FROM conversations c WHERE c.type = 'group' ORDER BY c.updated_at DESC LIMIT 30`
  ).all();
}

function apiSchedules(): unknown {
  const db = getDb();
  return db.prepare(
    'SELECT id, agent_id, cron_expr, task_prompt, enabled, last_run FROM schedules ORDER BY created_at DESC'
  ).all();
}

async function handleSettings(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
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
    const model = getAvailableModels().find(m => m.id === body.model);
    if (model) {
      updateConfig({ ai: { ...getConfig().ai, provider: model.provider, model: model.id } });
    }
  }

  if (heartbeatChanged) {
    refreshHeartbeat();
  }

  emitBus('system', { text: 'Configuracoes alteradas pelo painel web.' });
  json(res, 200, { success: true, config: (apiState() as { config: unknown }).config });
}

// --- Projects ---

function apiProjects(params: URLSearchParams): unknown {
  const status = params.get('status');
  return listProjects(status === 'archived' || status === 'active' ? status : undefined);
}

function apiProjectDetail(id: string): unknown | null {
  const project = getProject(id);
  if (!project) return null;
  return {
    project,
    settings: getProjectSettings(id),
    conversations: listProjectConversations(id, { includeArchived: true }),
  };
}

async function handleCreateProject(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await readBody(req);
  const name = String(body.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Nome do projeto e obrigatorio');
  if (name.length > 120) throw new HttpError(400, 'Nome muito longo');
  const templateId = body.templateId != null ? String(body.templateId) : 'blank';
  if (!listProjectTemplates().some(template => template.id === templateId)) throw new HttpError(400, 'Template de projeto invalido.');

  const project = createProject({
    name,
    description: body.description != null ? String(body.description) : null,
    defaultModel: body.defaultModel != null ? String(body.defaultModel) : null,
    defaultProvider: body.defaultProvider != null ? String(body.defaultProvider) : null,
    templateId,
  });

  let conversationId: string | null = null;
  try {
    if (body.createInitialConversation) {
      const defaultAgent = getConfig().defaultAgent;
      const defaultConfig = getConfig().agents[defaultAgent];
      if (!defaultConfig) throw new Error('Agente padrao nao encontrado.');
      assignAgentToProject(project.id, defaultAgent, {
        role: defaultConfig.role ?? null,
        team: defaultConfig.team ?? null,
      });
      conversationId = createProjectConversation(project.id, defaultAgent, {
        title: 'Conversa inicial',
        createdBy: 'web',
      });
    }
  } catch (error) {
    deleteProject(project.id, project.name);
    throw error;
  }
  json(res, 201, { project, conversationId });
}

async function handlePatchProject(req: http.IncomingMessage, res: http.ServerResponse, id: string): Promise<void> {
  const body = await readBody(req);
  const status = body.status === 'active' || body.status === 'archived' ? body.status : undefined;
  const updated = updateProject(id, {
    name: body.name != null ? String(body.name) : undefined,
    description: body.description !== undefined ? (body.description === null ? null : String(body.description)) : undefined,
    status,
  });
  return updated ? json(res, 200, { project: updated }) : json(res, 404, { error: 'projeto nao encontrado' });
}

async function handleDeleteProject(req: http.IncomingMessage, res: http.ServerResponse, id: string): Promise<void> {
  const body = await readBody(req);
  const result = deleteProject(id, String(body.confirmName ?? ''));
  return json(res, result.ok ? 200 : 400, result.ok ? { success: true } : { error: result.error });
}


async function handleProjectSettings(req: http.IncomingMessage, res: http.ServerResponse, projectId: string): Promise<void> {
  if (!getProject(projectId)) return json(res, 404, { error: 'projeto nao encontrado' });
  const body = await readBody(req);
  const patch: Parameters<typeof updateProjectSettings>[1] = {};
  if (body.defaultModel === null) {
    patch.default_model = null;
    patch.default_provider = null;
  } else if (typeof body.defaultModel === 'string') {
    const model = getAvailableModels().find(item => item.id === body.defaultModel);
    if (!model) throw new HttpError(400, 'Modelo invalido.');
    patch.default_model = model.id;
    patch.default_provider = model.provider;
  }
  if (body.shellMode === null || body.shellMode === 'auto' || body.shellMode === 'confirm' || body.shellMode === 'off') {
    patch.shell_mode = body.shellMode as string | null;
  }
  if (body.delegationTimeoutSec === null) patch.delegation_timeout_sec = null;
  else if (typeof body.delegationTimeoutSec === 'number' && body.delegationTimeoutSec >= 10 && body.delegationTimeoutSec <= 3600) {
    patch.delegation_timeout_sec = Math.floor(body.delegationTimeoutSec);
  }
  if (body.maxConcurrency === null) patch.max_concurrency = null;
  else if (typeof body.maxConcurrency === 'number' && body.maxConcurrency >= 1 && body.maxConcurrency <= 16) {
    patch.max_concurrency = Math.floor(body.maxConcurrency);
  }
  if (typeof body.memoryEnabled === 'boolean') patch.memory_enabled = body.memoryEnabled ? 1 : 0;
  const settings = updateProjectSettings(projectId, patch);
  auditEvent(projectId, 'settings.update', 'project', projectId, { fields: Object.keys(patch) });
  json(res, 200, { settings });
}

async function handleDeleteConversationData(req: http.IncomingMessage, res: http.ServerResponse, conversationId: string): Promise<void> {
  const body = await readBody(req);
  const row = getDb().prepare(`SELECT COALESCE(project_id, 'legacy') AS projectId FROM conversations WHERE id = ?`)
    .get(conversationId) as { projectId: string } | undefined;
  if (!row) return json(res, 404, { error: 'conversa nao encontrada' });
  deleteProjectConversation(row.projectId, conversationId, String(body.confirmId ?? ''));
  json(res, 200, { success: true });
}

function downloadProjectExport(res: http.ServerResponse, projectId: string): void {
  const project = getProject(projectId);
  if (!project) throw new ProjectDataError(404, 'Projeto nao encontrado.');
  const body = Buffer.from(JSON.stringify(exportProjectData(projectId), null, 2));
  const safeName = project.slug.replace(/[^a-z0-9-]/gi, '-');
  setSecurityHeaders(res);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(body.length));
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}-export.json"`);
  res.writeHead(200);
  res.end(body);
}

function downloadProjectBackup(res: http.ServerResponse, projectId: string, backupId: string): void {
  const backup = readProjectBackup(projectId, backupId);
  setSecurityHeaders(res);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(backup.body.length));
  res.setHeader('Content-Disposition', `attachment; filename="${backup.filename}"`);
  res.writeHead(200);
  res.end(backup.body);
}

function apiDiagnostics(): unknown {
  const db = getDb();
  const quick = db.pragma('quick_check') as Array<Record<string, unknown>>;
  const counts: Record<string, number> = {};
  for (const table of ['projects', 'conversations', 'messages', 'runs', 'tasks', 'usage_events', 'audit_events']) {
    counts[table] = Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
  }
  return {
    status: quick.every(row => Object.values(row).includes('ok')) ? 'healthy' : 'degraded',
    version: '3.0.0',
    uptimeSec: Math.floor(process.uptime()),
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    database: { quickCheck: quick, counts },
    web: {
      bind: LOOPBACK_HOST,
      remoteAccess: !!getConfig().web.publicUrl,
      sessionAuth: true,
      passwordConfigured: webSecurity?.passwordConfigured ?? false,
      trustProxy: getConfig().web.trustProxy,
      sessionTtlMinutes: getConfig().web.sessionTtlMinutes,
      capabilities: getConfig().web.capabilities,
    },
    generatedAt: new Date().toISOString(),
  };
}

// --- Conversations & runs ---

async function handleCreateConversation(req: http.IncomingMessage, res: http.ServerResponse, projectId: string): Promise<void> {
  if (!getProject(projectId)) return json(res, 404, { error: 'projeto nao encontrado' });
  const body = await readBody(req);
  const agentId = body.agentId != null ? String(body.agentId) : getConfig().defaultAgent;
  if (!/^[a-z0-9_-]+$/i.test(agentId)) throw new HttpError(400, 'agentId invalido');
  const agentConfig = getConfig().agents[agentId];
  if (!agentConfig) throw new HttpError(404, 'agente nao encontrado');
  assignAgentToProject(projectId, agentId, {
    role: agentConfig.role ?? null,
    team: agentConfig.team ?? null,
  });
  const conversationId = createProjectConversation(projectId, agentId, {
    title: body.title != null ? String(body.title) : undefined,
    createdBy: 'web',
  });
  json(res, 201, { conversationId });
}

async function handlePatchConversation(req: http.IncomingMessage, res: http.ServerResponse, id: string): Promise<void> {
  const body = await readBody(req);
  const ok = patchConversation(id, {
    title: body.title != null ? String(body.title) : undefined,
    pinned: typeof body.pinned === 'boolean' ? body.pinned : undefined,
    archived: typeof body.archived === 'boolean' ? body.archived : undefined,
  });
  json(res, ok ? 200 : 404, { success: ok });
}

async function handlePostMessage(req: http.IncomingMessage, res: http.ServerResponse, conversationId: string): Promise<void> {
  const body = await readBody(req);
  const text = String(body.text ?? '').trim();
  if (!text) throw new HttpError(400, 'Texto da mensagem e obrigatorio');
  try {
    const { runId } = startChatRun({ conversationId, text });
    json(res, 202, { runId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'falha ao iniciar execucao';
    json(res, message.includes('execucao ativa') ? 409 : 404, { error: message });
  }
}

function apiRunEvents(runId: string, params: URLSearchParams): unknown | null {
  const run = getRun(runId);
  if (!run) return null;
  const after = Math.max(0, Number(params.get('after') ?? '0') || 0);
  return { run, events: listRunEvents(runId, after) };
}

async function handleConfirm(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await readBody(req);
  const id = String(body.id ?? '');
  const raw = String(body.answer ?? 'n');
  const answer: ConfirmAnswer = raw === 'a' || raw === 'always' ? 'always' : raw === 's' || raw === 'yes' ? 'yes' : 'no';
  const ok = resolveConfirmation(id, answer);
  json(res, ok ? 200 : 404, { success: ok });
}

// --- SSE ---

function handleSse(res: http.ServerResponse): void {
  setSecurityHeaders(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write(':ok\n\n');
  sseClients.add(res);
  res.on('close', () => sseClients.delete(res));
}

function broadcast(event: BusEvent): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    client.write(data);
  }
}

function serveProjectRaw(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId: string,
  filePath: string,
): void {
  const file = readProjectRawFile(projectId, filePath);
  setSecurityHeaders(res);
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; frame-ancestors 'self'");
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Length', String(file.size));
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  res.setHeader('ETag', file.etag);
  if (req.headers['if-none-match'] === file.etag) {
    res.writeHead(304);
    res.end();
    return;
  }
  res.writeHead(200);
  fs.createReadStream(file.absolute).pipe(res);
}

// --- Static files ---

function serveStatic(urlPath: string, res: http.ServerResponse): void {
  let filePath: string;
  if (urlPath === '/vendor/lucide.js') {
    filePath = LUCIDE_FILE;
  } else {
    const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
    filePath = path.join(STATIC_DIR, rel);
    const relCheck = path.relative(STATIC_DIR, filePath);
    if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
      json(res, 404, { error: 'nao encontrado' });
      return;
    }
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    setSecurityHeaders(res);
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  setSecurityHeaders(res);
  res.setHeader('Cache-Control', 'no-cache');
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(filePath));
}

// --- Server lifecycle ---

export function startWebServer(): void {
  const config = getConfig();
  if (!config.web.enabled || server) return;
  const security = new WebSecurity(config.web, SESSION_TOKEN);
  webSecurity = security;

  unsubscribeBus = onBusEvent(broadcast);
  onPendingChange(() => {
    emitBus('confirmations', { pending: getPendingConfirmations() });
  });

  sseKeepAlive = setInterval(() => {
    for (const client of sseClients) client.write(':ka\n\n');
  }, 25_000);

  server = http.createServer(async (req, res) => {
    try {
      setSecurityHeaders(res);
      if (!security.isAllowedHost(req.headers.host, config.web.port)) {
        return json(res, 403, { error: 'host nao permitido' });
      }

      const method = req.method ?? 'GET';
      if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) {
        res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
        return json(res, 405, { error: 'metodo nao permitido' });
      }
      if (!security.hasTrustedForwarding(req)) {
        return json(res, 403, { error: 'proxy HTTPS confiavel obrigatorio' });
      }
      if (method !== 'GET' && !security.isTrustedMutation(req, config.web.port)) {
        return json(res, 403, { error: 'origem nao permitida' });
      }

      const url = new URL(req.url ?? '/', 'http://localhost');
      const p = url.pathname;

      const loginAssets = ['/login', '/login.html', '/login.js', '/login.css', '/tokens.css', '/foundations.css', '/components.css', '/style.css'];
      if (method === 'GET' && loginAssets.includes(p)) return serveStatic(p === '/login' ? '/login.html' : p, res);
      if (method === 'POST' && p === '/api/auth/login') {
        const body = await readBody(req);
        const result = security.login(req, String(body.password ?? ''));
        if (result.cookie) res.setHeader('Set-Cookie', result.cookie);
        return json(res, result.status, result.error ? { error: result.error } : { success: true, expiresAt: result.expiresAt });
      }
      if (method === 'GET' && p === '/api/auth/status') {
        return json(res, 200, {
          authenticated: security.authenticate(req),
          remoteConfigured: security.remoteConfigured,
          passwordConfigured: security.passwordConfigured,
        });
      }

      const urlToken = url.searchParams.get('token');
      if (method === 'GET' && p === '/' && urlToken !== null) {
        if (!tokensEqual(urlToken, SESSION_TOKEN)) {
          return json(res, 403, { error: 'token de sessao invalido' });
        }
        res.writeHead(303, {
          'Location': '/',
          'Set-Cookie': security.issueSession(req).cookie,
          'Cache-Control': 'no-store',
        });
        res.end();
        return;
      }

      if (!security.authenticate(req)) {
        if (method === 'GET' && !p.startsWith('/api/') && security.isRemoteRequest(req)) {
          res.writeHead(303, { Location: '/login', 'Cache-Control': 'no-store' });
          res.end();
          return;
        }
        return json(res, 401, { error: security.isRemoteRequest(req) ? 'autenticacao necessaria' : 'abra o link seguro exibido no terminal' });
      }

      if (method === 'POST' && p === '/api/auth/logout') {
        res.setHeader('Set-Cookie', security.logout(req));
        return json(res, 200, { success: true });
      }

      const permission = security.allowRequest(req, p, method);
      if (!permission.ok) return json(res, permission.status ?? 403, { error: permission.error });

      if (method === 'GET' && p === '/api/events') return handleSse(res);
      if (method === 'GET' && p === '/api/state') return json(res, 200, apiState());
      if (method === 'GET' && p === '/api/analytics') return json(res, 200, apiAnalytics(url.searchParams));
      if (method === 'GET' && p === '/api/tasks') return json(res, 200, listTaskRows());
      if (method === 'GET' && p === '/api/skills') return json(res, 200, listSkillMetas().map(s => ({ id: s.id, name: s.name, description: s.description })));
      if (method === 'GET' && p === '/api/schedules') return json(res, 200, apiSchedules());
      if (method === 'GET' && p === '/api/groups') return json(res, 200, apiGroups());
      if (method === 'GET' && p === '/api/models') return json(res, 200, getAvailableModels());
      if (method === 'GET' && p === '/api/profile') return json(res, 200, { profile: readUserProfile() });
      if (method === 'GET' && p === '/api/diagnostics') return json(res, 200, apiDiagnostics());
      if (method === 'GET' && p === '/api/audit') return json(res, 200, listAuditEvents(url.searchParams.get('project') ?? undefined));

      const agentMatch = p.match(/^\/api\/agents\/([a-z0-9_-]+)$/);
      if (method === 'GET' && agentMatch) {
        const data = apiAgent(agentMatch[1]);
        return data ? json(res, 200, data) : json(res, 404, { error: 'agente nao encontrado' });
      }

      const convMatch = p.match(/^\/api\/conversations\/([a-f0-9-]+)$/);
      if (method === 'GET' && convMatch) {
        const conversation = apiConversation(convMatch[1]);
        return conversation ? json(res, 200, conversation) : json(res, 404, { error: 'conversa nao encontrada' });
      }

      // --- Projects ---
      if (method === 'GET' && p === '/api/project-templates') return json(res, 200, listProjectTemplates());
      if (method === 'GET' && p === '/api/projects') return json(res, 200, apiProjects(url.searchParams));
      if (method === 'POST' && p === '/api/projects') return await handleCreateProject(req, res);

      const projectFilesMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/files$/i);
      if (method === 'GET' && projectFilesMatch) {
        return json(res, 200, listProjectFiles(projectFilesMatch[1], url.searchParams.get('path') ?? ''));
      }
      if (method === 'POST' && projectFilesMatch) {
        const body = await readBody(req);
        if (body.kind !== 'directory') throw new HttpError(400, 'Tipo de item invalido.');
        const result = createProjectDirectory(projectFilesMatch[1], String(body.path ?? ''));
        auditEvent(projectFilesMatch[1], 'file.create_directory', 'file', result.path);
        return json(res, 201, result);
      }

      const projectRawMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/file\/raw$/i);
      if (method === 'GET' && projectRawMatch) {
        return serveProjectRaw(req, res, projectRawMatch[1], url.searchParams.get('path') ?? '');
      }

      const projectFileMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/file$/i);
      if (method === 'GET' && projectFileMatch) {
        return json(res, 200, readProjectFile(projectFileMatch[1], url.searchParams.get('path') ?? ''));
      }
      if (method === 'PATCH' && projectFileMatch) {
        const body = await readBody(req);
        if (typeof body.content !== 'string') throw new HttpError(400, 'Conteudo textual obrigatorio.');
        const create = req.headers['if-none-match'] === '*';
        const expectedEtag = typeof req.headers['if-match'] === 'string' ? req.headers['if-match'] : null;
        const document = writeProjectFile(projectFileMatch[1], String(body.path ?? ''), body.content, { create, expectedEtag });
        auditEvent(projectFileMatch[1], create ? 'file.create' : 'file.update', 'file', document.path, { bytes: document.size });
        return json(res, create ? 201 : 200, { document });
      }
      if (method === 'DELETE' && projectFileMatch) {
        const body = await readBody(req);
        const expectedEtag = typeof req.headers['if-match'] === 'string' ? req.headers['if-match'] : null;
        const result = deleteProjectPath(projectFileMatch[1], String(body.path ?? ''), String(body.confirmPath ?? ''), expectedEtag);
        auditEvent(projectFileMatch[1], 'file.delete', 'file', result.path, { kind: result.kind });
        return json(res, 200, { success: true, ...result });
      }

      const projectFileRenameMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/file\/rename$/i);
      if (method === 'POST' && projectFileRenameMatch) {
        const body = await readBody(req);
        const expectedEtag = typeof req.headers['if-match'] === 'string' ? req.headers['if-match'] : null;
        const result = renameProjectPath(projectFileRenameMatch[1], String(body.path ?? ''), String(body.destination ?? ''), expectedEtag);
        auditEvent(projectFileRenameMatch[1], 'file.rename', 'file', result.path, { source: String(body.path ?? '') });
        return json(res, 200, result);
      }

      const projectSearchMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/search$/i);
      if (method === 'GET' && projectSearchMatch) {
        return json(res, 200, searchProjectFiles(projectSearchMatch[1], url.searchParams.get('q') ?? ''));
      }

      const projectDiffMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/diff$/i);
      if (method === 'GET' && projectDiffMatch) {
        return json(res, 200, diffProjectFile(projectDiffMatch[1], url.searchParams.get('path') ?? ''));
      }


      const projectMemoriesMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/memories$/i);
      if (projectMemoriesMatch) {
        const projectId = projectMemoriesMatch[1];
        if (method === 'GET') return json(res, 200, listProjectMemories(projectId));
        if (method === 'DELETE') {
          const body = await readBody(req);
          const removed = clearProjectMemories(projectId, String(body.confirmName ?? ''));
          return json(res, 200, { success: true, removed });
        }
      }

      const projectMemoryMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/memory$/i);
      if (projectMemoryMatch) {
        const projectId = projectMemoryMatch[1];
        const memoryId = url.searchParams.get('id') ?? '';
        if (method === 'GET') return json(res, 200, readProjectMemory(projectId, memoryId));
        if (method === 'DELETE') {
          const body = await readBody(req);
          const removed = deleteProjectMemory(projectId, memoryId, String(body.confirmId ?? ''));
          return json(res, 200, { success: true, removed });
        }
      }

      const projectBackupsMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/backups$/i);
      if (projectBackupsMatch) {
        if (method === 'GET') return json(res, 200, listProjectBackups(projectBackupsMatch[1]));
        if (method === 'POST') return json(res, 201, createProjectBackup(projectBackupsMatch[1]));
      }

      const projectBackupMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/backup$/i);
      if (projectBackupMatch) {
        const backupId = url.searchParams.get('id') ?? '';
        if (method === 'GET') return downloadProjectBackup(res, projectBackupMatch[1], backupId);
        if (method === 'DELETE') {
          const body = await readBody(req);
          deleteProjectBackup(projectBackupMatch[1], backupId, String(body.confirmId ?? ''));
          return json(res, 200, { success: true });
        }
      }

      const projectExportMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/export$/i);
      if (method === 'GET' && projectExportMatch) return downloadProjectExport(res, projectExportMatch[1]);

      const projectSettingsMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/settings$/i);
      if (method === 'PATCH' && projectSettingsMatch) return await handleProjectSettings(req, res, projectSettingsMatch[1]);

      const projectAuditMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/audit$/i);
      if (method === 'GET' && projectAuditMatch) return json(res, 200, listAuditEvents(projectAuditMatch[1]));

      const projMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})$/i);
      if (projMatch) {
        const pid = projMatch[1];
        if (method === 'GET') {
          const data = apiProjectDetail(pid);
          return data ? json(res, 200, data) : json(res, 404, { error: 'projeto nao encontrado' });
        }
        if (method === 'PATCH') return await handlePatchProject(req, res, pid);
        if (method === 'DELETE') return await handleDeleteProject(req, res, pid);
      }

      const projArchiveMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/archive$/i);
      if (method === 'POST' && projArchiveMatch) {
        const ok = archiveProject(projArchiveMatch[1]);
        return json(res, ok ? 200 : 404, { success: ok });
      }

      const projConvMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/conversations$/i);
      if (projConvMatch) {
        const pid = projConvMatch[1];
        if (method === 'GET') {
          if (!getProject(pid)) return json(res, 404, { error: 'projeto nao encontrado' });
          return json(res, 200, listProjectConversations(pid, { includeArchived: true }));
        }
        if (method === 'POST') return await handleCreateConversation(req, res, pid);
      }

      // --- Conversations (project-scoped) & runs ---
      const convScopedMatch = p.match(/^\/api\/conversations\/([a-f0-9-]+)$/);
      if (method === 'PATCH' && convScopedMatch) return await handlePatchConversation(req, res, convScopedMatch[1]);
      if (method === 'DELETE' && convScopedMatch) return await handleDeleteConversationData(req, res, convScopedMatch[1]);

      const convForkMatch = p.match(/^\/api\/conversations\/([a-f0-9-]+)\/fork$/);
      if (method === 'POST' && convForkMatch) {
        const newId = forkConversation(convForkMatch[1]);
        return newId ? json(res, 201, { conversationId: newId }) : json(res, 404, { error: 'conversa nao encontrada' });
      }

      const convMsgMatch = p.match(/^\/api\/conversations\/([a-f0-9-]+)\/messages$/);
      if (method === 'POST' && convMsgMatch) return await handlePostMessage(req, res, convMsgMatch[1]);

      const runEventsMatch = p.match(/^\/api\/runs\/([a-f0-9-]+)\/events$/);
      if (method === 'GET' && runEventsMatch) {
        const data = apiRunEvents(runEventsMatch[1], url.searchParams);
        return data ? json(res, 200, data) : json(res, 404, { error: 'run nao encontrado' });
      }

      const runCancelMatch = p.match(/^\/api\/runs\/([a-f0-9-]+)\/cancel$/);
      if (method === 'POST' && runCancelMatch) {
        const ok = cancelRun(runCancelMatch[1]);
        return json(res, ok ? 200 : 404, { success: ok });
      }

      if (method === 'POST' && p === '/api/settings') return await handleSettings(req, res);
      if (method === 'POST' && p === '/api/confirm') return await handleConfirm(req, res);
      if (method === 'POST' && p === '/api/delegations/cancel') {
        const body = await readBody(req);
        const ok = cancelDelegation(String(body.id ?? ''));
        return json(res, ok ? 200 : 404, { success: ok });
      }

      if (p.startsWith('/api/')) return json(res, 404, { error: 'endpoint desconhecido' });
      if (method === 'GET') return serveStatic(p, res);

      res.setHeader('Allow', 'GET');
      return json(res, 405, { error: 'metodo nao permitido' });
    } catch (error) {
      const status = error instanceof HttpError || error instanceof ProjectFileError || error instanceof ProjectDataError || error instanceof ProjectBackupError ? error.status : 500;
      json(res, status, { error: error instanceof Error ? error.message : 'erro interno' });
    }
  });

  server.listen(config.web.port, LOOPBACK_HOST);
  server.on('error', (err) => {
    console.error(`[Web] Painel nao pode iniciar na porta ${config.web.port}: ${err.message}`);
    server = null;
  });
}

export function stopWebServer(): void {
  if (sseKeepAlive) {
    clearInterval(sseKeepAlive);
    sseKeepAlive = null;
  }
  for (const client of sseClients) {
    client.end();
  }
  sseClients.clear();
  unsubscribeBus?.();
  unsubscribeBus = null;
  if (server) {
    server.close();
    server = null;
  }
  webSecurity = null;
}
