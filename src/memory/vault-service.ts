import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/connection.js';
import { listProjectMemories, readProjectMemory } from '../projects/data-service.js';
import { getProject, resolveProjectRoot, LEGACY_PROJECT_ID } from '../projects/service.js';
import {
  normalizeReference,
  parseVaultMetadata,
  stableHash,
  stableId,
  type MemoryStatus,
} from './metadata.js';

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.css', '.scss',
  '.html', '.py', '.go', '.rs', '.java', '.kt', '.sql', '.graphql', '.yaml', '.yml',
]);
const IMPORT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.scss'];
const SKIP_DIRS = new Set(['.git', '.aria', 'node_modules', 'dist', 'build', 'coverage', '.next']);
const MAX_GRAPH_FILES = 2000;
const MAX_GRAPH_FILE_BYTES = 768 * 1024;

interface VaultDocumentRow {
  id: string;
  project_id: string;
  agent_id: string;
  kind: string;
  name: string;
  title: string;
  description: string | null;
  note_type: string;
  status: MemoryStatus;
  confidence: number;
  source_type: string;
  source_ref: string;
  tags_json: string;
  aliases_json: string;
  links_json: string;
  content: string;
  content_hash: string;
  file_mtime_ms: number;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface VaultDocument {
  id: string;
  projectId: string;
  agentId: string;
  kind: string;
  name: string;
  title: string;
  description: string;
  noteType: string;
  status: MemoryStatus;
  confidence: number;
  sourceType: string;
  sourceRef: string;
  tags: string[];
  aliases: string[];
  links: string[];
  preview: string;
  contentHash: string;
  modifiedAt: string;
  reviewedAt: string | null;
  score?: number;
}

function jsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function publicDocument(row: VaultDocumentRow & { score?: number; excerpt?: string }): VaultDocument {
  return {
    id: row.id,
    projectId: row.project_id,
    agentId: row.agent_id,
    kind: row.kind,
    name: row.name,
    title: row.title,
    description: row.description || '',
    noteType: row.note_type,
    status: row.status,
    confidence: row.confidence,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    tags: jsonArray(row.tags_json),
    aliases: jsonArray(row.aliases_json),
    links: jsonArray(row.links_json),
    preview: row.excerpt || row.content.replace(/\s+/g, ' ').slice(0, 260),
    contentHash: row.content_hash,
    modifiedAt: new Date(row.file_mtime_ms).toISOString(),
    reviewedAt: row.reviewed_at,
    score: row.score,
  };
}

function insertNode(input: {
  id: string;
  projectId: string;
  layer: 'memory' | 'code';
  kind: string;
  label: string;
  sourceRef?: string;
  status?: string;
  confidence?: number;
  contentHash?: string;
  metadata?: unknown;
}): void {
  getDb().prepare(
    `INSERT INTO knowledge_nodes
       (id, project_id, layer, kind, label, source_ref, status, confidence, content_hash, metadata_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label, kind = excluded.kind, source_ref = excluded.source_ref,
       status = excluded.status, confidence = excluded.confidence,
       content_hash = excluded.content_hash, metadata_json = excluded.metadata_json,
       updated_at = datetime('now')`,
  ).run(
    input.id, input.projectId, input.layer, input.kind, input.label, input.sourceRef ?? null,
    input.status ?? 'active', input.confidence ?? 1, input.contentHash ?? null,
    JSON.stringify(input.metadata ?? {}),
  );
}

function insertEdge(input: {
  projectId: string;
  layer: 'memory' | 'code' | 'bridge';
  sourceId: string;
  targetId: string;
  relation: string;
  origin?: 'extracted' | 'inferred' | 'user_confirmed';
  confidence?: number;
  evidence?: string;
  sourceHash?: string;
  status?: string;
  metadata?: unknown;
}): void {
  const id = stableId('edge', [
    input.projectId, input.layer, input.sourceId, input.targetId, input.relation,
  ].join(':'));
  getDb().prepare(
    `INSERT INTO knowledge_edges
       (id, project_id, layer, source_id, target_id, relation, origin, confidence,
        evidence, source_hash, status, metadata_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(project_id, layer, source_id, target_id, relation) DO UPDATE SET
       origin = excluded.origin, confidence = excluded.confidence, evidence = excluded.evidence,
       source_hash = excluded.source_hash, status = excluded.status,
       metadata_json = excluded.metadata_json, updated_at = datetime('now')`,
  ).run(
    id, input.projectId, input.layer, input.sourceId, input.targetId, input.relation,
    input.origin ?? 'extracted', input.confidence ?? 1, input.evidence ?? null,
    input.sourceHash ?? null, input.status ?? 'active', JSON.stringify(input.metadata ?? {}),
  );
}

export function synchronizeProjectVault(projectId: string): { indexed: number; links: number; concepts: number } {
  if (!getProject(projectId)) throw new Error('Projeto nao encontrado.');
  const db = getDb();
  const memories = listProjectMemories(projectId);
  const seen = new Set<string>();
  const parsedById = new Map<string, ReturnType<typeof parseVaultMetadata>>();
  const idByReference = new Map<string, string>();

  const upsert = db.prepare(
    `INSERT INTO vault_documents
       (id, project_id, agent_id, kind, name, title, description, note_type, status,
        confidence, source_type, source_ref, tags_json, aliases_json, links_json,
        content, content_hash, file_mtime_ms, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       agent_id = excluded.agent_id, kind = excluded.kind, name = excluded.name,
       title = excluded.title, description = excluded.description, note_type = excluded.note_type,
       status = CASE
         WHEN vault_documents.content_hash <> excluded.content_hash
          AND vault_documents.reviewed_at IS NOT NULL THEN 'needs_review'
         ELSE excluded.status
       END,
       confidence = excluded.confidence, source_type = excluded.source_type,
       tags_json = excluded.tags_json, aliases_json = excluded.aliases_json,
       links_json = excluded.links_json, content = excluded.content,
       content_hash = excluded.content_hash, file_mtime_ms = excluded.file_mtime_ms,
       updated_at = datetime('now')`,
  );

  db.transaction(() => {
    for (const memory of memories) {
      const full = readProjectMemory(projectId, memory.id);
      const metadata = parseVaultMetadata(full.content, memory.name, memory.description);
      const id = stableId('memory', `${projectId}:${memory.id}`);
      const hash = stableHash(full.content);
      upsert.run(
        id, projectId, memory.agentId, memory.kind, memory.name, metadata.title,
        metadata.description, metadata.noteType, metadata.status, metadata.confidence,
        metadata.sourceType, memory.id, JSON.stringify(metadata.tags),
        JSON.stringify(metadata.aliases), JSON.stringify(metadata.links), metadata.body,
        hash, Date.parse(memory.modifiedAt),
      );
      seen.add(id);
      parsedById.set(id, metadata);
      for (const ref of [memory.name, metadata.title, ...metadata.aliases]) {
        const normalized = normalizeReference(ref);
        if (normalized) idByReference.set(normalized, id);
      }
    }

    const existing = db.prepare('SELECT id FROM vault_documents WHERE project_id = ?')
      .all(projectId) as Array<{ id: string }>;
    for (const row of existing) {
      if (!seen.has(row.id)) db.prepare('DELETE FROM vault_documents WHERE id = ?').run(row.id);
    }

    // Feedback e uma sobreposicao derivada: nunca reescreve o Markdown, mas
    // precisa sobreviver a uma nova indexacao do mesmo conteudo.
    db.prepare(
      `UPDATE vault_documents
       SET status = CASE
         WHEN EXISTS (
           SELECT 1 FROM memory_feedback f
           WHERE f.memory_id = vault_documents.id AND f.outcome = 'corrected'
             AND f.source_hash = vault_documents.content_hash
         ) THEN 'contested'
         WHEN EXISTS (
           SELECT 1 FROM memory_feedback f
           WHERE f.memory_id = vault_documents.id AND f.source_hash IS NOT NULL
             AND f.source_hash <> vault_documents.content_hash
         ) THEN 'needs_review'
         ELSE status
       END
       WHERE project_id = ?`,
    ).run(projectId);

    db.prepare("DELETE FROM knowledge_edges WHERE project_id = ? AND layer IN ('memory', 'bridge')").run(projectId);
    db.prepare("DELETE FROM knowledge_nodes WHERE project_id = ? AND layer = 'memory'").run(projectId);

    const rows = db.prepare('SELECT * FROM vault_documents WHERE project_id = ?')
      .all(projectId) as VaultDocumentRow[];
    for (const row of rows) {
      insertNode({
        id: row.id,
        projectId,
        layer: 'memory',
        kind: row.note_type,
        label: row.title,
        sourceRef: row.source_ref,
        status: row.status,
        confidence: row.confidence,
        contentHash: row.content_hash,
        metadata: { agentId: row.agent_id, kind: row.kind, tags: jsonArray(row.tags_json) },
      });
    }

    for (const row of rows) {
      const metadata = parsedById.get(row.id) || parseVaultMetadata(row.content, row.name, row.description || '');
      for (const reference of metadata.links) {
        const normalized = normalizeReference(reference);
        if (!normalized) continue;
        let targetId = idByReference.get(normalized);
        if (!targetId) {
          targetId = stableId('concept', `${projectId}:${normalized}`);
          insertNode({
            id: targetId, projectId, layer: 'memory', kind: 'concept', label: reference,
            sourceRef: `concept/${normalized}`, status: 'tentative', confidence: 0.65,
          });
        }
        insertEdge({
          projectId, layer: 'memory', sourceId: row.id, targetId, relation: 'references',
          origin: 'extracted', confidence: 1, evidence: `[[${reference}]]`, sourceHash: row.content_hash,
        });
      }

      for (const tag of jsonArray(row.tags_json)) {
        const tagId = stableId('concept', `${projectId}:tag:${normalizeReference(tag)}`);
        insertNode({
          id: tagId, projectId, layer: 'memory', kind: 'tag', label: `#${tag}`,
          sourceRef: `tag/${tag}`, status: 'active', confidence: 1,
        });
        insertEdge({
          projectId, layer: 'memory', sourceId: row.id, targetId: tagId,
          relation: 'tagged', origin: 'extracted', confidence: 1, sourceHash: row.content_hash,
        });
      }

      for (const fileRef of metadata.implementedBy) {
        const relative = fileRef.replace(/\\/g, '/').replace(/^\.\//, '');
        const targetId = stableId('code', `${projectId}:${relative.toLowerCase()}`);
        insertEdge({
          projectId, layer: 'bridge', sourceId: row.id, targetId,
          relation: 'implemented_by', origin: 'user_confirmed', confidence: 1,
          evidence: fileRef, sourceHash: row.content_hash,
        });
      }
    }
  })();

  const counts = db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM knowledge_edges WHERE project_id = ? AND layer = 'memory') AS links,
       (SELECT COUNT(*) FROM knowledge_nodes WHERE project_id = ? AND layer = 'memory' AND kind IN ('concept', 'tag')) AS concepts`,
  ).get(projectId, projectId) as { links: number; concepts: number };
  return { indexed: seen.size, links: counts.links, concepts: counts.concepts };
}

function ftsQuery(query: string): string {
  return (query.match(/[\p{L}\p{N}_-]+/gu) ?? [])
    .slice(0, 10)
    .map(token => `"${token.replace(/"/g, '')}"*`)
    .join(' AND ');
}

