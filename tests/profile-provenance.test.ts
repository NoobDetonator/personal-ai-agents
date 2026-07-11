import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAgentProfileProvenance } from '../src/agents/profile-provenance.js';
import type { ProfileInfo } from '../src/agents/prompt-composer.js';

const profiles: ProfileInfo[] = [
  {
    id: 'programador',
    title: 'Programador',
    summary: 'Implementa mudancas verificadas.',
    file: 'skills/system-prompter/perfis/programador.md',
    revision: 'abc123def456',
  },
];

test('proveniencia manual quando nenhum perfil foi registrado', () => {
  assert.deepEqual(resolveAgentProfileProvenance({}, profiles), {
    source: 'manual',
    status: 'manual',
    profileId: null,
    profileTitle: null,
    profileFile: null,
    appliedRevision: null,
    currentRevision: null,
  });
});

test('perfil sincronizado quando revisoes coincidem', () => {
  const result = resolveAgentProfileProvenance(
    { profile: 'programador', profileRevision: 'abc123def456' },
    profiles,
  );

  assert.equal(result.status, 'current');
  assert.equal(result.profileTitle, 'Programador');
  assert.equal(result.profileFile, 'skills/system-prompter/perfis/programador.md');
});

test('detecta perfil desatualizado, sem revisao e ausente', () => {
  assert.equal(
    resolveAgentProfileProvenance(
      { profile: 'programador', profileRevision: 'old-revision' },
      profiles,
    ).status,
    'outdated',
  );
  assert.equal(
    resolveAgentProfileProvenance({ profile: 'programador' }, profiles).status,
    'untracked',
  );
  assert.equal(
    resolveAgentProfileProvenance(
      { profile: 'perfil-removido', profileRevision: 'abc' },
      profiles,
    ).status,
    'missing',
  );
});
