import type http from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { auditEvent } from '../projects/data-service.js';

export type RemoteCapability = 'chat' | 'files' | 'memory' | 'settings';

export interface WebSecurityConfig {
  publicUrl: string | null;
  trustProxy: boolean;
  sessionTtlMinutes: number;
  capabilities: Record<RemoteCapability, boolean>;
}

interface Session { expiresAt: number; createdAt: number; ip: string; }
interface RateBucket { count: number; resetAt: number; }

const SESSION_COOKIE = 'paa_session';

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  return normalized === '127.0.0.1' || normalized === '::1';
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function safeEqual(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function passwordDigest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf-8').digest();
}

export class WebSecurity {
  private readonly sessions = new Map<string, Session>();
  private readonly rateBuckets = new Map<string, RateBucket>();
  private readonly password = process.env.PAA_WEB_PASSWORD ?? '';

  constructor(
    private readonly config: WebSecurityConfig,
    private readonly bootstrapToken: string,
  ) {}

  get remoteConfigured(): boolean { return !!this.config.publicUrl; }
  get passwordConfigured(): boolean { return this.password.length >= 12; }

  publicOrigin(): string | null {
    return this.config.publicUrl ? new URL(this.config.publicUrl).origin : null;
  }

  clientIp(req: http.IncomingMessage): string {
    if (this.config.trustProxy && isLoopbackAddress(req.socket.remoteAddress)) {
      const forwarded = req.headers['x-forwarded-for'];
      const candidate = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
      if (candidate && /^[a-f0-9:.]{3,64}$/i.test(candidate)) return candidate;
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  isRemoteRequest(req: http.IncomingMessage): boolean {
    const host = req.headers.host;
    if (!host) return false;
    try { return !isLoopbackHostname(new URL(`http://${host}`).hostname); } catch { return true; }
  }

  isAllowedHost(host: string | undefined, port: number): boolean {
    if (!host) return false;
    try {
      const parsed = new URL(`http://${host}`);
      const parsedPort = parsed.port ? Number(parsed.port) : 80;
      if (isLoopbackHostname(parsed.hostname)) return parsedPort === port;
      if (!this.config.publicUrl) return false;
      const publicUrl = new URL(this.config.publicUrl);
      return parsed.hostname.toLowerCase() === publicUrl.hostname.toLowerCase()
        && (parsed.port || (publicUrl.port || '443')) === (publicUrl.port || '443');
    } catch { return false; }
  }

  hasTrustedForwarding(req: http.IncomingMessage): boolean {
    if (!this.isRemoteRequest(req)) return true;
    if (!this.config.trustProxy || !isLoopbackAddress(req.socket.remoteAddress)) return false;
    return req.headers['x-forwarded-proto'] === 'https';
  }

  isTrustedMutation(req: http.IncomingMessage, port: number): boolean {
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    const origin = req.headers.origin;
    if (!origin) return !this.isRemoteRequest(req);
    try {
      const parsed = new URL(origin);
      const parsedPort = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
      if (parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname) && parsedPort === port) return true;
      return !!this.publicOrigin() && parsed.origin === this.publicOrigin();
    } catch { return false; }
  }

  authenticate(req: http.IncomingMessage): boolean {
    const bearer = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (isLoopbackAddress(req.socket.remoteAddress) && safeEqual(bearer, this.bootstrapToken)) return true;
    const token = this.cookieToken(req);
    if (!token) return false;
    const session = this.sessions.get(token);
    if (!session) return false;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      auditEvent(null, 'auth.session_expired', 'session', null, { ip: this.clientIp(req) });
      return false;
    }
    return true;
  }

  issueSession(req: http.IncomingMessage): { token: string; expiresAt: number; cookie: string } {
    const token = randomBytes(32).toString('hex');
    const ttlMs = this.config.sessionTtlMinutes * 60_000;
    const expiresAt = Date.now() + ttlMs;
    this.sessions.set(token, { createdAt: Date.now(), expiresAt, ip: this.clientIp(req) });
    const secure = this.isRemoteRequest(req) ? '; Secure' : '';
    const maxAge = Math.max(1, Math.floor(ttlMs / 1000));
    return { token, expiresAt, cookie: `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}` };
  }

