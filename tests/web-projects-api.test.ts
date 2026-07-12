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

  const del = await api('DELETE', `/api/conversations/${cid}`);
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
