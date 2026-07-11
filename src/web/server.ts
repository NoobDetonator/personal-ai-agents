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

// web/ estatico fica na raiz do projeto (fora de src/, sem build)
const STATIC_DIR = path.join(process.cwd(), 'web');
const LUCIDE_FILE = path.join(process.cwd(), 'node_modules', 'lucide', 'dist', 'umd', 'lucide.min.js');
const LOOPBACK_HOST = '127.0.0.1';
const MAX_BODY_BYTES = 64 * 1024;
const SESSION_COOKIE = 'paa_session';
const SESSION_TOKEN = randomBytes(32).toString('hex');

let server: http.Server | null = null;
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

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function isAllowedHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  try {
    const parsed = new URL(`http://${host}`);
    const parsedPort = parsed.port ? Number(parsed.port) : 80;
    return isLoopbackHostname(parsed.hostname) && parsedPort === port;
  } catch {
    return false;
  }
}

function isTrustedMutationRequest(req: http.IncomingMessage, port: number): boolean {
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite === 'cross-site') return false;

  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const parsedPort = parsed.port ? Number(parsed.port) : 80;
    return parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname) && parsedPort === port;
  } catch {
    return false;
  }
}

function tokensEqual(candidate: string | undefined, expected: string): boolean {
  if (!candidate) return false;
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return candidateBuffer.length === expectedBuffer.length && timingSafeEqual(candidateBuffer, expectedBuffer);
}

function hasValidSession(req: http.IncomingMessage): boolean {
  const bearer = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
  if (tokensEqual(bearer, SESSION_TOKEN)) return true;

  const cookieHeader = req.headers.cookie ?? '';
  const sessionCookie = cookieHeader
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  return tokensEqual(sessionCookie, SESSION_TOKEN);
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

  const agents = Object.entries(config.agents).map(([id, cfg]) => ({
    id,
    name: cfg.name,
    team: cfg.team ?? null,
  }));

  return getAnalytics(getDb(), agents, {
    range,
    agent: agent && idPattern.test(agent) ? agent : undefined,
    team: team && idPattern.test(team) ? team : undefined,
  });
}

function apiConversation(id: string): unknown {
  const db = getDb();
  const messages = db.prepare(
    `SELECT role, content, agent_id, input_tokens, output_tokens, created_at
     FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 300`
  ).all(id);
  return { id, messages };
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
      if (!isAllowedHost(req.headers.host, config.web.port)) {
        return json(res, 403, { error: 'host nao permitido' });
      }

      const method = req.method ?? 'GET';
      if (!['GET', 'POST'].includes(method)) {
        res.setHeader('Allow', 'GET, POST');
        return json(res, 405, { error: 'metodo nao permitido' });
      }
      if (method === 'POST' && !isTrustedMutationRequest(req, config.web.port)) {
        return json(res, 403, { error: 'origem nao permitida' });
      }

      const url = new URL(req.url ?? '/', 'http://localhost');
      const p = url.pathname;

      const urlToken = url.searchParams.get('token');
      if (method === 'GET' && p === '/' && urlToken !== null) {
        if (!tokensEqual(urlToken, SESSION_TOKEN)) {
          return json(res, 403, { error: 'token de sessao invalido' });
        }
        res.writeHead(303, {
          'Location': '/',
          'Set-Cookie': `${SESSION_COOKIE}=${SESSION_TOKEN}; HttpOnly; SameSite=Strict; Path=/`,
          'Cache-Control': 'no-store',
        });
        res.end();
        return;
      }

      if (!hasValidSession(req)) {
        return json(res, 401, { error: 'abra o link seguro exibido no terminal' });
      }

      if (method === 'GET' && p === '/api/events') return handleSse(res);
      if (method === 'GET' && p === '/api/state') return json(res, 200, apiState());
      if (method === 'GET' && p === '/api/analytics') return json(res, 200, apiAnalytics(url.searchParams));
      if (method === 'GET' && p === '/api/tasks') return json(res, 200, listTaskRows());
      if (method === 'GET' && p === '/api/skills') return json(res, 200, listSkillMetas().map(s => ({ id: s.id, name: s.name, description: s.description })));
      if (method === 'GET' && p === '/api/schedules') return json(res, 200, apiSchedules());
      if (method === 'GET' && p === '/api/groups') return json(res, 200, apiGroups());
      if (method === 'GET' && p === '/api/models') return json(res, 200, getAvailableModels());
      if (method === 'GET' && p === '/api/profile') return json(res, 200, { profile: readUserProfile() });

      const agentMatch = p.match(/^\/api\/agents\/([a-z0-9_-]+)$/);
      if (method === 'GET' && agentMatch) {
        const data = apiAgent(agentMatch[1]);
        return data ? json(res, 200, data) : json(res, 404, { error: 'agente nao encontrado' });
      }

      const convMatch = p.match(/^\/api\/conversations\/([a-f0-9-]+)$/);
      if (method === 'GET' && convMatch) return json(res, 200, apiConversation(convMatch[1]));

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
      const status = error instanceof HttpError ? error.status : 500;
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
}
