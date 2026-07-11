import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// As invariantes de caminho dependem do cwd (config default: ./workspace),
// entao o modulo e importado dinamicamente apos mudar para um diretorio
// temporario. Cada arquivo de teste roda em processo proprio (node --test).
let resolveAllowedPath: (p: string) => string | null;
let resolveReadablePath: (p: string) => string | null;
let root: string;
let ws: string;
let outside: string;
let skillsDir: string;

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-fileops-'));
  process.chdir(root);
  ws = path.join(root, 'workspace');
  outside = path.join(root, 'outside');
  skillsDir = path.join(root, 'skills');
  fs.mkdirSync(ws);
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(skillsDir, 'demo'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  fs.writeFileSync(path.join(ws, 'ok.txt'), 'ok');
  fs.writeFileSync(path.join(root, 'config.json'), '{}');
  fs.writeFileSync(path.join(skillsDir, 'demo', 'SKILL.md'), '---\nname: demo\n---\ncorpo');
  fs.writeFileSync(path.join(skillsDir, 'demo', 'perfil.md'), 'perfil auxiliar');
  ({ resolveAllowedPath, resolveReadablePath } = await import('../src/tools/file-ops.js'));
});

test('permite arquivo dentro do workspace', () => {
  assert.ok(resolveAllowedPath(path.join(ws, 'ok.txt')));
});

test('permite arquivo novo em subpasta inexistente do workspace', () => {
  assert.ok(resolveAllowedPath(path.join(ws, 'nova', 'sub', 'a.txt')));
});

test('nega traversal com ..', () => {
  assert.equal(resolveAllowedPath(path.join(ws, '..', 'outside', 'secret.txt')), null);
});

test('nega caminho absoluto fora do workspace', () => {
  assert.equal(resolveAllowedPath(path.join(outside, 'secret.txt')), null);
});

test('nega config.json do projeto (mesmo via workspace/..)', () => {
  assert.equal(resolveAllowedPath(path.join(root, 'config.json')), null);
  assert.equal(resolveAllowedPath(path.join(ws, '..', 'config.json')), null);
});

test('nega arquivos .env em qualquer lugar permitido', () => {
  assert.equal(resolveAllowedPath(path.join(ws, '.env')), null);
  assert.equal(resolveAllowedPath(path.join(ws, '.env.local')), null);
});

test('nega extensoes bloqueadas e protegidas', () => {
  assert.equal(resolveAllowedPath(path.join(ws, 'x.exe')), null);
  assert.equal(resolveAllowedPath(path.join(ws, 'x.ps1')), null);
  assert.equal(resolveAllowedPath(path.join(ws, 'x.db')), null);
});

test('nega node_modules e .git mesmo dentro do workspace', () => {
  assert.equal(resolveAllowedPath(path.join(ws, 'node_modules', 'x.js')), null);
  assert.equal(resolveAllowedPath(path.join(ws, '.git', 'config')), null);
});

test('leitura pode acessar a pasta skills (perfis e arquivos auxiliares)', () => {
  assert.ok(resolveReadablePath(path.join(skillsDir, 'demo', 'SKILL.md')));
  assert.ok(resolveReadablePath(path.join(skillsDir, 'demo', 'perfil.md')));
});

test('escrita/delete NUNCA acessa a pasta skills', () => {
  assert.equal(resolveAllowedPath(path.join(skillsDir, 'demo', 'SKILL.md')), null);
  assert.equal(resolveAllowedPath(path.join(skillsDir, 'demo', 'perfil.md')), null);
});

test('leitura fora de workspace/skills continua negada', () => {
  assert.equal(resolveReadablePath(path.join(outside, 'secret.txt')), null);
  assert.equal(resolveReadablePath(path.join(root, 'config.json')), null);
});

test('nega escape por junction/symlink de diretorio', t => {
  const junction = path.join(ws, 'jump');
  try {
    fs.symlinkSync(outside, junction, 'junction');
  } catch {
    t.skip('sem permissao para criar symlink/junction');
    return;
  }
  assert.equal(resolveAllowedPath(path.join(junction, 'secret.txt')), null);
  assert.equal(resolveAllowedPath(junction), null);
});

test('nega symlink de arquivo apontando para fora', t => {
  const link = path.join(ws, 'link.txt');
  try {
    fs.symlinkSync(path.join(outside, 'secret.txt'), link, 'file');
  } catch {
    t.skip('sem permissao para criar symlink de arquivo (Windows sem developer mode)');
    return;
  }
  assert.equal(resolveAllowedPath(link), null);
});
