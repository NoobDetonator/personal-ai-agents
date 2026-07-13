import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let connection: typeof import('../src/db/connection.js');
let projects: typeof import('../src/projects/service.js');
let data: typeof import('../src/projects/data-service.js');
let agentMemory: typeof import('../src/projects/agent-memory.js');
let projectContext: typeof import('../src/projects/context.js');
let project: import('../src/projects/service.js').Project;
let agentsDir: string;

before(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-project-data-'));
  process.chdir(root);
  const loader = await import('../src/config/loader.js');
  connection = await import('../src/db/connection.js');
  projects = await import('../src/projects/service.js');
  data = await import('../src/projects/data-service.js');
  agentMemory = await import('../src/projects/agent-memory.js');
  projectContext = await import('../src/projects/context.js');
  loader.loadConfig();
  connection.initDatabase();
  project = projects.createProject({ name: 'Dados Privados' });
  agentsDir = path.join(path.dirname(projects.resolveProjectRoot(project)), '.aria', 'agents', 'aria');
  fs.mkdirSync(path.join(agentsDir, 'daily'), { recursive: true });
  fs.mkdirSync(path.join(agentsDir, 'memories'), { recursive: true });
  fs.writeFileSync(path.join(agentsDir, 'memory.md'), '# Memoria\n\n- prefere testes');
  fs.writeFileSync(path.join(agentsDir, 'daily', '2026-07-12.md'), '# Nota\n\n- concluiu fase');
  fs.writeFileSync(path.join(agentsDir, 'memories', 'arquitetura.md'), '---\ndescription: Decisoes de arquitetura\n---\n\nconteudo profundo');
});

after(() => connection.closeDatabase());

test('lista e le memorias por projeto sem expor caminho fisico', () => {
  const list = data.listProjectMemories(project.id);
  assert.equal(list.length, 3);
  assert.deepEqual(new Set(list.map(item => item.kind)), new Set(['main', 'daily', 'deep']));
  const deep = list.find(item => item.kind === 'deep')!;
  assert.equal(deep.description, 'Decisoes de arquitetura');
  assert.ok(!JSON.stringify(deep).includes(process.cwd()));
  assert.match(data.readProjectMemory(project.id, deep.id).content, /conteudo profundo/);
});

test('exclusao individual exige confirmacao exata e gera auditoria', () => {
  const memory = data.listProjectMemories(project.id).find(item => item.kind === 'daily')!;
  assert.throws(() => data.deleteProjectMemory(project.id, memory.id, 'errado'), (error: unknown) =>
    error instanceof data.ProjectDataError && error.status === 400);
  data.deleteProjectMemory(project.id, memory.id, memory.id);
  assert.throws(() => data.readProjectMemory(project.id, memory.id), (error: unknown) =>
    error instanceof data.ProjectDataError && error.status === 404);
  const audit = data.listAuditEvents(project.id) as Array<{ action: string; target_id: string }>;
  assert.ok(audit.some(event => event.action === 'memory.delete' && event.target_id === memory.id));
});

test('export inclui conversas, mensagens, configuracoes e memorias', () => {
  const db = connection.getDb();
  db.prepare(`INSERT INTO conversations (id, agent_id, project_id, title) VALUES ('data-conv', 'aria', ?, 'Exportar')`).run(project.id);
  db.prepare(`INSERT INTO messages (id, conversation_id, role, content) VALUES ('data-msg', 'data-conv', 'user', 'ola')`).run();
  const exported = data.exportProjectData(project.id) as any;
  assert.equal(exported.format, 'personal-ai-agents-project-export');
  assert.equal(exported.project.id, project.id);
  assert.equal(exported.conversations.length, 1);
  assert.equal(exported.messages[0].content, 'ola');
  assert.ok(exported.memories.length >= 1);
  assert.ok(data.listAuditEvents(project.id).some((event: any) => event.action === 'project.export'));
});

test('apagar conversa exige projeto, confirmacao e ausencia de run ativo', () => {
  const db = connection.getDb();
  assert.throws(() => data.deleteProjectConversation(project.id, 'data-conv', 'errado'), (error: unknown) =>
    error instanceof data.ProjectDataError && error.status === 400);
  db.prepare(`INSERT INTO runs (id, project_id, conversation_id, agent_id, status) VALUES ('data-run', ?, 'data-conv', 'aria', 'running')`).run(project.id);
  assert.throws(() => data.deleteProjectConversation(project.id, 'data-conv', 'data-conv'), (error: unknown) =>
    error instanceof data.ProjectDataError && error.status === 409);
  db.prepare(`UPDATE runs SET status = 'cancelled' WHERE id = 'data-run'`).run();
  assert.equal(data.deleteProjectConversation(project.id, 'data-conv', 'data-conv'), true);
  assert.equal(db.prepare(`SELECT 1 FROM conversations WHERE id = 'data-conv'`).get(), undefined);
  assert.ok(data.listAuditEvents(project.id).some((event: any) => event.action === 'conversation.delete'));
});

test('limpeza total exige nome exato e preserva soul fora do catalogo', () => {
  fs.writeFileSync(path.join(agentsDir, 'soul.md'), '# Soul protegida');
  assert.throws(() => data.clearProjectMemories(project.id, 'incorreto'), (error: unknown) =>
    error instanceof data.ProjectDataError && error.status === 400);
  const removed = data.clearProjectMemories(project.id, project.name);
  assert.ok(removed >= 1);
  assert.equal(data.listProjectMemories(project.id).length, 0);
  assert.equal(fs.readFileSync(path.join(agentsDir, 'soul.md'), 'utf-8'), '# Soul protegida');
});

test('memory_enabled desliga leitura, recall e escrita sem cair na memoria global', () => {
  const isolated = projects.createProject({ name: 'Sem Memoria' });
  const ctx = projects.buildProjectContext(isolated.id);
  const globalAgent = path.join(process.cwd(), 'agents', 'aria');
  fs.mkdirSync(globalAgent, { recursive: true });
  fs.writeFileSync(path.join(globalAgent, 'memory.md'), 'SEGREDO GLOBAL');
  projects.updateProjectSettings(isolated.id, { memory_enabled: 0 });

  projectContext.runWithProjectContext(ctx, () => {
    assert.equal(agentMemory.readScopedMemory('aria'), '');
    assert.equal(agentMemory.readScopedDailyNote('aria'), '');
    assert.equal(agentMemory.readScopedDeepMemory('aria', 'qualquer'), null);
    assert.equal(fs.existsSync(agentMemory.getScopedMemoriesDir('aria')), false);
    assert.throws(() => agentMemory.appendScopedMemorySection('aria', 'Notas', 'nao gravar'), /desativada/);
    assert.throws(() => agentMemory.appendScopedDailyNote('aria', 'nao gravar'), /desativada/);
    assert.throws(() => agentMemory.saveScopedDeepMemory('aria', 'x', 'x', 'x'), /desativada/);
  });
});
