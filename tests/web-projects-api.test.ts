import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// API HTTP de projetos/conversas/runs (Fase 2). Sobe o servidor real em
// loopback e dirige o fluxo sem LLM (runs de eventos criados diretamente).

let loader: typeof import('../src/config/loader.js');
let connection: typeof import('../src/db/connection.js');
let server: typeof import('../src/web/server.js');
let runHelpers: typeof import('../src/db/run-helpers.js');
let svc: typeof import('../src/projects/service.js');
let runService: typeof import('../src/chat/run-service.js');

let base: string;
let token: string;

async function api(method: string, pathname: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: any }> {
  const res = await fetch(base + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let parsed: unknown = null;
  try { parsed = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, json: parsed };
}

before(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-webapi-'));
  process.chdir(root);
  loader = await import('../src/config/loader.js');
  connection = await import('../src/db/connection.js');
  server = await import('../src/web/server.js');
  runHelpers = await import('../src/db/run-helpers.js');
  svc = await import('../src/projects/service.js');
  runService = await import('../src/chat/run-service.js');

  loader.loadConfig();
  const port = 3200 + Math.floor(Math.random() * 1500);
  loader.updateConfig({ web: { enabled: true, port } });
  connection.initDatabase();
  server.startWebServer();
  base = `http://127.0.0.1:${port}`;
  token = new URL(server.getWebPanelUrl()).searchParams.get('token')!;

  // aguarda o listen ficar pronto
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(base + '/api/projects', { headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 200) { await r.body?.cancel(); break; }
    } catch { /* ainda subindo */ }
    await new Promise(r => setTimeout(r, 20));
  }
});

after(() => {
  server.stopWebServer();
  connection.closeDatabase();
});

test('sem token válido retorna 401', async () => {
  const res = await fetch(base + '/api/projects');
  assert.equal(res.status, 401);
  await res.body?.cancel();
});

test('POST /api/projects cria projeto e lista inclui Legacy', async () => {
  const created = await api('POST', '/api/projects', { name: 'Web Projeto', createInitialConversation: true });
  assert.equal(created.status, 201);
  assert.ok(created.json.project.id);
  assert.ok(created.json.conversationId, 'conversa inicial criada');

  const list = await api('GET', '/api/projects');
  assert.equal(list.status, 200);
  const ids = (list.json as Array<{ id: string }>).map(p => p.id);
  assert.ok(ids.includes(created.json.project.id));
  assert.ok(ids.includes('legacy'));
});

test('fluxo conversa: criar, listar, PATCH', async () => {
  const proj = await api('POST', '/api/projects', { name: 'Conversas' });
  const pid = proj.json.project.id;

  const conv = await api('POST', `/api/projects/${pid}/conversations`, { title: 'Primeira' });
  assert.equal(conv.status, 201);
  const cid = conv.json.conversationId;

  const list = await api('GET', `/api/projects/${pid}/conversations`);
  assert.equal(list.status, 200);
  assert.equal((list.json as Array<unknown>).length, 1);

  const patched = await api('PATCH', `/api/conversations/${cid}`, { title: 'Renomeada', pinned: true });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.success, true);

  const detail = await api('GET', `/api/projects/${pid}`);
  const c = (detail.json.conversations as Array<{ id: string; title: string; pinned: number }>).find(x => x.id === cid)!;
  assert.equal(c.title, 'Renomeada');
  assert.equal(c.pinned, 1);
});

test('GET /api/runs/:id/events devolve run e eventos, com filtro after', async () => {
  const pid = svc.createProject({ name: 'Runs' }).id;
  const runId = runHelpers.createRun({ projectId: pid, agentId: 'aria', kind: 'chat' });
  runHelpers.appendRunEvent(runId, 'status', { status: 'running' });
  runHelpers.appendRunEvent(runId, 'text_delta', { text: 'oi' });
  runHelpers.finishRun(runId, { status: 'done' });

  const all = await api('GET', `/api/runs/${runId}/events`);
  assert.equal(all.status, 200);
  assert.equal(all.json.run.id, runId);
  assert.ok(all.json.events.length >= 3);

  const tail = await api('GET', `/api/runs/${runId}/events?after=1`);
  assert.ok((tail.json.events as Array<{ sequence: number }>).every(e => e.sequence > 1));

  const missing = await api('GET', '/api/runs/00000000-0000-4000-8000-000000000000/events');
  assert.equal(missing.status, 404);
});

test('POST /api/conversations/:id/messages em conversa inexistente retorna 404', async () => {
  const res = await api('POST', '/api/conversations/00000000-0000-4000-8000-000000000000/messages', { text: 'oi' });
  assert.equal(res.status, 404);
});

