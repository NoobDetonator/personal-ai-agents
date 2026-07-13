import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let connection: typeof import('../src/db/connection.js');
let projects: typeof import('../src/projects/service.js');
let backups: typeof import('../src/projects/backup-service.js');
let projectId: string;
let root: string;

before(async () => {
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'paa-backup-')));
  const loader = await import('../src/config/loader.js');
  connection = await import('../src/db/connection.js');
  projects = await import('../src/projects/service.js');
  backups = await import('../src/projects/backup-service.js');
  loader.loadConfig();
  connection.initDatabase();
  const project = projects.createProject({ name: 'Backup', templateId: 'research' });
  projectId = project.id;
  root = projects.resolveProjectRoot(project);
  fs.writeFileSync(path.join(root, 'public.txt'), 'conteudo seguro');
  fs.writeFileSync(path.join(root, '.env'), 'TOKEN=nao-incluir');
});

after(() => connection.closeDatabase());

test('template inicial cria estrutura deterministica', () => {
  assert.ok(fs.existsSync(path.join(root, 'notes', 'sources.md')));
  assert.match(fs.readFileSync(path.join(root, 'README.md'), 'utf-8'), /Pesquisa/);
});

test('backup inclui dados e arquivos permitidos sem segredos', () => {
  const created = backups.createProjectBackup(projectId);
  assert.ok(created.files >= 5);
  assert.equal(backups.listProjectBackups(projectId)[0].id, created.id);
  const payload = JSON.parse(backups.readProjectBackup(projectId, created.id).body.toString('utf-8'));
  assert.equal(payload.format, 'personal-ai-agents-project-backup');
  assert.ok(payload.files.some((file: { path: string }) => file.path === 'public.txt'));
  assert.ok(!payload.files.some((file: { path: string }) => file.path === '.env'));
  assert.equal(Buffer.from(payload.files.find((file: { path: string }) => file.path === 'public.txt').contentBase64, 'base64').toString(), 'conteudo seguro');
});

test('exclusao de backup exige confirmacao exata', () => {
  const created = backups.createProjectBackup(projectId);
  assert.throws(() => backups.deleteProjectBackup(projectId, created.id, 'errado'), (error: unknown) =>
    error instanceof backups.ProjectBackupError && error.status === 400);
  backups.deleteProjectBackup(projectId, created.id, created.id);
  assert.ok(!backups.listProjectBackups(projectId).some(item => item.id === created.id));
});