  login(req: http.IncomingMessage, password: string): { status: number; error?: string; cookie?: string; expiresAt?: number } {
    const ip = this.clientIp(req);
    if (!this.passwordConfigured) return { status: 503, error: 'Defina PAA_WEB_PASSWORD com pelo menos 12 caracteres.' };
    if (!this.consumeRate(ip, 'login', 5, 15 * 60_000)) {
      auditEvent(null, 'auth.rate_limited', 'login', null, { ip });
      return { status: 429, error: 'Muitas tentativas. Aguarde antes de tentar novamente.' };
    }
    const valid = timingSafeEqual(passwordDigest(password), passwordDigest(this.password));
    if (!valid) {
      auditEvent(null, 'auth.login_failed', 'login', null, { ip });
      return { status: 401, error: 'Credenciais invalidas.' };
    }
    const session = this.issueSession(req);
    auditEvent(null, 'auth.login_success', 'session', null, { ip, expiresAt: session.expiresAt });
    return { status: 200, cookie: session.cookie, expiresAt: session.expiresAt };
  }

  logout(req: http.IncomingMessage): string {
    const token = this.cookieToken(req);
    if (token) this.sessions.delete(token);
    auditEvent(null, 'auth.logout', 'session', null, { ip: this.clientIp(req) });
    const secure = this.isRemoteRequest(req) ? '; Secure' : '';
    return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`;
  }

  allowRequest(req: http.IncomingMessage, pathname: string, method: string): { ok: boolean; status?: number; error?: string } {
    const ip = this.clientIp(req);
    if (!this.consumeRate(ip, method === 'GET' ? 'read' : 'mutation', method === 'GET' ? 600 : 120, 60_000)) {
      auditEvent(null, 'http.rate_limited', 'request', pathname, { ip, method });
      return { ok: false, status: 429, error: 'Limite de requisicoes excedido.' };
    }
    if (!this.isRemoteRequest(req)) return { ok: true };
    const capability = this.capabilityForPath(pathname, method);
    if (capability && !this.config.capabilities[capability]) {
      auditEvent(null, 'permission.denied', capability, pathname, { ip, method });
      return { ok: false, status: 403, error: `Capacidade remota desativada: ${capability}.` };
    }
    return { ok: true };
  }

  private capabilityForPath(pathname: string, method: string): RemoteCapability | null {
    if (pathname === '/api/settings' || pathname === '/api/diagnostics' || pathname === '/api/audit' || pathname === '/api/project-templates') return 'settings';
    if (pathname === '/api/projects' && method !== 'GET') return 'settings';
    if (/^\/api\/projects\/[^/]+(?:\/archive)?$/.test(pathname) && method !== 'GET') return 'settings';
    if (/\/api\/projects\/[^/]+\/settings$/.test(pathname)) return 'settings';
    if (/\/api\/projects\/[^/]+\/(export|backup|backups)$/.test(pathname)) return 'settings';

    if (pathname === '/api/events' || pathname === '/api/confirm'
      || pathname.startsWith('/api/conversations/') || pathname.startsWith('/api/runs/')
      || pathname.startsWith('/api/delegations/') || /\/api\/projects\/[^/]+\/conversations(?:\/|$)/.test(pathname)) return 'chat';
    if (['/api/state', '/api/analytics', '/api/tasks', '/api/skills', '/api/schedules', '/api/groups', '/api/models', '/api/profile'].includes(pathname)
      || pathname.startsWith('/api/agents/')) return 'chat';

    if (/\/api\/projects\/[^/]+\/(files|file|search|diff)(?:\/|$)/.test(pathname)) return 'files';
    if (/\/api\/projects\/[^/]+\/(memories|memory|audit|vault)(?:\/|$)/.test(pathname)) return 'memory';
    return null;
  }

  private cookieToken(req: http.IncomingMessage): string | undefined {
    return (req.headers.cookie ?? '').split(';').map(part => part.trim())
      .find(part => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  }

  private consumeRate(ip: string, scope: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const key = `${ip}:${scope}`;
    const current = this.rateBuckets.get(key);
    if (!current || current.resetAt <= now) {
      this.rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    current.count++;
    return current.count <= limit;
  }
}
