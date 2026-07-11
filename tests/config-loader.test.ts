import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// O loader captura o cwd no import, entao muda para um temporario antes.
let loader: typeof import('../src/config/loader.js');
let configPath: string;
let dir: string;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-config-'));
  process.chdir(dir);
  loader = await import('../src/config/loader.js');
  configPath = loader.getConfigPath();
});

test('sem arquivo: cria config.json com defaults', () => {
  loader.loadConfig();
  assert.ok(fs.existsSync(configPath));
  assert.equal(loader.getConfig().shell.mode, 'confirm');
});

test('reload sem mudancas nao regrava o arquivo (sem loop de watcher)', async () => {
  loader.loadConfig();
  const mtime = fs.statSync(configPath).mtimeMs;
  await sleep(60);
  loader.loadConfig();
  assert.equal(fs.statSync(configPath).mtimeMs, mtime);
});

test('config parcial: preserva valores do usuario e materializa defaults', () => {
  fs.writeFileSync(configPath, JSON.stringify({ web: { port: 4000 } }), 'utf-8');
  loader.loadConfig();
  assert.equal(loader.getConfig().web.port, 4000);
  const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  assert.equal(onDisk.web.port, 4000);
  assert.equal(onDisk.defaultAgent, 'aria');
});

test('aceita BOM UTF-8 sem classificar o config como corrompido', () => {
  const backupsBefore = fs.readdirSync(dir).filter(f => f.startsWith('config.json.invalid-')).length;
  fs.writeFileSync(configPath, '\uFEFF' + JSON.stringify({ web: { port: 4040 } }), 'utf-8');

  loader.loadConfig();

  assert.equal(loader.getConfig().web.port, 4040);
  const backupsAfter = fs.readdirSync(dir).filter(f => f.startsWith('config.json.invalid-')).length;
  assert.equal(backupsAfter, backupsBefore);
  assert.notEqual(fs.readFileSync(configPath, 'utf-8').charCodeAt(0), 0xfeff);
});

test('modo somente leitura aceita BOM e nao altera bytes do arquivo', () => {
  const raw = '\uFEFF' + JSON.stringify({ web: { port: 4050 } }, null, 2);
  fs.writeFileSync(configPath, raw, 'utf-8');

  loader.loadConfig({ writeBack: false });

  assert.equal(loader.getConfig().web.port, 4050);
  assert.equal(fs.readFileSync(configPath, 'utf-8'), raw);
});

test('JSON corrompido: preserva original em backup e usa defaults', () => {
  fs.writeFileSync(configPath, '{{{nao-e-json', 'utf-8');
  loader.loadConfig();
  const backups = fs.readdirSync(dir).filter(f => f.startsWith('config.json.invalid-'));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, backups[0]), 'utf-8'), '{{{nao-e-json');
  assert.equal(loader.getConfig().web.port, 3131);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(configPath, 'utf-8')));
});

test('valor invalido: arquivo NAO alterado, defaults em memoria', () => {
  const invalid = JSON.stringify({ shell: { mode: 'banana' } }, null, 2);
  fs.writeFileSync(configPath, invalid, 'utf-8');
  loader.loadConfig();
  assert.equal(loader.getConfig().shell.mode, 'confirm');
  assert.equal(fs.readFileSync(configPath, 'utf-8'), invalid);
});

test('raiz nao-objeto e tratada como corrompida sem sobrescrever silenciosamente', () => {
  fs.writeFileSync(configPath, '[1,2,3]', 'utf-8');
  loader.loadConfig();
  const backups = fs.readdirSync(dir).filter(f => f.startsWith('config.json.invalid-'));
  assert.ok(backups.length >= 1);
  assert.equal(loader.getConfig().shell.mode, 'confirm');
});

test('saveConfig nao deixa arquivo .tmp residual', () => {
  loader.loadConfig();
  loader.saveConfig();
  assert.ok(!fs.existsSync(`${configPath}.tmp`));
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(configPath, 'utf-8')));
});
