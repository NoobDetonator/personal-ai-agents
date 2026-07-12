import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { runMigrations, LEGACY_PROJECT_ID } from '../src/db/schema.js';

// Migração da Fase 1 sobre um banco no schema pré-projeto (fixture). Verifica
// backfill do projeto Legacy, ausência de perda de dados e idempotência.

const FIXTURE = fileURLToPath(new URL('./fixtures/legacy-db.sql', import.meta.url));
let legacySql: string;

function freshLegacyDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(legacySql);
  return db;
}

before(() => {
  legacySql = fs.readFileSync(FIXTURE, 'utf-8');
});

test('cria o projeto Legacy ao migrar um banco antigo', () => {
  const db = freshLegacyDb();
  runMigrations(db);
  const legacy = db.prepare('SELECT id, name, slug, root_path, status FROM projects WHERE id = ?')
    .get(LEGACY_PROJECT_ID) as { id: string; name: string; slug: string; root_path: string; status: string };
  assert.equal(legacy.id, 'legacy');
  assert.equal(legacy.name, 'Legacy');
  assert.equal(legacy.slug, 'legacy');
  assert.equal(legacy.root_path, 'workspace');
  assert.equal(legacy.status, 'active');
  db.close();
});

test('atribui todos os registros legados ao projeto Legacy', () => {
  const db = freshLegacyDb();
  runMigrations(db);
  for (const table of ['conversations', 'tasks', 'usage_events', 'schedules']) {
    const orphans = db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE project_id IS NULL`).get() as { c: number };
    assert.equal(orphans.c, 0, `${table} não deveria ter registros sem project_id`);
    const owned = db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE project_id = ?`).get(LEGACY_PROJECT_ID) as { c: number };
    assert.ok(owned.c > 0, `${table} deveria ter registros no Legacy`);
  }
  db.close();
});

test('preserva os dados legados (nenhuma linha perdida)', () => {
  const db = freshLegacyDb();
  runMigrations(db);
  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM conversations').get() as { c: number }).c, 2);
  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number }).c, 2);
  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c, 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM schedules').get() as { c: number }).c, 1);
  // O conteúdo original permanece intacto.
  const msg = db.prepare("SELECT content FROM messages WHERE id = 'aaaaaaaa-0000-4000-8000-000000000002'").get() as { content: string };
  assert.equal(msg.content, 'ola, tudo bem?');
  // A coluna team legada em tasks é preservada, coexistindo com project_id.
  const task = db.prepare("SELECT team, project_id FROM tasks WHERE id = 'task0001'").get() as { team: string; project_id: string };
  assert.equal(task.team, 'marketing');
  assert.equal(task.project_id, LEGACY_PROJECT_ID);
  db.close();
});

test('cria as novas tabelas de projeto e run', () => {
  const db = freshLegacyDb();
  runMigrations(db);
  const tables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(r => r.name),
  );
  for (const t of ['projects', 'project_settings', 'project_agents', 'runs', 'run_events']) {
    assert.ok(tables.has(t), `tabela ${t} deveria existir`);
  }
  db.close();
});

test('adiciona colunas de projeto às tabelas existentes', () => {
  const db = freshLegacyDb();
  runMigrations(db);
  const cols = (table: string) =>
    new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(r => r.name));
  const conv = cols('conversations');
  for (const c of ['project_id', 'archived', 'pinned', 'created_by', 'last_run_status']) {
    assert.ok(conv.has(c), `conversations.${c} deveria existir`);
  }
  const msg = cols('messages');
  for (const c of ['run_id', 'metadata_json', 'status', 'sequence']) {
    assert.ok(msg.has(c), `messages.${c} deveria existir`);
  }
  db.close();
});

test('migração é idempotente (rodar 2x não duplica Legacy nem re-backfilla)', () => {
  const db = freshLegacyDb();
  runMigrations(db);
  runMigrations(db);
  const projects = db.prepare('SELECT COUNT(*) AS c FROM projects').get() as { c: number };
  assert.equal(projects.c, 1);
  const legacyCount = db.prepare('SELECT COUNT(*) AS c FROM projects WHERE id = ?').get(LEGACY_PROJECT_ID) as { c: number };
  assert.equal(legacyCount.c, 1);
  db.close();
});

test('não re-atribui registros que já pertencem a outro projeto', () => {
  const db = freshLegacyDb();
  runMigrations(db);
  // Simula um registro de outro projeto criado após a migração inicial.
  db.prepare(
    `INSERT INTO projects (id, name, slug, root_path) VALUES ('p2', 'Outro', 'outro', 'workspace/projects/p2/files')`,
  ).run();
  db.prepare(
    `INSERT INTO tasks (id, title, status, project_id) VALUES ('t2', 'de p2', 'pending', 'p2')`,
  ).run();
  runMigrations(db);
  const t2 = db.prepare("SELECT project_id FROM tasks WHERE id = 't2'").get() as { project_id: string };
  assert.equal(t2.project_id, 'p2');
  db.close();
});
