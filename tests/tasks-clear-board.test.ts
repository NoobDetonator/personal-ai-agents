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
