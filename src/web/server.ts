import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { getConfig } from '../config/loader.js';
import { getPendingConfirmations, onPendingChange } from '../chat/confirm.js';
import { onBusEvent, emitBus } from './bus.js';
import { WebSecurity } from './security.js';
import { HttpError, json, readBody, setSecurityHeaders } from './http.js';
import { serveStatic } from './static.js';
import { ProjectFileError } from '../projects/files-service.js';
import { ProjectDataError } from '../projects/data-service.js';
import { ProjectBackupError } from '../projects/backup-service.js';
import { broadcast, closeSseClients, keepAlive } from './sse.js';
import { routeAuthenticatedRequest } from './router.js';

const LOOPBACK_HOST = '127.0.0.1';
const SESSION_TOKEN = randomBytes(32).toString('hex');

let server: http.Server | null = null;
let unsubscribeBus: (() => void) | null = null;
let sseKeepAlive: NodeJS.Timeout | null = null;

function tokensEqual(candidate: string | undefined, expected: string): boolean {
  if (!candidate) return false;
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return candidateBuffer.length === expectedBuffer.length && timingSafeEqual(candidateBuffer, expectedBuffer);
}

export function getWebPanelUrl(port: number = getConfig().web.port): string {
  return `http://localhost:${port}/?token=${encodeURIComponent(SESSION_TOKEN)}`;
}
// --- Server lifecycle ---

export function startWebServer(): void {
  const config = getConfig();
  if (!config.web.enabled || server) return;
  const security = new WebSecurity(config.web, SESSION_TOKEN);

  unsubscribeBus = onBusEvent(broadcast);
  onPendingChange(() => {
    emitBus('confirmations', { pending: getPendingConfirmations() });
  });

  sseKeepAlive = setInterval(keepAlive, 25_000);

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

      return await routeAuthenticatedRequest(req, res, url, security);
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
  closeSseClients();
  unsubscribeBus?.();
  unsubscribeBus = null;
  if (server) {
    server.close();
    server = null;
  }
}
