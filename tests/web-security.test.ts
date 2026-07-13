import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

let loader: typeof import('../src/config/loader.js');
let connection: typeof import('../src/db/connection.js');
let server: typeof import('../src/web/server.js');
let projects: typeof import('../src/projects/service.js');
let data: typeof import('../src/projects/data-service.js');
let base: string;
let publicHeaders: Record<string, string>;
let projectId: string;

async function request(pathname: string, options: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
  const target = new URL(base);
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  return await new Promise<{ response: { status: number; headers: { get(name: string): string | null } }; json: any }>((resolve, reject) => {
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      path: pathname,
      method: options.method ?? 'GET',
      headers: {
        ...publicHeaders,
        ...(body !== undefined ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(options.cookie ? { Cookie: options.cookie } : {}),
        ...options.headers,
      },
    }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let json: any = null;
        try { json = JSON.parse(raw); } catch { /* resposta HTML/redirecionamento */ }
        resolve({ response: {
          status: response.statusCode ?? 0,
          headers: { get: name => {
            const value = response.headers[name.toLowerCase()];
            return Array.isArray(value) ? value.join(', ') : value ?? null;
          } },
        }, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

before(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-web-security-'));
  process.chdir(root);
  process.env.PAA_WEB_PASSWORD = 'senha-remota-forte-123456';
  loader = await import('../src/config/loader.js');
  connection = await import('../src/db/connection.js');
  server = await import('../src/web/server.js');
  projects = await import('../src/projects/service.js');
  data = await import('../src/projects/data-service.js');
  loader.loadConfig();
  const port = 5000 + Math.floor(Math.random() * 500);
  loader.updateConfig({ web: {
    ...loader.getConfig().web,
    enabled: true,
    port,
    publicUrl: 'https://agents.example.test',
    trustProxy: true,
    sessionTtlMinutes: 0.002,
    capabilities: { chat: true, files: false, memory: true, settings: false },
  } });
  connection.initDatabase();
  projectId = projects.createProject({ name: 'Seguranca Remota' }).id;
  server.startWebServer();
  base = `http://127.0.0.1:${port}`;
  publicHeaders = {
    Host: 'agents.example.test',
    Origin: 'https://agents.example.test',
    'X-Forwarded-Proto': 'https',
    'X-Forwarded-For': '2001:db8::10',
  };
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const result = await request('/api/auth/status');
      if (result.response.status === 200) break;
    } catch { /* subindo */ }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
});

after(() => {
  server.stopWebServer();
  connection.closeDatabase();
  delete process.env.PAA_WEB_PASSWORD;
});

test('host desconhecido, proxy sem HTTPS e CSRF sao bloqueados antes do login', async () => {
  const badHost = await request('/api/auth/status', { headers: { Host: 'evil.example' } });
  assert.equal(badHost.response.status, 403);
  const insecure = await request('/api/auth/status', { headers: { 'X-Forwarded-Proto': 'http' } });
  assert.equal(insecure.response.status, 403);
  const csrf = await request('/api/auth/login', { method: 'POST', body: { password: 'qualquer' }, headers: { Origin: 'https://evil.example' } });
  assert.equal(csrf.response.status, 403);
});

test('login cria cookie seguro e permissoes remotas sao independentes', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: { password: 'senha-remota-forte-123456' } });
  assert.equal(login.response.status, 200);
  const setCookie = login.response.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /paa_session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Secure/i);
  const cookie = setCookie.split(';')[0];

  const localLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { password: 'senha-remota-forte-123456' },
    headers: { Host: `127.0.0.1:${new URL(base).port}`, Origin: `http://127.0.0.1:${new URL(base).port}` },
  });
  assert.equal(localLogin.response.status, 200);
  assert.doesNotMatch(localLogin.response.headers.get('set-cookie') ?? '', /; Secure/i);

  const projectsResponse = await request('/api/projects', { cookie });
  assert.equal(projectsResponse.response.status, 200);
  const files = await request(`/api/projects/${projectId}/files`, { cookie });
  assert.equal(files.response.status, 403);
  assert.match(files.json.error, /files/);
  const memories = await request(`/api/projects/${projectId}/memories`, { cookie });
  assert.equal(memories.response.status, 200);
  const diagnostics = await request('/api/diagnostics', { cookie });
  assert.equal(diagnostics.response.status, 403);
  const createProject = await request('/api/projects', { method: 'POST', body: { name: 'Negado' }, cookie });
  assert.equal(createProject.response.status, 403);
  const exportData = await request(`/api/projects/${projectId}/export`, { cookie });
  assert.equal(exportData.response.status, 403);
  const stateResponse = await request('/api/state', { cookie });
  assert.equal(stateResponse.response.status, 200);

  await new Promise(resolve => setTimeout(resolve, 180));
  const expired = await request('/api/projects', { cookie });
  assert.equal(expired.response.status, 401);
});

test('login aplica bloqueio apos cinco tentativas por IP', async () => {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    const result = await request('/api/auth/login', {
      method: 'POST',
      body: { password: 'senha-incorreta' },
      headers: { 'X-Forwarded-For': '2001:db8::20' },
    });
    lastStatus = result.response.status;
  }
  assert.equal(lastStatus, 429);
});

test('eventos de autenticacao, expiracao e permissao ficam auditados', () => {
  const events = data.listAuditEvents(undefined, 100) as Array<{ action: string }>;
  const actions = new Set(events.map(event => event.action));
  assert.ok(actions.has('auth.login_success'));
  assert.ok(actions.has('auth.login_failed'));
  assert.ok(actions.has('auth.rate_limited'));
  assert.ok(actions.has('auth.session_expired'));
  assert.ok(actions.has('permission.denied'));
});
