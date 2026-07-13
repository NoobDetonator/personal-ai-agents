import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let connection: typeof import('../src/db/connection.js');
let service: typeof import('../src/projects/service.js');
let files: typeof import('../src/projects/files-service.js');
let projectId: string;
let projectRoot: string;

before(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-project-files-'));
  process.chdir(root);
  const loader = await import('../src/config/loader.js');
  connection = await import('../src/db/connection.js');
  service = await import('../src/projects/service.js');
  files = await import('../src/projects/files-service.js');
  loader.loadConfig();
  connection.initDatabase();
  const project = service.createProject({ name: 'Arquivos' });
  projectId = project.id;
  projectRoot = service.resolveProjectRoot(project);

  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'README.md'), '# Projeto\nMarcador seguro');
  fs.writeFileSync(path.join(projectRoot, 'dados.json'), '{"ok":true}');
  fs.writeFileSync(path.join(projectRoot, 'src', 'app.ts'), 'export const marcador = "seguro";');
  fs.writeFileSync(path.join(projectRoot, 'pixel.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(projectRoot, 'blob.bin'), Buffer.from([0, 1, 2, 3]));
  fs.writeFileSync(path.join(projectRoot, '.env'), 'SECRET=nao-expor');
  fs.mkdirSync(path.join(projectRoot, '.git'));
  fs.writeFileSync(path.join(projectRoot, '.git', 'config'), 'privado');
});

after(() => connection.closeDatabase());

test('lista pastas antes de arquivos e omite caminhos protegidos', () => {
  const result = files.listProjectFiles(projectId);
  assert.equal(result.entries[0].name, 'src');
  assert.ok(result.entries.some(entry => entry.name === 'README.md' && entry.viewer === 'markdown'));
  assert.ok(result.entries.some(entry => entry.name === 'pixel.png' && entry.viewer === 'image'));
  assert.ok(!result.entries.some(entry => entry.name === '.env'));
  assert.ok(!result.entries.some(entry => entry.name === '.git'));
});

test('le arquivos textuais e fornece rota bruta apenas para formatos seguros', () => {
  const json = files.readProjectFile(projectId, 'dados.json');
  assert.equal(json.viewer, 'json');
  assert.equal(json.content, '{"ok":true}');
  assert.match(json.etag, /^W\//);

  const image = files.readProjectFile(projectId, 'pixel.png');
  assert.equal(image.viewer, 'image');
  assert.match(image.rawUrl ?? '', /file\/raw/);
  assert.equal(files.readProjectRawFile(projectId, 'pixel.png').mime, 'image/png');
  assert.throws(() => files.readProjectRawFile(projectId, 'README.md'), (error: unknown) =>
    error instanceof files.ProjectFileError && error.status === 415);
});

test('recusa binario desconhecido, traversal, caminho absoluto e segredo', () => {
  assert.throws(() => files.readProjectFile(projectId, 'blob.bin'), (error: unknown) =>
    error instanceof files.ProjectFileError && error.status === 415);
  assert.throws(() => files.readProjectFile(projectId, '../fora.txt'), (error: unknown) =>
    error instanceof files.ProjectFileError && error.status === 403);
  assert.throws(() => files.readProjectFile(projectId, path.join(projectRoot, 'README.md')), (error: unknown) =>
    error instanceof files.ProjectFileError && error.status === 400);
  assert.throws(() => files.readProjectFile(projectId, '.env'), (error: unknown) =>
    error instanceof files.ProjectFileError && error.status === 403);
});

test('busca textual retorna caminho e linha sem vasculhar segredos', () => {
  const result = files.searchProjectFiles(projectId, 'marcador');
  assert.deepEqual(result.results.map(item => item.path).sort(), ['README.md', 'src/app.ts']);
  assert.ok(result.results.every(item => item.line > 0));
  assert.equal(files.searchProjectFiles(projectId, 'SECRET').results.length, 0);
});

test('projeto Legacy nunca expõe workspace/projects', () => {
  const legacy = files.listProjectFiles('legacy');
  assert.ok(!legacy.entries.some(entry => entry.name.toLowerCase() === 'projects'));
  assert.throws(() => files.listProjectFiles('legacy', 'projects'), (error: unknown) =>
    error instanceof files.ProjectFileError && error.status === 403);
});

test('symlink ou junction nao aparece nem pode ser aberto', t => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-project-files-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'segredo');
  const link = path.join(projectRoot, 'escape');
  try {
    fs.symlinkSync(outside, link, 'junction');
  } catch {
    t.skip('sem permissao para criar symlink/junction');
    return;
  }
  assert.ok(!files.listProjectFiles(projectId).entries.some(entry => entry.name === 'escape'));
  assert.throws(() => files.readProjectFile(projectId, 'escape/secret.txt'), (error: unknown) =>
    error instanceof files.ProjectFileError && error.status === 403);
});

test('diff informa indisponibilidade fora de repositorio Git', () => {
  const result = files.diffProjectFile(projectId, 'README.md');
  assert.equal(result.available, false);
  assert.match(result.reason ?? '', /Git/);
});
