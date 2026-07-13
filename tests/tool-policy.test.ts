import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedToolNamesForAgent } from '../src/tools/policy.js';

const AVAILABLE = [
  'readFile', 'writeFile', 'deleteFile', 'runCommand',
  'createAgent', 'configureAgent', 'deleteAgent',
  'createSkill', 'updateSkill', 'editSoul', 'updateUserProfile',
  'deleteConversation', 'clearConversations',
  'createSchedule', 'deleteSchedule', 'clearBoard',
  'webSearch', 'sendMessage',
];

test('principal conserva o conjunto completo de ferramentas', () => {
  assert.deepEqual(allowedToolNamesForAgent('principal', null, AVAILABLE), AVAILABLE);
});

test('manager nao recebe autoria de skill nem mutacoes exclusivas da principal', () => {
  const allowed = allowedToolNamesForAgent('manager', null, AVAILABLE);
  for (const sensitive of ['createSkill', 'updateSkill', 'editSoul', 'updateUserProfile']) {
    assert.equal(allowed.includes(sensitive), false, sensitive);
  }
  assert.equal(allowed.includes('createAgent'), true);
});

test('worker comum recebe apenas ferramentas basicas e nao administrativas', () => {
  const allowed = allowedToolNamesForAgent('worker', 'pesquisador', AVAILABLE);
  assert.equal(allowed.includes('readFile'), true);
  assert.equal(allowed.includes('webSearch'), true);
  assert.equal(allowed.includes('runCommand'), false);
  assert.equal(allowed.includes('deleteFile'), false);
  assert.equal(allowed.includes('createAgent'), false);
  assert.equal(allowed.includes('clearBoard'), false);
});

test('worker tecnico recebe shell e delete de arquivo, mas nao administracao', () => {
  const allowed = allowedToolNamesForAgent('worker', 'programador', AVAILABLE);
  assert.equal(allowed.includes('runCommand'), true);
  assert.equal(allowed.includes('deleteFile'), true);
  assert.equal(allowed.includes('deleteAgent'), false);
  assert.equal(allowed.includes('createSkill'), false);
});