test('mutação com Origin cross-site é rejeitada (CSRF)', async () => {
  const res = await api('POST', '/api/projects', { name: 'x' }, { Origin: 'http://evil.example' });
  assert.equal(res.status, 403);
});

test('DELETE projeto exige confirmName exato', async () => {
  const proj = await api('POST', '/api/projects', { name: 'Remover' });
  const pid = proj.json.project.id;

  const wrong = await api('DELETE', `/api/projects/${pid}`, { confirmName: 'errado' });
  assert.equal(wrong.status, 400);

  const ok = await api('DELETE', `/api/projects/${pid}`, { confirmName: 'Remover' });
  assert.equal(ok.status, 200);

  const gone = await api('GET', `/api/projects/${pid}`);
  assert.equal(gone.status, 404);
});

async function waitRunTerminal(runId: string, timeoutMs = 3000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await api('GET', `/api/runs/${runId}/events`);
    if (r.json?.run && ['done', 'failed', 'cancelled', 'timed_out'].includes(r.json.run.status)) return r.json;
    await new Promise(res => setTimeout(res, 25));
  }
  throw new Error('run não terminou a tempo');
}

test('POST message dispara run, streaming persiste eventos e mensagem do assistente', async () => {
  // Executor de eco (sem LLM) para exercitar o fluxo HTTP de ponta a ponta.
  runService.setChatExecutorOverride(async ({ handlers }) => {
    handlers.onTextDelta('oi ');
    handlers.onToolCall('readFile');
    handlers.onTextDelta('pronto');
    return { text: 'oi pronto', inputTokens: 5, outputTokens: 2, cachedInputTokens: 0, toolCallCount: 1, finishReason: 'stop' };
  });

  const proj = await api('POST', '/api/projects', { name: 'ChatFlow' });
  const pid = proj.json.project.id;
  const conv = await api('POST', `/api/projects/${pid}/conversations`, {});
  const cid = conv.json.conversationId;

  const sent = await api('POST', `/api/conversations/${cid}/messages`, { text: 'ola' });
  assert.equal(sent.status, 202);
  const runId = sent.json.runId;
  assert.ok(runId);

  const finished = await waitRunTerminal(runId);
  assert.equal(finished.run.status, 'done');
  const types = finished.events.map((e: any) => e.type);
  assert.ok(types.includes('text_delta'));
  assert.ok(types.includes('tool_start'));

  const detail = await api('GET', `/api/conversations/${cid}`);
  const roles = detail.json.messages.map((m: any) => m.role);
  assert.deepEqual(roles, ['user', 'assistant']);
  assert.equal(detail.json.messages[1].content, 'oi pronto');
  assert.equal(detail.json.activeRun, null, 'run terminado não é activeRun');

  runService.setChatExecutorOverride(null);
});

test('fork duplica a conversa e DELETE remove', async () => {
  const proj = await api('POST', '/api/projects', { name: 'ForkDel' });
  const pid = proj.json.project.id;
  const conv = await api('POST', `/api/projects/${pid}/conversations`, { title: 'Original' });
  const cid = conv.json.conversationId;

  const forked = await api('POST', `/api/conversations/${cid}/fork`, {});
  assert.equal(forked.status, 201);
  assert.ok(forked.json.conversationId);
  assert.notEqual(forked.json.conversationId, cid);

  const list = await api('GET', `/api/projects/${pid}/conversations`);
  assert.equal((list.json as Array<unknown>).length, 2);

  const del = await api('DELETE', `/api/conversations/${cid}`, { confirmId: cid });
  assert.equal(del.status, 200);
  const after = await api('GET', `/api/projects/${pid}/conversations`);
  assert.equal((after.json as Array<unknown>).length, 1);
});

test('archive marca o projeto como archived e PATCH status restaura', async () => {
  const proj = await api('POST', '/api/projects', { name: 'Arquivar' });
  const pid = proj.json.project.id;
  const arch = await api('POST', `/api/projects/${pid}/archive`);
  assert.equal(arch.status, 200);
  const detail = await api('GET', `/api/projects/${pid}`);
  assert.equal(detail.json.project.status, 'archived');

  const restore = await api('PATCH', `/api/projects/${pid}`, { status: 'active' });
  assert.equal(restore.status, 200);
  assert.equal(restore.json.project.status, 'active');
});

