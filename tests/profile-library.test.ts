import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const profilesDir = path.resolve(import.meta.dirname, '..', 'skills', 'system-prompter', 'perfis');
const nonRoles = new Set(['core-operacional.md', 'aria-super-system.md']);

function read(file: string): string {
  return fs.readFileSync(path.join(profilesDir, file), 'utf8');
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

test('biblioteca tem inventario esperado e perfis operacionais compactos', () => {
  const files = fs.readdirSync(profilesDir).filter(file => file.endsWith('.md')).sort();
  assert.equal(files.length, 20);

  for (const file of files) {
    const words = countWords(read(file));
    const limit = file === 'aria-super-system.md' ? 1000 : nonRoles.has(file) ? 500 : 700;
    assert.ok(words <= limit, `${file}: ${words} palavras excedem o limite ${limit}`);
  }
});

test('perfis nao reintroduzem ferramentas ou regras incompativeis conhecidas', () => {
  const joined = fs.readdirSync(profilesDir)
    .filter(file => file.endsWith('.md'))
    .map(read)
    .join('\n');

  const banned = [
    /todos na mesma tool call/i,
    /NUNCA sequentialize/i,
    /reader-proxy/i,
    /research-writer/i,
    /standard pandas\/Excel workflow/i,
  ];
  for (const pattern of banned) {
    assert.doesNotMatch(joined, pattern);
  }
});

test('regras sensiveis estao condicionadas ao runtime real', () => {
  const programmer = read('programador.md');
  assert.match(programmer, /chamadas de ferramenta separadas no mesmo turno/i);
  assert.match(programmer, /quando o runtime permitir/i);

  const designer = read('designer.md');
  assert.match(designer, /somente quando uma ferramenta de browser estiver realmente disponivel/i);
  assert.match(designer, /inspecao visual final ficou pendente/i);

  const researcher = read('pesquisador.md');
  assert.match(researcher, /uma fonte primaria forte pode bastar/i);
  assert.match(researcher, /tres ou mais quando o tema for disputado/i);

  const researchReviewer = read('revisor-pesquisa.md');
  assert.match(researchReviewer, /data real do sistema/i);
  assert.match(researchReviewer, /fontes comunitárias rotuladas como secundárias/i);

  const analyst = read('analista-dados.md');
  assert.match(analyst, /Nao presuma pandas, Excel/i);
});

test('perfil mestre declara seu papel real e a hierarquia de autoridade', () => {
  const aria = read('aria-super-system.md');
  assert.match(aria, /nao e carregado automaticamente pelo runtime/i);
  assert.ok(aria.indexOf('Seguranca, privacidade e permissoes') < aria.indexOf('Pedido atual do usuario'));
  assert.match(aria, /mensagem de usuario de baixa autoridade/i);
});
