import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ModelMessage, ToolSet } from 'ai';
import { prepareToolStep, routeToolsForMessages } from '../src/agents/tool-routing.js';

const tools = Object.fromEntries([
  'readFile', 'writeFile', 'editFile', 'runCommand', 'webSearch', 'readWebPage',
  'createAgent', 'listAgentProfiles', 'listSkills', 'useSkill', 'createTask', 'delegateTasks',
].map(name => [name, {}])) as ToolSet;

function user(content: string): ModelMessage[] {
  return [{ role: 'user', content }];
}

test('solicitacao concreta de arquivo exige ferramenta e limita o conjunto', () => {
  const decision = routeToolsForMessages(user('Crie uma landing page no workspace.'), tools);
  assert.equal(decision.requiresTool, true);
  assert.equal(decision.activeTools.includes('writeFile'), true);
  assert.equal(decision.activeTools.includes('createAgent'), false);
});

test('pergunta explicativa nao forca tool calling', () => {
  const decision = routeToolsForMessages(user('Como criar uma landing page boa?'), tools);
  assert.equal(decision.requiresTool, false);
});

test('pedido de equipe oferece apenas ferramentas disponiveis e relacionadas', () => {
  const decision = routeToolsForMessages(user('Crie uma equipe de agentes para o projeto.'), tools);
  assert.equal(decision.requiresTool, true);
  assert.equal(decision.activeTools.includes('createAgent'), true);
  assert.equal(decision.activeTools.includes('listAgentProfiles'), true);
});

test('primeiro passo exige tool e os seguintes voltam para auto', () => {
  const prepare = prepareToolStep({ requiresTool: true, activeTools: ['writeFile'], matchedDomains: ['files'], requiredEffects: ['write'] });
  assert.ok(prepare);
  assert.equal(prepare({ stepNumber: 0 }).toolChoice, 'required');
  assert.equal(prepare({ stepNumber: 1 }).toolChoice, 'auto');
});

test('pedido em linguagem natural com agentes no plural inclui criacao, delegacao, web e arquivos', () => {
  const decision = routeToolsForMessages(user(
    'Crie alguns agentes especializados, espalha agentes pela internet e guarde tudo catalogado e documentado.',
  ), tools);
  assert.equal(decision.activeTools.includes('createAgent'), true);
  assert.equal(decision.activeTools.includes('delegateTasks'), true);
  assert.equal(decision.activeTools.includes('webSearch'), true);
  assert.equal(decision.activeTools.includes('writeFile'), true);
});

test('provedor com thinking pode manter tool choice automatico desde o primeiro passo', () => {
  const prepare = prepareToolStep(
    { requiresTool: true, activeTools: ['writeFile'], matchedDomains: ['files'], requiredEffects: ['write'] },
    'auto',
  );
  assert.ok(prepare);
  assert.equal(prepare({ stepNumber: 0 }).toolChoice, 'auto');
  assert.equal(prepare({ stepNumber: 1 }).toolChoice, 'auto');
});
