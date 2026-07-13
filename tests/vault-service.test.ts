import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let connection: typeof import('../src/db/connection.js');
let projects: typeof import('../src/projects/service.js');
let context: typeof import('../src/projects/context.js');
let memory: typeof import('../src/projects/agent-memory.js');
let vault: typeof import('../src/memory/vault-service.js');
let metadata: typeof import('../src/memory/metadata.js');
let project: import('../src/projects/service.js').Project;
let root: string;

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-vault-'));
  process.chdir(root);
  connection = await import('../src/db/connection.js');
  projects = await import('../src/projects/service.js');
  context = await import('../src/projects/context.js');
  memory = await import('../src/projects/agent-memory.js');
  vault = await import('../src/memory/vault-service.js');
  metadata = await import('../src/memory/metadata.js');
  connection.initDatabase();
  project = projects.createProject({ name: 'Vault Isolado' });

  const files = projects.resolveProjectRoot(project);
  fs.mkdirSync(path.join(files, 'src'), { recursive: true });
  fs.writeFileSync(path.join(files, 'src', 'utils.ts'), 'export const answer = 42;\n');
  fs.writeFileSync(path.join(files, 'src', 'app.ts'), "import { answer } from './utils';\nconsole.log(answer);\n");

  context.runWithProjectContext(projects.buildProjectContext(project.id), () => {
    memory.saveScopedDeepMemory(
      'aria',
      'decisao-sqlite',
      'Decisao sobre persistencia local',
      '# SQLite local\n\nUsar SQLite como fonte indexada. Relacionada a [[Privacidade]].',
      {
        noteType: 'decision',
        status: 'active',
        sourceType: 'user',
        tags: ['arquitetura', 'memoria'],
        aliases: ['Persistencia local'],
        implementedBy: ['src/app.ts'],
      },
    );
  });
});

after(() => connection.closeDatabase());

test('contrato Obsidian preserva propriedades, wikilinks e corpo', () => {
  const markdown = metadata.buildVaultMarkdown({
    title: 'Decisao',
    description: 'Teste',
    content: 'Conecta com [[Outra nota]].',
    tags: ['arquitetura'],
    aliases: ['ADR'],
  });
  const parsed = metadata.parseVaultMetadata(markdown, 'fallback');
  assert.equal(parsed.title, 'Decisao');
  assert.deepEqual(parsed.tags, ['arquitetura']);
  assert.deepEqual(parsed.aliases, ['ADR']);
  assert.deepEqual(parsed.links, ['Outra nota']);
});

test('indexa Markdown e busca por FTS sem depender de modelo', () => {
  const result = vault.synchronizeProjectVault(project.id);
  assert.equal(result.indexed, 1);
  const found = vault.searchProjectVault(project.id, 'SQLite persistencia');
  assert.equal(found.length, 1);
  assert.equal(found[0].noteType, 'decision');
  assert.equal(found[0].sourceType, 'user');
  assert.deepEqual(found[0].tags, ['arquitetura', 'memoria']);
  assert.ok(!JSON.stringify(found[0]).includes(root));
});

test('separa grafo de memoria, codigo e pontes explicitas', () => {
  const result = vault.rebuildProjectKnowledge(project.id);
  assert.equal(result.code.files, 2);
  assert.equal(result.code.edges, 1);

  const graph = vault.getProjectKnowledgeGraph(project.id, 'all');
  const nodes = graph.nodes as Array<any>;
  const edges = graph.edges as Array<any>;
  assert.ok(nodes.some(node => node.layer === 'memory' && node.kind === 'decision'));
  assert.ok(nodes.some(node => node.layer === 'memory' && node.kind === 'concept'));
  assert.ok(nodes.some(node => node.layer === 'code' && node.source_ref === 'src/app.ts'));
  assert.ok(edges.some(edge => edge.layer === 'memory' && edge.relation === 'references'));
  assert.ok(edges.some(edge => edge.layer === 'code' && edge.relation === 'imports'));
  assert.ok(edges.some(edge => edge.layer === 'bridge' && edge.relation === 'implemented_by'));
});

test('feedback corrigido contesta o indice sem reescrever a nota canonica', () => {
  const document = vault.searchProjectVault(project.id, 'SQLite')[0];
  const before = fs.readFileSync(
    path.join(path.dirname(projects.resolveProjectRoot(project)), '.aria', 'agents', 'aria', 'memories', 'decisao-sqlite.md'),
    'utf-8',
  );
  vault.recordMemoryFeedback({
    projectId: project.id,
    memoryId: document.id,
    agentId: 'aria',
    question: 'Esta decisao continua correta?',
    outcome: 'corrected',
    notes: 'Precisa considerar backup.',
  });
  const after = fs.readFileSync(
    path.join(path.dirname(projects.resolveProjectRoot(project)), '.aria', 'agents', 'aria', 'memories', 'decisao-sqlite.md'),
    'utf-8',
  );
  assert.equal(after, before);
  assert.equal(vault.searchProjectVault(project.id, '', { status: 'contested' }).length, 1);

  const reflection = vault.reflectProjectMemory(project.id);
  assert.equal(reflection.outcomes.corrected, 1);
  assert.match(reflection.content, /Documento derivado/);
  assert.ok(fs.existsSync(path.join(path.dirname(projects.resolveProjectRoot(project)), '.aria', 'reflections', 'LESSONS.md')));
});

test('views mostram conhecimento que exige revisao e notas sem conexao', () => {
  const overview = vault.getVaultOverview(project.id);
  assert.equal(overview.total, 1);
  assert.ok(overview.nodes >= 4);
  assert.equal(overview.views.find(view => view.id === 'needs-review')?.count, 1);
});

test('filtro por agente preserva o isolamento de workers', () => {
  context.runWithProjectContext(projects.buildProjectContext(project.id), () => {
    memory.saveScopedDeepMemory(
      'worker-ui',
      'aprendizado-isolado',
      'Aprendizado privado do worker',
      '# Aprendizado isolado\n\nDetalhe que pertence somente ao worker.',
      {
        noteType: 'lesson',
        status: 'tentative',
        sourceType: 'agent',
      },
    );
  });

  const workerResults = vault.searchProjectVault(project.id, '', { agentId: 'worker-ui' });
  const ariaResults = vault.searchProjectVault(project.id, '', { agentId: 'aria' });
  assert.equal(workerResults.length, 1);
  assert.ok(workerResults.every(document => document.agentId === 'worker-ui'));
  assert.ok(ariaResults.every(document => document.agentId === 'aria'));
  assert.ok(!ariaResults.some(document => document.agentId === 'worker-ui'));
  const unlinked = vault.searchProjectVault(project.id, '', { agentId: 'worker-ui', view: 'unlinked' });
  const withFeedback = vault.searchProjectVault(project.id, '', { view: 'feedback' });
  assert.equal(unlinked.length, 1);
  assert.equal(unlinked[0].name, 'aprendizado-isolado');
  assert.ok(withFeedback.some(document => document.name === 'decisao-sqlite'));
});
