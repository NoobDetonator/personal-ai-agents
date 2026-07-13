import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let dbModule: typeof import('../src/db/connection.js');
let taskModule: typeof import('../src/tools/tasks.js');
let confirmModule: typeof import('../src/chat/confirm.js');
let clearBoard: any;

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-board-'));
  process.chdir(dir);

  dbModule = await import('../src/db/connection.js');
  dbModule.initDatabase();
  taskModule = await import('../src/tools/tasks.js');
  confirmModule = await import('../src/chat/confirm.js');
  clearBoard = (taskModule.createTaskTools('aria') as any).clearBoard;
});

beforeEach(() => {
  dbModule.getDb().prepare('DELETE FROM tasks').run();
});

after(() => {
  dbModule.closeDatabase();
});

function insertTask(id: string, status: string, team = 'produto'): void {
  dbModule.getDb().prepare(
    'INSERT INTO tasks (id, title, status, team) VALUES (?, ?, ?, ?)',
  ).run(id, id, status, team);
}

test('clearBoard exige confirmacao humana sem opcao sempre', async () => {
  insertTask('done-1', 'done');

  const resultPromise = clearBoard.execute({});
  await Promise.resolve();
  const pending = confirmModule.getPendingConfirmations().find(
    item => item.message.includes('Apagar permanentemente'),
  );

  assert.ok(pending);
  assert.equal(pending.allowAlways, false);
  confirmModule.resolveConfirmation(pending.id, 'no');

  const result = await resultPromise;
  assert.match(result.error, /negada pelo usuario/);
  assert.equal(dbModule.getDb().prepare('SELECT COUNT(*) AS total FROM tasks').get().total, 1);
});

test('clearBoard aprovado respeita os filtros', async () => {
  insertTask('done-1', 'done');
  insertTask('pending-1', 'pending');

  const resultPromise = clearBoard.execute({ status: 'done' });
  await Promise.resolve();
  const pending = confirmModule.getPendingConfirmations()[0];
  assert.ok(pending);
  assert.match(pending.message, /status=done/);
  confirmModule.resolveConfirmation(pending.id, 'yes');

  const result = await resultPromise;
  assert.deepEqual(result, { success: true, deleted: 1, skippedActive: 0 });
  const rows = dbModule.getDb().prepare('SELECT id FROM tasks ORDER BY id').all() as Array<{ id: string }>;
  assert.deepEqual(rows.map(row => row.id), ['pending-1']);
});

test('particionamento preserva tarefas com delegacao ativa', () => {
  const rows = [
    { id: 'active-1' },
    { id: 'done-1' },
    { id: 'active-2' },
  ] as any;

  assert.deepEqual(
    taskModule.partitionTasksForDeletion(rows, ['active-1', 'active-2']),
    { deletableIds: ['done-1'], skippedActive: 2 },
  );
});

test('consolidacao, indice e revisao ficam depois dos trabalhos produtores', () => {
  const plan = taskModule.partitionDelegationStages([
    { agentId: 'a', prompt: 'Pesquise regras de combate', stage: 'work' },
    { agentId: 'b', prompt: 'Atualize o índice central com todos os documentos' },
    { agentId: 'c', prompt: 'Faça a revisão final de fontes', stage: 'finalize' },
  ]);
  assert.deepEqual(plan.work.map(item => item.agentId), ['a']);
  assert.deepEqual(plan.finalizers.map(item => item.agentId), ['b', 'c']);
});

test('reconcilia automaticamente o estado da tarefa-mae pelas subtarefas', () => {
  const db = dbModule.getDb();
  db.prepare("INSERT INTO tasks (id, title, status) VALUES ('parent', 'mae', 'pending')").run();
  db.prepare("INSERT INTO tasks (id, parent_id, title, status) VALUES ('child-a', 'parent', 'a', 'done'), ('child-b', 'parent', 'b', 'pending')").run();

  taskModule.reconcileTaskAncestors('child-a');
  assert.equal((db.prepare("SELECT status FROM tasks WHERE id = 'parent'").get() as any).status, 'in_progress');

  db.prepare("UPDATE tasks SET status = 'failed' WHERE id = 'child-b'").run();
  taskModule.reconcileTaskAncestors('child-b');
  const parent = db.prepare("SELECT status, result FROM tasks WHERE id = 'parent'").get() as any;
  assert.equal(parent.status, 'failed');
  assert.match(parent.result, /done: 1/);
  assert.match(parent.result, /failed: 1/);
});
