import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAuthorSkills } from '../src/tools/index.js';
import {
  askConfirmation,
  getPendingConfirmations,
  resolveConfirmation,
} from '../src/chat/confirm.js';

test('somente a agente principal pode criar ou atualizar skills', () => {
  assert.equal(canAuthorSkills('principal'), true);
  assert.equal(canAuthorSkills('manager'), false);
  assert.equal(canAuthorSkills('worker'), false);
});

test('confirmacao sensivel nao oferece permissao permanente', async () => {
  const resultPromise = askConfirmation('teste de governanca', { allowAlways: false });
  const pending = getPendingConfirmations().find(item => item.message === 'teste de governanca');
  assert.ok(pending);
  assert.equal(pending.allowAlways, false);

  // Frontend antigo pode enviar "always"; o backend reduz para aprovacao unica.
  assert.equal(resolveConfirmation(pending.id, 'always'), true);
  const result = await resultPromise;
  assert.equal(result.answer, 'yes');
  assert.equal(getPendingConfirmations().some(item => item.id === pending.id), false);
});