export function searchProjectVault(
  projectId: string,
  query = '',
  filters?: { status?: string; type?: string; agentId?: string; view?: 'review' | 'unlinked' | 'feedback'; limit?: number },
): VaultDocument[] {
  synchronizeProjectVault(projectId);
  const db = getDb();
  const limit = Math.min(Math.max(filters?.limit ?? 50, 1), 200);
  const clauses = ['d.project_id = ?'];
  const params: unknown[] = [projectId];
  if (filters?.status) { clauses.push('d.status = ?'); params.push(filters.status); }
  if (filters?.type) { clauses.push('d.note_type = ?'); params.push(filters.type); }
  if (filters?.agentId) { clauses.push('d.agent_id = ?'); params.push(filters.agentId); }
  if (filters?.view === 'review') {
    clauses.push("d.status IN ('needs_review', 'contested', 'stale')");
  }
  if (filters?.view === 'unlinked') {
    clauses.push('NOT EXISTS (SELECT 1 FROM knowledge_edges e WHERE e.project_id = d.project_id AND e.source_id = d.id)');
  }
  if (filters?.view === 'feedback') {
    clauses.push(`EXISTS (
      SELECT 1 FROM memory_feedback f
      WHERE f.project_id = d.project_id AND f.memory_id = d.id
    )`);
  }

  const fts = ftsQuery(query);
  if (fts) {
    const rows = db.prepare(
      `SELECT d.*, bm25(vault_documents_fts, 5.0, 2.0, 1.0, 2.0) AS score,
              snippet(vault_documents_fts, 2, '', '', '...', 28) AS excerpt
       FROM vault_documents_fts
       JOIN vault_documents d ON d.rowid = vault_documents_fts.rowid
       WHERE vault_documents_fts MATCH ? AND ${clauses.join(' AND ')}
       ORDER BY score, d.updated_at DESC LIMIT ?`,
    ).all(fts, ...params, limit) as Array<VaultDocumentRow & { score: number; excerpt: string }>;
    return rows.map(publicDocument);
  }

  const rows = db.prepare(
    `SELECT d.* FROM vault_documents d WHERE ${clauses.join(' AND ')}
     ORDER BY d.updated_at DESC LIMIT ?`,
  ).all(...params, limit) as VaultDocumentRow[];
  return rows.map(publicDocument);
}

function scanCodeFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    if (files.length >= MAX_GRAPH_FILES) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (files.length >= MAX_GRAPH_FILES) return;
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(absolute);
        continue;
      }
      if (!entry.isFile() || !CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      try {
        if (fs.statSync(absolute).size <= MAX_GRAPH_FILE_BYTES) files.push(absolute);
      } catch { /* arquivo mudou durante a varredura */ }
    }
  };
  walk(root);
  return files;
}

function extractedReferences(content: string, extension: string): Array<{ ref: string; relation: string }> {
  const refs: Array<{ ref: string; relation: string }> = [];
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(extension)) {
    const patterns = [
      /(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g,
      /import\s+['"]([^'"]+)['"]/g,
    ];
    for (const pattern of patterns) {
      for (const match of content.matchAll(pattern)) if (match[1]) refs.push({ ref: match[1], relation: 'imports' });
    }
  }
  if (extension === '.md') {
    for (const match of content.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
      if (match[1]) refs.push({ ref: match[1], relation: 'references' });
    }
    for (const match of content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
      if (match[1]) refs.push({ ref: match[1], relation: 'references' });
    }
  }
  return refs;
}

function resolveFileReference(source: string, reference: string, known: Map<string, string>): string | null {
  if (!reference.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(source), reference));
  const candidates = [base, ...IMPORT_EXTENSIONS.map(ext => base + ext), ...IMPORT_EXTENSIONS.map(ext => path.posix.join(base, 'index' + ext))];
  for (const candidate of candidates) {
    const found = known.get(candidate.toLowerCase());
    if (found) return found;
  }
  return null;
}

