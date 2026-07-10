// Driver de teste E2E: alimenta o CLI passo a passo pelo stdin.
// Uso: node scripts/e2e-driver.mjs <arquivo-de-passos.json>
// Passo: { "send": "texto", "waitFor": "regex opcional", "timeoutMs": 120000, "sleepMs": 0 }
// Antes de enviar cada "send", espera o padrao waitFor (padrao: prompt "> " ou "(s/n) ").
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const stepsFile = process.argv[2];
if (!stepsFile) {
  console.error('Uso: node scripts/e2e-driver.mjs <passos.json>');
  process.exit(1);
}
const steps = JSON.parse(fs.readFileSync(stepsFile, 'utf-8'));

// Spawn tsx's actual CLI script via `node` directly (bypassing npx and the
// .cmd shim) so killing this process actually kills the real node process on
// Windows instead of orphaning it — shell:true / .cmd wrappers spawn a
// cmd.exe layer whose child survives child.kill(), leaving zombies that hold
// the SQLite file and the web server port.
const tsxCli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
const child = spawn(process.execPath, [tsxCli, 'src/index.ts'], {
  cwd: process.cwd(),
  shell: false,
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buf = '';
child.stdout.on('data', d => { buf += String(d); process.stdout.write(d); });
child.stderr.on('data', d => { buf += String(d); process.stdout.write(d); });

const DEFAULT_WAIT = String.raw`(?:> |sempre permitir\) )\s*$`;
const GLOBAL_KILL_MS = 9 * 60 * 1000;
const killer = setTimeout(() => {
  console.error('\n[driver] tempo global excedido, matando processo');
  child.kill();
  process.exit(2);
}, GLOBAL_KILL_MS);

function waitFor(pattern, timeoutMs) {
  const re = new RegExp(pattern);
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const iv = setInterval(() => {
      if (re.test(buf.slice(-500))) {
        clearInterval(iv);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(iv);
        reject(new Error(`[driver] timeout esperando: ${pattern}`));
      }
    }, 200);
  });
}

try {
  for (const step of steps) {
    if (step.sleepMs) await new Promise(r => setTimeout(r, step.sleepMs));
    await waitFor(step.waitFor ?? DEFAULT_WAIT, step.timeoutMs ?? 120_000);
    if (step.send !== undefined) {
      buf = '';
      child.stdin.write(step.send + '\n');
    }
  }
  await new Promise(r => child.on('close', r));
  clearTimeout(killer);
  console.log('\n[driver] sessao concluida');
} catch (err) {
  console.error('\n' + err.message);
  child.kill();
  clearTimeout(killer);
  process.exit(1);
}
