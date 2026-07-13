import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let connection: typeof import('../src/db/connection.js');
let projects: typeof import('../src/projects/service.js');
let context: typeof import('../src/projects/context.js');
let memory: typeof import('../src/projects/agent-memory.js');
let usage: typeof import('../src/agents/usage.js');
let memoryTools: typeof import('../src/tools/memory-ops.js');

before(async () => {
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'paa-scoped-memory-')));
  connection = await import('../src/db/connection.js');
  projects = await import('../src/projects/service.js');
  context = await import('../src/projects/context.js');
  memory = await import('../src/projects/agent-memory.js');
  usage = await import('../src/agents/usage.js');
  memoryTools = await import('../src/tools/memory-ops.js');
  connection.initDatabase();
});

after(() => connection.closeDatabase());

test('memoria ditada pelo usuario preserva somente o trecho literal', async () => {
  const project = projects.createProject({ name: 'Memoria literal' });
  const instruction = 'todo documento de D&D deve ficar na pasta raiz dnd/ e citar fontes primarias';
  const ctx = {
    ...projects.buildProjectContext(project.id),
    userMessage: `Salve na memoria esta convencao: ${instruction}. Confirme depois.`,
  };
  const tools = memoryTools.createMemoryTools('aria') as any;

  await context.runWithProjectContext(ctx, async () => {
    const rejected = await tools.saveDeepMemory.execute({
      slug: 'convencao-invalida', description: 'teste', content: `${instruction}\n- Regra inventada`, sourceType: 'agent',
    }, { toolCallId: '1', messages: [] });
    assert.match(rejected.error, /ditada pelo usuario/);

    const saved = await tools.saveDeepMemory.execute({
      slug: 'convencao', description: 'teste', content: `${instruction}\n- Regra inventada`,
      sourceType: 'user', verbatimExcerpt: instruction,
    }, { toolCallId: '2', messages: [] });
    assert.equal(saved.success, true);
    const stored = memory.readScopedDeepMemory('aria', 'convencao') ?? '';
    assert.match(stored, /todo documento de D&D deve ficar/);
    assert.doesNotMatch(stored, /Regra inventada/);
  });
});

test('comparacao literal tolera apenas formatacao e acentos, mas devolve o texto humano original', () => {
  const human = 'Salve exatamente: “Convenção válida com revisão.”';
  assert.equal(memoryTools.matchUserLiteral(human, '**convencao valida com revisao.**'), 'Convenção válida com revisão.');
  assert.equal(memoryTools.matchUserLiteral(human, 'Convenção válida com uma regra extra.'), null);
});

test('memorias e uso ficam isolados por projeto', () => {
  const a = projects.createProject({ name: 'Memoria A' });
  const b = projects.createProject({ name: 'Memoria B' });
  const ctxA = projects.buildProjectContext(a.id);
  const ctxB = projects.buildProjectContext(b.id);

  context.runWithProjectContext(ctxA, () => {
    memory.appendScopedMemorySection('aria', 'Projeto', 'segredo A');
    memory.appendScopedDailyNote('aria', 'evento A');
    memory.saveScopedDeepMemory('aria', 'contexto', 'somente A', 'conteudo profundo A');
    usage.addUsage(10, 2, 0, 'deepseek-v4-flash', { agentId: 'aria' });
  });
  context.runWithProjectContext(ctxB, () => {
    memory.appendScopedMemorySection('aria', 'Projeto', 'segredo B');
    memory.appendScopedDailyNote('aria', 'evento B');
    memory.saveScopedDeepMemory('aria', 'contexto', 'somente B', 'conteudo profundo B');
    usage.addUsage(5, 1, 0, 'deepseek-v4-flash', { agentId: 'aria' });
  });

  context.runWithProjectContext(ctxA, () => {
    assert.match(memory.readScopedMemory('aria'), /segredo A/);
    assert.doesNotMatch(memory.readScopedMemory('aria'), /segredo B/);
    assert.match(memory.readScopedDailyNote('aria'), /evento A/);
    assert.match(memory.readScopedDeepMemory('aria', 'contexto') ?? '', /profundo A/);
  });
  context.runWithProjectContext(ctxB, () => {
    assert.match(memory.readScopedMemory('aria'), /segredo B/);
    assert.doesNotMatch(memory.readScopedMemory('aria'), /segredo A/);
    assert.match(memory.readScopedDailyNote('aria'), /evento B/);
    assert.match(memory.readScopedDeepMemory('aria', 'contexto') ?? '', /profundo B/);
  });

  const rows = connection.getDb().prepare(
    'SELECT project_id, COUNT(*) AS count FROM usage_events WHERE project_id IN (?, ?) GROUP BY project_id',
  ).all(a.id, b.id) as Array<{ project_id: string; count: number }>;
  assert.deepEqual(new Map(rows.map(row => [row.project_id, row.count])), new Map([[a.id, 1], [b.id, 1]]));
});

test('uso interrompido preserva contagem parcial e marca total como nao mensurado', () => {
  const project = projects.createProject({ name: 'Uso parcial' });
  context.runWithProjectContext(projects.buildProjectContext(project.id), () => {
    usage.addUsage(120, 8, 100, 'deepseek-v4-pro', { agentId: 'aria', usageKnown: false });
  });
  const row = connection.getDb().prepare(
    'SELECT input_tokens, output_tokens, cached_tokens, usage_known, cost_usd FROM usage_events WHERE project_id = ? ORDER BY rowid DESC LIMIT 1',
  ).get(project.id) as any;
  assert.deepEqual(
    { input: row.input_tokens, output: row.output_tokens, cached: row.cached_tokens, known: row.usage_known },
    { input: 120, output: 8, cached: 100, known: 0 },
  );
  assert.ok(row.cost_usd > 0);
});
