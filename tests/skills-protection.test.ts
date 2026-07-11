import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// O loader captura o cwd no import; roda num diretorio temporario com skills/.
let loader: typeof import('../src/skills/loader.js');
let skillsDir: string;

before(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-skills-'));
  process.chdir(root);
  skillsDir = path.join(root, 'skills');
  fs.mkdirSync(path.join(skillsDir, 'interna'), { recursive: true });
  fs.mkdirSync(path.join(skillsDir, 'do-usuario'), { recursive: true });
  fs.writeFileSync(
    path.join(skillsDir, 'interna', 'SKILL.md'),
    '---\nname: interna\ndescription: skill interna\nprotected: true\n---\n\ncorpo original\n',
    'utf-8',
  );
  fs.writeFileSync(
    path.join(skillsDir, 'do-usuario', 'SKILL.md'),
    '---\nname: do-usuario\ndescription: skill comum\n---\n\ncorpo comum\n',
    'utf-8',
  );
  loader = await import('../src/skills/loader.js');
  loader.loadSkills();
});

test('frontmatter protected e carregado no meta', () => {
  assert.equal(loader.getSkillMeta('interna')?.protected, true);
  assert.equal(loader.getSkillMeta('do-usuario')?.protected, false);
});

test('updateSkillFiles recusa skill protegida e preserva o arquivo', () => {
  assert.throws(
    () => loader.updateSkillFiles('interna', { instructions: 'corpo malicioso' }),
    /protegida/,
  );
  const content = fs.readFileSync(path.join(skillsDir, 'interna', 'SKILL.md'), 'utf-8');
  assert.ok(content.includes('corpo original'));
  assert.ok(!content.includes('malicioso'));
});

test('updateSkillFiles permite skill comum', () => {
  loader.updateSkillFiles('do-usuario', { instructions: 'corpo melhorado' });
  const content = fs.readFileSync(path.join(skillsDir, 'do-usuario', 'SKILL.md'), 'utf-8');
  assert.ok(content.includes('corpo melhorado'));
});

test('createSkillFiles nao gera skill protegida', () => {
  const meta = loader.createSkillFiles('nova', 'nova', 'desc', 'corpo');
  assert.equal(meta.protected, false);
});

test('skills internas do repositorio estao marcadas como protegidas', () => {
  // Le direto do repo (nao do temp): garante que o frontmatter real tem protected: true
  const repoSkills = path.resolve(import.meta.dirname, '..', 'skills');
  for (const id of ['criando-skills', 'system-prompter']) {
    const raw = fs.readFileSync(path.join(repoSkills, id, 'SKILL.md'), 'utf-8');
    const { data } = loader.parseFrontmatter(raw);
    assert.equal(data.protected, 'true', `skill ${id} deveria ter protected: true`);
  }
});