export function rebuildTechnicalGraph(projectId: string): { files: number; edges: number; truncated: boolean } {
  const project = getProject(projectId);
  if (!project) throw new Error('Projeto nao encontrado.');
  const root = resolveProjectRoot(project);
  const files = scanCodeFiles(root);
  const db = getDb();
  const known = new Map<string, string>();

  db.transaction(() => {
    db.prepare("DELETE FROM knowledge_edges WHERE project_id = ? AND layer = 'code'").run(projectId);
    db.prepare("DELETE FROM knowledge_nodes WHERE project_id = ? AND layer = 'code'").run(projectId);

    for (const absolute of files) {
      const relative = path.relative(root, absolute).replace(/\\/g, '/');
      const id = stableId('code', `${projectId}:${relative.toLowerCase()}`);
      known.set(relative.toLowerCase(), id);
      const content = fs.readFileSync(absolute, 'utf-8');
      insertNode({
        id, projectId, layer: 'code', kind: path.extname(relative).slice(1) || 'file',
        label: path.posix.basename(relative), sourceRef: relative, status: 'active',
        confidence: 1, contentHash: stableHash(content),
        metadata: { path: relative, bytes: Buffer.byteLength(content) },
      });
    }

    for (const absolute of files) {
      const relative = path.relative(root, absolute).replace(/\\/g, '/');
      const sourceId = known.get(relative.toLowerCase())!;
      const content = fs.readFileSync(absolute, 'utf-8');
      const hash = stableHash(content);
      for (const extracted of extractedReferences(content, path.extname(relative).toLowerCase())) {
        const targetId = resolveFileReference(relative, extracted.ref, known);
        if (!targetId) continue;
        insertEdge({
          projectId, layer: 'code', sourceId, targetId, relation: extracted.relation,
          origin: 'extracted', confidence: 1, evidence: extracted.ref, sourceHash: hash,
        });
      }
    }
  })();

  const edgeCount = (db.prepare(
    "SELECT COUNT(*) AS count FROM knowledge_edges WHERE project_id = ? AND layer = 'code'",
  ).get(projectId) as { count: number }).count;
  return { files: files.length, edges: edgeCount, truncated: files.length >= MAX_GRAPH_FILES };
}

