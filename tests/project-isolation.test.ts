import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolamento por projeto (ADR 0002). As file/shell tools confinam ao
// projectRoot do contexto ativo. Módulos importados após chdir para um tmp,
// pois resolvem caminhos contra o cwd. Um processo por arquivo (node --test).

let resolveAllowedPath: (p: string) => string | null;
let resolveReadablePath: (p: string) => string | null;
let runWithProjectContext: typeof import('../src/projects/context.js').runWithProjectContext;
let createShellTools: typeof import('../src/tools/shell.js').createShellTools;
let loader: typeof import('../src/config/loader.js');

let root: string;
let aFiles: string;
let bFiles: string;
let outside: string;
let ctxA: { projectId: string; projectRoot: string };
let ctxB: { projectId: string; projectRoot: string };

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-isolation-'));
  process.chdir(root);

  aFiles = path.join(root, 'workspace', 'projects', 'A', 'files');
  bFiles = path.join(root, 'workspace', 'projects', 'B', 'files');
  outside = path.join(root, 'outside');
  fs.mkdirSync(aFiles, { recursive: true });
  fs.mkdirSync(bFiles, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.mkdirSync(path.join(aFiles, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(aFiles, 'a.txt'), 'sou de A');
  fs.writeFileSync(path.join(bFiles, 'b.txt'), 'sou de B');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'segredo');
  fs.writeFileSync(path.join(root, 'config.json'), '{}');

  ({ resolveAllowedPath, resolveReadablePath } = await import('../src/tools/file-ops.js'));
  ({ runWithProjectContext } = await import('../src/projects/context.js'));
  ({ createShellTools } = await import('../src/tools/shell.js'));
  loader = await import('../src/config/loader.js');
  loader.loadConfig();

  ctxA = { projectId: 'A', projectRoot: aFiles };
  ctxB = { projectId: 'B', projectRoot: bFiles };
});

// --- File tools ---

test('projeto A acessa seus próprios arquivos (absoluto e relativo)', () => {
  runWithProjectContext(ctxA, () => {
    assert.ok(resolveAllowedPath(path.join(aFiles, 'a.txt')));
    assert.ok(resolveAllowedPath('a.txt'), 'caminho relativo resolve contra o projectRoot');
    assert.ok(resolveAllowedPath('sub/novo.txt'), 'subpasta nova é permitida');
  });
});

test('projeto A NÃO acessa arquivos do projeto B (escrita)', () => {
  runWithProjectContext(ctxA, () => {
    assert.equal(resolveAllowedPath(path.join(bFiles, 'b.txt')), null);
  });
});

test('projeto A NÃO acessa arquivos do projeto B (leitura)', () => {
  runWithProjectContext(ctxA, () => {
    assert.equal(resolveReadablePath(path.join(bFiles, 'b.txt')), null);
  });
});

test('projeto A NÃO escapa por .. para o projeto B', () => {
  runWithProjectContext(ctxA, () => {
    assert.equal(resolveAllowedPath(path.join('..', '..', 'B', 'files', 'b.txt')), null);
  });
});

test('projeto A NÃO escapa para fora do workspace', () => {
  runWithProjectContext(ctxA, () => {
    assert.equal(resolveAllowedPath(path.join(aFiles, '..', '..', '..', '..', 'outside', 'secret.txt')), null);
    assert.equal(resolveAllowedPath(path.join(outside, 'secret.txt')), null);
  });
});

test('projeto A não acessa o .aria (irmão de files/)', () => {
  runWithProjectContext(ctxA, () => {
    assert.equal(resolveAllowedPath(path.join(aFiles, '..', '.aria', 'context.md')), null);
  });
});

test('cada projeto vê apenas o seu (A e B são simétricos)', () => {
  runWithProjectContext(ctxB, () => {
    assert.ok(resolveAllowedPath(path.join(bFiles, 'b.txt')));
    assert.equal(resolveAllowedPath(path.join(aFiles, 'a.txt')), null);
  });
});

test('nega escape por junction/symlink de A para B ou para fora', t => {
  const jump = path.join(aFiles, 'jump');
  try {
    fs.symlinkSync(outside, jump, 'junction');
  } catch {
    t.skip('sem permissão para criar symlink/junction');
    return;
  }
  runWithProjectContext(ctxA, () => {
    assert.equal(resolveAllowedPath(path.join(jump, 'secret.txt')), null);
    assert.equal(resolveAllowedPath(jump), null);
  });
});

test('fora de contexto de projeto, o comportamento legado (workspace) permanece', () => {
  // Sem contexto ativo, a allowlist global (./workspace) vale — a CLI não quebra.
  assert.ok(resolveAllowedPath(path.join(root, 'workspace', 'legado.txt')));
});

// --- Shell tool ---

test('shell no projeto A recusa cwd que escapa para B', async () => {
  loader.updateConfig({ shell: { ...loader.getConfig().shell, mode: 'auto' } });
  const { runCommand } = createShellTools('agentX');
  const result = await runWithProjectContext(ctxA, () =>
    (runCommand.execute as (a: unknown) => Promise<{ error?: string }>)({ command: 'echo hi', cwd: '../../B/files' }),
  );
  assert.match(result.error ?? '', /fora do projeto|aponta para fora/);
});

test('shell no projeto A executa com cwd dentro do projeto', async () => {
  loader.updateConfig({ shell: { ...loader.getConfig().shell, mode: 'auto' } });
  const { runCommand } = createShellTools('agentX');
  const result = await runWithProjectContext(ctxA, () =>
    (runCommand.execute as (a: unknown) => Promise<{ error?: string; cwd?: string; exitCode?: number }>)({ command: 'echo hi', cwd: 'sub' }),
  );
  assert.equal(result.error, undefined);
  assert.equal(result.cwd, 'sub');
});
