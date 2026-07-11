import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// O compositor resolve a biblioteca a partir do cwd (skills/system-prompter/
// perfis), entao os testes montam uma biblioteca falsa num temp dir. Os perfis
// REAIS do repo sao validados no ultimo teste via extractProfileInfo.
let composer: typeof import('../src/agents/prompt-composer.js');

before(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-composer-'));
  process.chdir(root);
  const perfis = path.join(root, 'skills', 'system-prompter', 'perfis');
  fs.mkdirSync(perfis, { recursive: true });
  fs.writeFileSync(
    path.join(perfis, 'testador.md'),
    '# Testador\n\n> Integração Aria: nota de integracao que deve ser ignorada\n> no resumo.\n\nVocê é um **testador rigoroso**: quebra o que parece pronto e reporta evidências.\n\n## Regras\n- ...\n',
    'utf-8',
  );
  fs.writeFileSync(
    path.join(perfis, 'core-operacional.md'),
    '# Core\n\nNucleo comum (nao e papel instanciavel).\n',
    'utf-8',
  );
  fs.writeFileSync(
    path.join(perfis, 'aria-super-system.md'),
    '# Aria\n\nPrompt mestre (nao e papel instanciavel).\n',
    'utf-8',
  );
  composer = await import('../src/agents/prompt-composer.js');
});

test('listProfiles exclui core-operacional e aria-super-system', () => {
  const ids = composer.listProfiles().map(p => p.id);
  assert.deepEqual(ids, ['testador']);
});

test('extrai titulo e resumo pulando blockquote de integracao', () => {
  const profile = composer.getProfile('testador');
  assert.ok(profile);
  assert.equal(profile.title, 'Testador');
  assert.ok(profile.summary.includes('testador rigoroso'));
  assert.ok(!profile.summary.includes('Integração Aria'));
});

test('composeSoul gera soul curta com identidade, resumo, missao e manual', () => {
  const soul = composer.composeSoul({
    profileId: 'testador',
    agentName: 'Quebra-tudo',
    team: 'qa',
    temporary: true,
    mission: 'Testar a landing page de cafes em mobile e desktop.',
  });
  assert.ok(soul.includes('Quebra-tudo'));
  assert.ok(soul.includes('temporario'));
  assert.ok(soul.includes('equipe "qa"'));
  assert.ok(soul.includes('testador rigoroso'));
  assert.ok(soul.includes('Sua funcao neste trabalho: Testar a landing page'));
  assert.ok(soul.includes('skills/system-prompter/perfis/testador.md'));
  assert.ok(composer.countWords(soul) <= composer.MAX_SOUL_WORDS);
});

test('composeSoul rejeita perfil inexistente listando os disponiveis', () => {
  assert.throws(
    () => composer.composeSoul({ profileId: 'nao-existe', agentName: 'X' }),
    /Disponiveis: testador/,
  );
});

test('composeSoul rejeita missao longa demais', () => {
  const longa = Array(composer.MAX_MISSION_WORDS + 10).fill('palavra').join(' ');
  assert.throws(
    () => composer.composeSoul({ profileId: 'testador', agentName: 'X', mission: longa }),
    /initialMemory/,
  );
});

test('validateSoulText rejeita soul manual acima do limite', () => {
  const longa = Array(composer.MAX_SOUL_WORDS + 1).fill('palavra').join(' ');
  assert.match(composer.validateSoulText(longa) ?? '', /excede o limite/);
  assert.equal(composer.validateSoulText('curta e boa'), null);
});

test('validateSeedMemory rejeita memoria inicial gigante', () => {
  assert.match(composer.validateSeedMemory('x'.repeat(composer.MAX_SEED_MEMORY_CHARS + 1)) ?? '', /excede o limite/);
  assert.equal(composer.validateSeedMemory('contexto normal'), null);
});

test('todos os perfis reais do repositorio produzem titulo e resumo utilizaveis', () => {
  const repoPerfis = path.resolve(import.meta.dirname, '..', 'skills', 'system-prompter', 'perfis');
  const roleFiles = fs.readdirSync(repoPerfis).filter(
    f => f.endsWith('.md') && f !== 'core-operacional.md' && f !== 'aria-super-system.md',
  );
  assert.ok(roleFiles.length >= 15, 'biblioteca real deveria ter os perfis de papel');
  for (const file of roleFiles) {
    const markdown = fs.readFileSync(path.join(repoPerfis, file), 'utf-8');
    const info = composer.extractProfileInfo(markdown, file.replace(/\.md$/, ''));
    assert.ok(info.title.length > 2, `${file}: titulo vazio`);
    assert.ok(info.summary.length > 40, `${file}: resumo curto demais ("${info.summary}")`);
    assert.ok(!info.summary.includes('Integração Aria'), `${file}: resumo vazou blockquote`);
  }
});