export function rebuildProjectKnowledge(projectId: string): {
  memory: ReturnType<typeof synchronizeProjectVault>;
  code: ReturnType<typeof rebuildTechnicalGraph>;
} {
  const code = rebuildTechnicalGraph(projectId);
  const memory = synchronizeProjectVault(projectId);
  return { memory, code };
}

export function getProjectKnowledgeGraph(
  projectId: string,
  layer: 'memory' | 'code' | 'all' = 'all',
  limit = 800,
): { nodes: unknown[]; edges: unknown[]; truncated: boolean } {
  synchronizeProjectVault(projectId);
  const safeLimit = Math.min(Math.max(limit, 10), 2000);
  const layerSql = layer === 'all' ? '' : ' AND layer = ?';
  const params = layer === 'all' ? [projectId, safeLimit + 1] : [projectId, layer, safeLimit + 1];
  const nodes = getDb().prepare(
    `SELECT * FROM knowledge_nodes WHERE project_id = ?${layerSql} ORDER BY updated_at DESC LIMIT ?`,
  ).all(...params) as Array<Record<string, unknown>>;
  const ids = new Set(nodes.slice(0, safeLimit).map(node => String(node.id)));
  const edgeRows = getDb().prepare(
    `SELECT * FROM knowledge_edges WHERE project_id = ?${layerSql} ORDER BY updated_at DESC LIMIT ?`,
  ).all(...params) as Array<Record<string, unknown>>;
  const edges = edgeRows.filter(edge => ids.has(String(edge.source_id)) && ids.has(String(edge.target_id)));
  return {
    nodes: nodes.slice(0, safeLimit).map(node => ({ ...node, metadata: JSON.parse(String(node.metadata_json || '{}')), metadata_json: undefined })),
    edges: edges.map(edge => ({ ...edge, metadata: JSON.parse(String(edge.metadata_json || '{}')), metadata_json: undefined })),
    truncated: nodes.length > safeLimit,
  };
}

