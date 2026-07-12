import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ProjectService sobre um banco real (SQLite). Import dinâmico após chdir para
// um tmp, pois connection.ts resolve data/agents.db contra o cwd.

let svc: typeof import('../src/projects/service.js');
let connection: typeof import('../src/db/connection.js');
let root: string;

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-projsvc-'));
  process.chdir(root);
  connection = await import('../src/db/connection.js');
  svc = await import('../src/projects/service.js');
  connection.initDatabase(); // roda migrações → cria projeto Legacy
});

after(() => {
  connection.closeDatabase();
});

test('a migração cria o projeto Legacy e ensureLegacyProject garante o diretório', () => {
  const legacy = svc.ensureLegacyProject();
  assert.equal(legacy.id, svc.LEGACY_PROJECT_ID);
  assert.equal(legacy.root_path, 'workspace');
  assert.ok(fs.existsSync(path.join(root, 'workspace')));
});

test('createProject cria registro, diretórios e project.json', () => {
  const p = svc.createProject({ name: 'Meu Projeto', description: 'desc' });
  assert.ok(p.id);
  assert.equal(p.slug, 'meu-projeto');
  assert.equal(p.status, 'active');

  const filesDir = svc.resolveProjectRoot(p);
  assert.ok(filesDir.endsWith(path.join('workspace', 'projects', p.id, 'files')));
  assert.ok(fs.existsSync(filesDir), 'diretório files/ existe');
  assert.ok(fs.existsSync(path.join(root, 'workspace', 'projects', p.id, '.aria', 'memories')));
  assert.ok(fs.existsSync(path.join(root, 'workspace', 'projects', p.id, '.aria', 'previews')));

  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'workspace', 'projects', p.id, 'project.json'), 'utf-8'));
  assert.equal(manifest.id, p.id);
  assert.equal(manifest.name, 'Meu Projeto');
});

test('slug é único mesmo com nomes iguais; nome nunca vira o caminho', () => {
  const a = svc.createProject({ name: 'Repetido' });
  const b = svc.createProject({ name: 'Repetido' });
  assert.notEqual(a.slug, b.slug);
  assert.equal(a.slug, 'repetido');
  assert.equal(b.slug, 'repetido-2');
  // O caminho usa o id (UUID), não o slug/nome.
  assert.ok(svc.resolveProjectRoot(a).includes(a.id));
  assert.ok(!svc.resolveProjectRoot(a).includes('Repetido'));
});

test('nome vazio é rejeitado', () => {
  assert.throws(() => svc.createProject({ name: '   ' }), /obrigatório/);
});

test('buildProjectContext resolve o projectRoot absoluto a partir do id', () => {
  const p = svc.createProject({ name: 'Contexto' });
  const ctx = svc.buildProjectContext(p.id, { runId: 'r1' });
  assert.equal(ctx.projectId, p.id);
  assert.equal(ctx.projectRoot, svc.resolveProjectRoot(p));
  assert.ok(path.isAbsolute(ctx.projectRoot));
  assert.equal(ctx.runId, 'r1');
});

test('archiveProject muda o status para archived', () => {
  const p = svc.createProject({ name: 'Para Arquivar' });
  assert.ok(svc.archiveProject(p.id));
  assert.equal(svc.getProject(p.id)?.status, 'archived');
});

test('deleteProject exige o nome exato como confirmação', () => {
  const p = svc.createProject({ name: 'Deletável' });
  const dir = path.join(root, 'workspace', 'projects', p.id);
  assert.ok(fs.existsSync(dir));

  const wrong = svc.deleteProject(p.id, 'errado');
  assert.equal(wrong.ok, false);
  assert.ok(svc.getProject(p.id), 'projeto permanece após confirmação inválida');

  const ok = svc.deleteProject(p.id, 'Deletável');
  assert.equal(ok.ok, true);
  assert.equal(svc.getProject(p.id), null);
  assert.ok(!fs.existsSync(dir), 'diretório removido');
});

test('o projeto Legacy nunca pode ser deletado', () => {
  const result = svc.deleteProject(svc.LEGACY_PROJECT_ID, 'Legacy');
  assert.equal(result.ok, false);
  assert.ok(svc.getProject(svc.LEGACY_PROJECT_ID));
});

test('updateProject altera nome e descrição preservando o resto', () => {
  const p = svc.createProject({ name: 'Antigo', description: 'a' });
  const updated = svc.updateProject(p.id, { name: 'Novo', description: 'b' });
  assert.equal(updated?.name, 'Novo');
  assert.equal(updated?.description, 'b');
  assert.equal(updated?.slug, p.slug, 'slug não muda ao renomear');
});


test('deleteProject bloqueia execucoes ativas', () => {
  const p = svc.createProject({ name: 'Projeto ativo' });
  connection.getDb().prepare(
    "INSERT INTO runs (id, project_id, agent_id, status) VALUES ('run-active', ?, 'aria', 'running')",
  ).run(p.id);

  const blocked = svc.deleteProject(p.id, p.name);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error ?? '', /execucoes ativas/);
  assert.ok(svc.getProject(p.id));

  connection.getDb().prepare("UPDATE runs SET status = 'failed' WHERE id = 'run-active'").run();
  assert.equal(svc.deleteProject(p.id, p.name).ok, true);
});

test('deleteProject remove dados dependentes sem deixar orfaos', () => {
  const p = svc.createProject({ name: 'Projeto cascata' });
  const db = connection.getDb();
  db.prepare("INSERT INTO conversations (id, agent_id, project_id) VALUES ('conv-cascade', 'aria', ?)").run(p.id);
  db.prepare("INSERT INTO messages (id, conversation_id, role, content) VALUES ('msg-cascade', 'conv-cascade', 'user', 'oi')").run();
  db.prepare("INSERT INTO runs (id, project_id, conversation_id, agent_id, status) VALUES ('run-cascade', ?, 'conv-cascade', 'aria', 'done')").run(p.id);
  db.prepare("INSERT INTO run_events (id, run_id, sequence, type) VALUES ('event-cascade', 'run-cascade', 1, 'status')").run();
  db.prepare("INSERT INTO tasks (id, title, status, project_id) VALUES ('task-cascade', 't', 'done', ?)").run(p.id);
  db.prepare("INSERT INTO usage_events (id, model, project_id) VALUES ('usage-cascade', 'test', ?)").run(p.id);
  db.prepare("INSERT INTO schedules (id, agent_id, cron_expr, task_prompt, project_id) VALUES ('schedule-cascade', 'aria', '* * * * *', 't', ?)").run(p.id);

  assert.equal(svc.deleteProject(p.id, p.name).ok, true);
  for (const [table, id] of [
    ['conversations', 'conv-cascade'],
    ['messages', 'msg-cascade'],
    ['runs', 'run-cascade'],
    ['run_events', 'event-cascade'],
    ['tasks', 'task-cascade'],
    ['usage_events', 'usage-cascade'],
    ['schedules', 'schedule-cascade'],
  ]) {
    const row = db.prepare('SELECT 1 FROM ' + table + ' WHERE id = ?').get(id);
    assert.equal(row, undefined, table + ' nao deve manter orfao');
  }
});
