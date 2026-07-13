import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSkills } from '../src/skills/loader.js';
import { buildActivatedSkills, selectSkillsForMessages } from '../src/skills/router.js';

loadSkills();

test('criacao de agentes ativa system-prompter sem depender de useSkill', () => {
  const selected = selectSkillsForMessages([{ role: 'user', content: 'Crie uma equipe com pesquisador, programador e designer.' }]);
  assert.equal(selected.some(skill => skill.id === 'system-prompter'), true);
});

test('autoria de skill ativa criando-skills automaticamente', () => {
  const activated = buildActivatedSkills([{ role: 'user', content: 'Crie uma skill para revisar releases.' }]);
  assert.equal(activated.ids.includes('criando-skills'), true);
  assert.match(activated.systemBlock, /Skills Operacionais Ativadas pelo Runtime/);
});

test('conversa casual nao injeta manuais de skill', () => {
  const activated = buildActivatedSkills([{ role: 'user', content: 'Bom dia, tudo bem?' }]);
  assert.deepEqual(activated.ids, []);
  assert.equal(activated.systemBlock, '');
});