export function recordMemoryFeedback(input: {
  projectId: string;
  memoryId?: string | null;
  agentId?: string | null;
  question: string;
  answer?: string;
  outcome: 'useful' | 'dead_end' | 'corrected';
  notes?: string;
}): string {
  if (!getProject(input.projectId)) throw new Error('Projeto nao encontrado.');
  const question = input.question.trim();
  if (!question) throw new Error('Pergunta ou tarefa e obrigatoria.');
  let sourceHash: string | null = null;
  if (input.memoryId) {
    const row = getDb().prepare('SELECT content_hash FROM vault_documents WHERE id = ? AND project_id = ?')
      .get(input.memoryId, input.projectId) as { content_hash: string } | undefined;
    if (!row) throw new Error('Memoria nao encontrada neste projeto.');
    sourceHash = row.content_hash;
  }
  const id = randomUUID();
  getDb().prepare(
    `INSERT INTO memory_feedback
       (id, project_id, memory_id, agent_id, question, answer, outcome, notes, source_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, input.projectId, input.memoryId ?? null, input.agentId ?? null, question,
    input.answer?.trim() || null, input.outcome, input.notes?.trim() || null, sourceHash,
  );
  if (input.memoryId && input.outcome === 'corrected') {
    getDb().prepare("UPDATE vault_documents SET status = 'contested', updated_at = datetime('now') WHERE id = ?")
      .run(input.memoryId);
    getDb().prepare("UPDATE knowledge_nodes SET status = 'contested', updated_at = datetime('now') WHERE id = ?")
      .run(input.memoryId);
  }
  return id;
}

export function reflectProjectMemory(projectId: string): {
  sourceRef: string;
  generatedAt: string;
  outcomes: Record<string, number>;
  content: string;
} {
  const project = getProject(projectId);
  if (!project) throw new Error('Projeto nao encontrado.');
  synchronizeProjectVault(projectId);
  const rows = getDb().prepare(
    `SELECT f.*, d.title AS memory_title,
            CASE WHEN f.source_hash IS NOT NULL AND d.content_hash <> f.source_hash THEN 1 ELSE 0 END AS source_changed
     FROM memory_feedback f
     LEFT JOIN vault_documents d ON d.id = f.memory_id
     WHERE f.project_id = ? ORDER BY f.created_at DESC LIMIT 200`,
  ).all(projectId) as Array<Record<string, unknown>>;
  const outcomes = { useful: 0, dead_end: 0, corrected: 0 };
  for (const row of rows) {
    const outcome = String(row.outcome) as keyof typeof outcomes;
    if (outcome in outcomes) outcomes[outcome]++;
  }
  const generatedAt = new Date().toISOString();
  const lines = [
    '---',
    'title: "Licoes derivadas do trabalho"',
    'type: reflection',
    'status: tentative',
    `project: ${JSON.stringify(project.name)}`,
    `generated_at: ${generatedAt}`,
    '---',
    '',
    '# Licoes derivadas do trabalho',
    '',
    '> Documento derivado. Nao possui autoridade de instrucao e exige revisao humana antes de promover fatos para a memoria canonica.',
    '',
    `- Resultados uteis: ${outcomes.useful}`,
    `- Becos sem saida: ${outcomes.dead_end}`,
    `- Correcoes: ${outcomes.corrected}`,
    '',
    '## Evidencias recentes',
    '',
    ...rows.map(row => {
      const changed = Number(row.source_changed) ? ' [fonte alterada; verificar novamente]' : '';
      const target = row.memory_title ? ` em [[${row.memory_title}]]` : '';
      const note = row.notes || row.answer || 'Sem observacao adicional.';
      return `- **${row.outcome}**${target}: ${String(note).replace(/\s+/g, ' ').slice(0, 500)}${changed}`;
    }),
    '',
  ];
  const content = lines.join('\n');
  const dir = projectId === LEGACY_PROJECT_ID
    ? path.resolve(process.cwd(), 'data', 'vault', 'legacy', 'reflections')
    : path.join(path.dirname(resolveProjectRoot(project)), '.aria', 'reflections');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'LESSONS.md'), content, 'utf-8');
  return { sourceRef: 'reflections/LESSONS.md', generatedAt, outcomes, content };
}

export function getVaultOverview(projectId: string): {
  total: number;
  nodes: number;
  edges: number;
  feedback: Record<string, number>;
  views: Array<{ id: string; label: string; description: string; count: number }>;
} {
  synchronizeProjectVault(projectId);
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) AS count FROM vault_documents WHERE project_id = ?')
    .get(projectId) as { count: number }).count;
  const graph = db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM knowledge_nodes WHERE project_id = ?) AS nodes,
       (SELECT COUNT(*) FROM knowledge_edges WHERE project_id = ?) AS edges`,
  ).get(projectId, projectId) as { nodes: number; edges: number };
  const feedbackRows = db.prepare(
    'SELECT outcome, COUNT(*) AS count FROM memory_feedback WHERE project_id = ? GROUP BY outcome',
  ).all(projectId) as Array<{ outcome: string; count: number }>;
  const feedback: Record<string, number> = { useful: 0, dead_end: 0, corrected: 0 };
  for (const row of feedbackRows) feedback[row.outcome] = row.count;
  const scalar = (sql: string): number => (db.prepare(sql).get(projectId) as { count: number }).count;
  return {
    total,
    nodes: graph.nodes,
    edges: graph.edges,
    feedback,
    views: [
      { id: 'needs-review', label: 'Precisa de revisao', description: 'Conteudo alterado, contestado ou obsoleto.', count: scalar("SELECT COUNT(*) AS count FROM vault_documents WHERE project_id = ? AND status IN ('needs_review','contested','stale')") },
      { id: 'tentative', label: 'Conhecimento tentativo', description: 'Ainda nao confirmado por uma pessoa.', count: scalar("SELECT COUNT(*) AS count FROM vault_documents WHERE project_id = ? AND status = 'tentative'") },
      { id: 'unlinked', label: 'Sem conexoes', description: 'Notas que ainda nao referenciam outro conhecimento.', count: scalar("SELECT COUNT(*) AS count FROM vault_documents d WHERE d.project_id = ? AND NOT EXISTS (SELECT 1 FROM knowledge_edges e WHERE e.source_id = d.id)") },
      { id: 'agent-lessons', label: 'Licoes dos agentes', description: 'Resultados avaliados como uteis, falhos ou corrigidos.', count: feedbackRows.reduce((sum, row) => sum + row.count, 0) },
    ],
  };
}
