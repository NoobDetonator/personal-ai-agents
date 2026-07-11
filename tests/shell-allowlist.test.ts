import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowlisted } from '../src/tools/shell.js';

const allowlist = ['git status', 'git log', 'dir', 'npm run'];

test('permite comando exato e prefixo com fronteira de palavra', () => {
  assert.ok(isAllowlisted('git status', allowlist));
  assert.ok(isAllowlisted('git status --short', allowlist));
  assert.ok(isAllowlisted('npm run build', allowlist));
});

test('nao permite prefixo sem fronteira (dirx != dir)', () => {
  assert.ok(!isAllowlisted('dirx', allowlist));
  assert.ok(!isAllowlisted('git statusx', allowlist));
});

test('nao permite comando fora da lista', () => {
  assert.ok(!isAllowlisted('rm -rf /', allowlist));
  assert.ok(!isAllowlisted('git push', allowlist));
});

test('encadeamento nunca passa pela allowlist', () => {
  assert.ok(!isAllowlisted('git status; rm x', allowlist));
  assert.ok(!isAllowlisted('git status && rm x', allowlist));
  assert.ok(!isAllowlisted('git status | out-file x', allowlist));
  assert.ok(!isAllowlisted('git status > x', allowlist));
  assert.ok(!isAllowlisted('git status < x', allowlist));
});

test('substituicao de comando nunca passa pela allowlist', () => {
  assert.ok(!isAllowlisted('git status $(rm x)', allowlist));
  assert.ok(!isAllowlisted('git status `rm x`', allowlist));
  assert.ok(!isAllowlisted('git status $env:SECRET', allowlist));
});

test('multi-linha nunca passa pela allowlist', () => {
  assert.ok(!isAllowlisted('git status\nrm x', allowlist));
  assert.ok(!isAllowlisted("git status\r\nrm x", allowlist));
});

test('lista vazia nao permite nada', () => {
  assert.ok(!isAllowlisted('git status', []));
  assert.ok(!isAllowlisted('', allowlist));
});