test('API de arquivos lista, le, busca e serve imagem com isolamento', async () => {
  const project = svc.createProject({ name: 'Files API' });
  const root = svc.resolveProjectRoot(project);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'const marcadorHttp = true;');
  fs.writeFileSync(path.join(root, 'foto.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(root, '.env'), 'TOKEN=privado');

  const list = await api('GET', `/api/projects/${project.id}/files?path=src`);
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.entries.map((entry: { name: string }) => entry.name), ['app.ts']);

  const read = await api('GET', `/api/projects/${project.id}/file?path=${encodeURIComponent('src/app.ts')}`);
  assert.equal(read.status, 200);
  assert.equal(read.json.viewer, 'code');
  assert.match(read.json.content, /marcadorHttp/);

  const search = await api('GET', `/api/projects/${project.id}/search?q=marcadorHttp`);
  assert.equal(search.status, 200);
  assert.equal(search.json.results[0].path, 'src/app.ts');

  const traversal = await api('GET', `/api/projects/${project.id}/file?path=${encodeURIComponent('../config.json')}`);
  assert.equal(traversal.status, 403);
  const secret = await api('GET', `/api/projects/${project.id}/file?path=.env`);
  assert.equal(secret.status, 403);

  const raw = await fetch(base + `/api/projects/${project.id}/file/raw?path=foto.png`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(raw.status, 200);
  assert.equal(raw.headers.get('content-type'), 'image/png');
  assert.equal(raw.headers.get('x-frame-options'), 'SAMEORIGIN');
  await raw.body?.cancel();

  const rawText = await api('GET', `/api/projects/${project.id}/file/raw?path=${encodeURIComponent('src/app.ts')}`);
  assert.equal(rawText.status, 415);
});

test('GET /api/analytics aceita filtro multiplo de projetos', async () => {
  const p1 = svc.createProject({ name: 'Analytics HTTP A' });
  const p2 = svc.createProject({ name: 'Analytics HTTP B' });
  const db = connection.getDb();
  db.prepare(`INSERT INTO conversations (id, agent_id, project_id) VALUES ('analytics-http-a', 'aria', ?), ('analytics-http-b', 'aria', ?)`).run(p1.id, p2.id);
  db.prepare(`INSERT INTO messages (id, conversation_id, role, content, agent_id, input_tokens, output_tokens)
    VALUES ('analytics-http-ma', 'analytics-http-a', 'assistant', 'a', 'aria', 7, 3),
           ('analytics-http-mb', 'analytics-http-b', 'assistant', 'b', 'aria', 11, 4)`).run();

  const one = await api('GET', `/api/analytics?range=24h&project=${p1.id}`);
  assert.equal(one.status, 200);
  assert.deepEqual(one.json.scope.projects, [p1.id]);
  assert.equal(one.json.kpis.tokens.current, 10);

  const multiple = await api('GET', `/api/analytics?range=24h&project=${p1.id}&project=${p2.id}`);
  assert.deepEqual(multiple.json.scope.projects, [p1.id, p2.id]);
  assert.equal(multiple.json.kpis.tokens.current, 25);
});

test('GET /api/state usa telemetria real de delegacoes para modelo e tokens dos agentes', async () => {
  const db = connection.getDb();
  db.prepare(`INSERT INTO usage_events
    (id, agent_id, model, kind, input_tokens, output_tokens, cached_tokens, project_id)
    VALUES ('state-worker-usage', 'aria', 'deepseek-v4-pro', 'chat', 1234, 56, 1000, 'legacy')`).run();

  const response = await api('GET', '/api/state');
  assert.equal(response.status, 200);
  const aria = response.json.agents.find((agent: any) => agent.id === 'aria');
  assert.equal(aria.model, 'deepseek-v4-pro');
  assert.equal(aria.provider, 'deepseek');
  assert.equal(aria.modelSource, 'last_usage');
  assert.ok(aria.tokens.input >= 1234);
  assert.ok(aria.tokens.output >= 56);
  assert.ok(response.json.tokensToday.input >= 1234);

  const project = svc.createProject({ name: 'Estado por projeto' });
  svc.updateProjectSettings(project.id, { default_model: 'deepseek-v4-pro', default_provider: 'deepseek' });
  const scoped = await api('GET', `/api/state?project=${project.id}`);
  const scopedAria = scoped.json.agents.find((agent: any) => agent.id === 'aria');
  assert.equal(scopedAria.model, 'deepseek-v4-pro');
  assert.equal(scopedAria.modelSource, 'project');
  assert.deepEqual(scopedAria.tokens, { input: 0, output: 0 });
  assert.equal(scoped.json.config.model, 'deepseek-v4-pro');
});

test('API de dados gerencia memoria, export, settings, diagnostico e auditoria', async () => {
  const project = svc.createProject({ name: 'Dados HTTP' });
  const root = svc.resolveProjectRoot(project);
  const agentDir = path.join(path.dirname(root), '.aria', 'agents', 'aria');
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'memory.md'), '# Memoria\n\n- dado HTTP');

  const memories = await api('GET', `/api/projects/${project.id}/memories`);
  assert.equal(memories.status, 200);
  assert.equal(memories.json.length, 1);
  const memoryId = memories.json[0].id;
  const memory = await api('GET', `/api/projects/${project.id}/memory?id=${encodeURIComponent(memoryId)}`);
  assert.match(memory.json.content, /dado HTTP/);

  const wrong = await api('DELETE', `/api/projects/${project.id}/memory?id=${encodeURIComponent(memoryId)}`, { confirmId: 'errado' });
  assert.equal(wrong.status, 400);

  const settings = await api('PATCH', `/api/projects/${project.id}/settings`, {
    shellMode: 'off', delegationTimeoutSec: 90, maxConcurrency: 3, memoryEnabled: false,
  });
  assert.equal(settings.status, 200);
  assert.equal(settings.json.settings.shell_mode, 'off');
  assert.equal(settings.json.settings.max_concurrency, 3);
  assert.equal(settings.json.settings.memory_enabled, 0);

  const exported = await api('GET', `/api/projects/${project.id}/export`);
  assert.equal(exported.status, 200);
  assert.equal(exported.json.format, 'personal-ai-agents-project-export');

  const removed = await api('DELETE', `/api/projects/${project.id}/memory?id=${encodeURIComponent(memoryId)}`, { confirmId: memoryId });
  assert.equal(removed.status, 200);
  const audit = await api('GET', `/api/projects/${project.id}/audit`);
  assert.ok(audit.json.some((event: any) => event.action === 'memory.delete'));
  assert.ok(audit.json.some((event: any) => event.action === 'project.export'));
  assert.ok(audit.json.some((event: any) => event.action === 'settings.update'));

  const diagnostic = await api('GET', '/api/diagnostics');
  assert.equal(diagnostic.status, 200);
  assert.equal(diagnostic.json.status, 'healthy');
  assert.equal(diagnostic.json.web.remoteAccess, false);
});

