import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runShell } from '../src/tools/shell.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('runShell preserva saida e exit code em execucao normal', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-shell-success-'));
  fs.writeFileSync(path.join(dir, 'success.cjs'), "process.stdout.write('ok');", 'utf8');

  const result = await runShell('node success.cjs', dir, 2);

  assert.equal(result.timedOut, false);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'ok');
  assert.equal(result.terminationError, undefined);
});

test('timeout tem retorno limitado e encerra a arvore quando o SO permite', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-shell-timeout-'));
  const sentinel = path.join(dir, 'child-survived.txt');

  fs.writeFileSync(
    path.join(dir, 'child.cjs'),
    `setTimeout(() => require('node:fs').writeFileSync('child-survived.txt', 'alive'), 800);\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, 'parent.cjs'),
    [
      "const { spawn } = require('node:child_process');",
      "spawn(process.execPath, ['child.cjs'], { cwd: __dirname, stdio: 'ignore' });",
      'setTimeout(() => {}, 5000);',
    ].join('\n'),
    'utf8',
  );

  const startedAt = Date.now();
  const result = await runShell('node parent.cjs', dir, 0.2);

  assert.equal(result.timedOut, true);
  assert.ok(Date.now() - startedAt < 3000, 'timeout demorou alem da tolerancia');
  await sleep(1200);
  if (result.terminationError) {
    assert.match(result.terminationError, /taskkill|grupo|PID|shell direto/i);
  } else {
    assert.equal(fs.existsSync(sentinel), false, 'processo-filho sobreviveu ao timeout');
  }
});
