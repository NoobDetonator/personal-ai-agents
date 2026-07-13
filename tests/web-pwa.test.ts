import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const webRoot = path.resolve(import.meta.dirname, '..', 'web');

test('manifesto PWA aponta para icone e modo standalone', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(webRoot, 'manifest.webmanifest'), 'utf-8'));
  assert.equal(manifest.short_name, 'Agents');
  assert.equal(manifest.display, 'standalone');
  assert.ok(fs.existsSync(path.join(webRoot, manifest.icons[0].src.replace(/^\//, ''))));
});

test('service worker nunca armazena respostas da API', () => {
  const worker = fs.readFileSync(path.join(webRoot, 'sw.js'), 'utf-8');
  assert.match(worker, /pathname\.startsWith\('\/api\/'\)/);
  assert.doesNotMatch(worker, /cache\.put/);
  assert.match(worker, /offline\.html/);
});

test('pagina offline nao usa script inline', () => {
  const offline = fs.readFileSync(path.join(webRoot, 'offline.html'), 'utf-8');
  assert.doesNotMatch(offline, /onclick=/i);
  assert.doesNotMatch(offline, /<script/i);
});