test('API de produtividade cobre templates, editor concorrente e backups', async () => {
  const templates = await api('GET', '/api/project-templates');
  assert.equal(templates.status, 200);
  assert.ok(templates.json.some((template: { id: string }) => template.id === 'web-static'));
  const invalidTemplate = await api('POST', '/api/projects', { name: 'Invalido', templateId: 'nao-existe' });
  assert.equal(invalidTemplate.status, 400);

  const created = await api('POST', '/api/projects', { name: 'Produtividade HTTP', templateId: 'web-static' });
  assert.equal(created.status, 201);
  const projectId = created.json.project.id;

  const opened = await api('GET', `/api/projects/${projectId}/file?path=index.html`);
  assert.equal(opened.status, 200);
  const saved = await api('PATCH', `/api/projects/${projectId}/file`, {
    path: 'index.html', content: '<h1>Atualizado</h1>',
  }, { 'If-Match': opened.json.etag });
  assert.equal(saved.status, 200);
  assert.match(saved.json.document.content, /Atualizado/);

  const stale = await api('PATCH', `/api/projects/${projectId}/file`, {
    path: 'index.html', content: 'nao sobrescrever',
  }, { 'If-Match': opened.json.etag });
  assert.equal(stale.status, 409);

  const newFile = await api('PATCH', `/api/projects/${projectId}/file`, {
    path: 'novo.txt', content: 'novo',
  }, { 'If-None-Match': '*' });
  assert.equal(newFile.status, 201);

  const renamed = await api('POST', `/api/projects/${projectId}/file/rename`, {
    path: 'novo.txt', destination: 'renomeado.txt',
  }, { 'If-Match': newFile.json.document.etag });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.json.path, 'renomeado.txt');

  const removed = await api('DELETE', `/api/projects/${projectId}/file`, {
    path: 'renomeado.txt', confirmPath: 'renomeado.txt',
  }, { 'If-Match': renamed.json.document.etag });
  assert.equal(removed.status, 200);

  const directory = await api('POST', `/api/projects/${projectId}/files`, { kind: 'directory', path: 'componentes' });
  assert.equal(directory.status, 201);

  const backup = await api('POST', `/api/projects/${projectId}/backups`, {});
  assert.equal(backup.status, 201);
  const listed = await api('GET', `/api/projects/${projectId}/backups`);
  assert.ok(listed.json.some((item: { id: string }) => item.id === backup.json.id));
  const downloaded = await api('GET', `/api/projects/${projectId}/backup?id=${encodeURIComponent(backup.json.id)}`);
  assert.equal(downloaded.json.format, 'personal-ai-agents-project-backup');
  const deleted = await api('DELETE', `/api/projects/${projectId}/backup?id=${encodeURIComponent(backup.json.id)}`, { confirmId: backup.json.id });
  assert.equal(deleted.status, 200);
});
