import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/connection.js';
import { getProject, getProjectSettings, resolveProjectRoot, LEGACY_PROJECT_ID, type Project } from './service.js';

const MAX_MEMORY_BYTES = 1024 * 1024;
const SAFE_ID = /^[a-z0-9_-]{1,80}$/i;
const SAFE_NOTE = /^[a-z0-9_-]{1,120}$/i;

export interface ProjectMemoryRecord {
  id: string;
  agentId: string;
  kind: 'main' | 'daily' | 'deep';
  name: string;
  description: string;
  size: number;
  modifiedAt: string;
  preview: string;
}

export class ProjectDataError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function projectAgentsDir(project: Project): string {
  return project.id === LEGACY_PROJECT_ID
    ? path.resolve(process.cwd(), 'agents')
    : path.join(path.dirname(resolveProjectRoot(project)), '.aria', 'agents');
}

function memoryId(agentId: string, kind: ProjectMemoryRecord['kind'], name: string): string {
  return `${agentId}/${kind}/${name}`;
}

function parseDescription(content: string, fallback: string): string {
  const match = content.match(/^---\s*[\r\n]+[\s\S]*?^description:\s*(.+)$/m);
  return match?.[1]?.trim().slice(0, 180) || fallback;
}

function recordFor(filePath: string, base: string, agentId: string, kind: ProjectMemoryRecord['kind'], name: string): ProjectMemoryRecord | null {
  try {
    const linkStat = fs.lstatSync(filePath);
    if (linkStat.isSymbolicLink() || !linkStat.isFile() || linkStat.size > MAX_MEMORY_BYTES) return null;
    const physical = fs.realpathSync.native(filePath);
    if (!isInside(fs.realpathSync.native(base), physical)) return null;
    const content = fs.readFileSync(physical, 'utf-8');
    const body = content.replace(/^---[\s\S]*?---\s*/, '').trim();
    return {
      id: memoryId(agentId, kind, name),
      agentId,
      kind,
      name,
      description: parseDescription(content, kind === 'main' ? 'Memória principal' : kind === 'daily' ? 'Nota diária' : 'Memória profunda'),
      size: linkStat.size,
      modifiedAt: linkStat.mtime.toISOString(),
      preview: body.replace(/\s+/g, ' ').slice(0, 220),
    };
  } catch { return null; }
}

function resolveMemory(projectId: string, id: string): { project: Project; base: string; filePath: string; record: ProjectMemoryRecord } {
  const project = getProject(projectId);
  if (!project) throw new ProjectDataError(404, 'Projeto nao encontrado.');
  const [agentId, rawKind, name, ...rest] = id.split('/');
  if (rest.length || !SAFE_ID.test(agentId) || !SAFE_NOTE.test(name)) throw new ProjectDataError(400, 'Identificador de memoria invalido.');
  if (rawKind !== 'main' && rawKind !== 'daily' && rawKind !== 'deep') throw new ProjectDataError(400, 'Tipo de memoria invalido.');
  const kind = rawKind as ProjectMemoryRecord['kind'];
  if (kind === 'main' && name !== 'memory') throw new ProjectDataError(400, 'Memoria principal invalida.');
  const base = projectAgentsDir(project);
  const agentDir = path.join(base, agentId);
  const filePath = kind === 'main'
    ? path.join(agentDir, 'memory.md')
    : kind === 'daily'
      ? path.join(agentDir, project.id === LEGACY_PROJECT_ID ? 'memory' : 'daily', `${name}.md`)
      : path.join(agentDir, 'memories', `${name}.md`);
  const lexical = path.resolve(filePath);
  if (!isInside(path.resolve(base), lexical)) throw new ProjectDataError(403, 'Caminho de memoria fora do projeto.');
  const record = recordFor(lexical, base, agentId, kind, name);
  if (!record) throw new ProjectDataError(404, 'Memoria nao encontrada ou protegida.');
  return { project, base, filePath: lexical, record };
}

export function listProjectMemories(projectId: string): ProjectMemoryRecord[] {
  const project = getProject(projectId);
  if (!project) throw new ProjectDataError(404, 'Projeto nao encontrado.');
  const base = projectAgentsDir(project);
  if (!fs.existsSync(base)) return [];
  const records: ProjectMemoryRecord[] = [];
  for (const agent of fs.readdirSync(base, { withFileTypes: true })) {
    if (!agent.isDirectory() || !SAFE_ID.test(agent.name)) continue;
    const agentDir = path.join(base, agent.name);
    const main = recordFor(path.join(agentDir, 'memory.md'), base, agent.name, 'main', 'memory');
    if (main) records.push(main);
    const dailyDir = path.join(agentDir, project.id === LEGACY_PROJECT_ID ? 'memory' : 'daily');
    if (fs.existsSync(dailyDir)) {
      for (const file of fs.readdirSync(dailyDir, { withFileTypes: true })) {
        if (!file.isFile() || !file.name.endsWith('.md')) continue;
        const name = file.name.slice(0, -3);
        if (!SAFE_NOTE.test(name)) continue;
        const record = recordFor(path.join(dailyDir, file.name), base, agent.name, 'daily', name);
        if (record) records.push(record);
      }
    }
    const deepDir = path.join(agentDir, 'memories');
    if (fs.existsSync(deepDir)) {
      for (const file of fs.readdirSync(deepDir, { withFileTypes: true })) {
        if (!file.isFile() || !file.name.endsWith('.md')) continue;
        const name = file.name.slice(0, -3);
        if (!SAFE_NOTE.test(name)) continue;
        const record = recordFor(path.join(deepDir, file.name), base, agent.name, 'deep', name);
        if (record) records.push(record);
      }
    }
  }
  return records.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export function readProjectMemory(projectId: string, id: string): ProjectMemoryRecord & { content: string } {
  const target = resolveMemory(projectId, id);
  return { ...target.record, content: fs.readFileSync(target.filePath, 'utf-8') };
}

export function auditEvent(projectId: string | null, action: string, targetType: string, targetId: string | null, metadata?: unknown): void {
  getDb().prepare(
    `INSERT INTO audit_events (id, project_id, actor, action, target_type, target_id, metadata_json)
     VALUES (?, ?, 'web-user', ?, ?, ?, ?)`,
  ).run(randomUUID(), projectId, action, targetType, targetId, metadata === undefined ? null : JSON.stringify(metadata));
}

export function deleteProjectMemory(projectId: string, id: string, confirmId: string): ProjectMemoryRecord {
  if (confirmId !== id) throw new ProjectDataError(400, 'Confirmacao invalida para apagar a memoria.');
  const target = resolveMemory(projectId, id);
  fs.unlinkSync(target.filePath);
  auditEvent(projectId, 'memory.delete', 'memory', id, { kind: target.record.kind, agentId: target.record.agentId, size: target.record.size });
  return target.record;
}

export function clearProjectMemories(projectId: string, confirmName: string): number {
  const project = getProject(projectId);
  if (!project) throw new ProjectDataError(404, 'Projeto nao encontrado.');
  if (confirmName !== project.name) throw new ProjectDataError(400, 'Digite o nome exato do projeto para confirmar.');
  const memories = listProjectMemories(projectId);
  let removed = 0;
  for (const memory of memories) {
    try { fs.unlinkSync(resolveMemory(projectId, memory.id).filePath); removed++; } catch { /* continua sem sair do escopo */ }
  }
  auditEvent(projectId, 'memory.clear', 'project', projectId, { removed });
  return removed;
}

export function deleteProjectConversation(projectId: string, conversationId: string, confirmId: string): boolean {
  if (confirmId !== conversationId) throw new ProjectDataError(400, 'Confirmacao invalida para apagar a conversa.');
  const db = getDb();
  const conversation = db.prepare(
    `SELECT id, title FROM conversations WHERE id = ? AND COALESCE(project_id, 'legacy') = ?`,
  ).get(conversationId, projectId) as { id: string; title: string | null } | undefined;
  if (!conversation) throw new ProjectDataError(404, 'Conversa nao encontrada neste projeto.');
  const active = db.prepare(`SELECT 1 FROM runs WHERE conversation_id = ? AND status IN ('queued', 'running', 'waiting_confirmation') LIMIT 1`).get(conversationId);
  if (active) throw new ProjectDataError(409, 'Cancele a execucao ativa antes de apagar a conversa.');
  db.transaction(() => {
    db.prepare('DELETE FROM run_events WHERE run_id IN (SELECT id FROM runs WHERE conversation_id = ?)').run(conversationId);
    db.prepare('DELETE FROM runs WHERE conversation_id = ?').run(conversationId);
    db.prepare('DELETE FROM group_participants WHERE conversation_id = ?').run(conversationId);
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
    auditEvent(projectId, 'conversation.delete', 'conversation', conversationId, { title: conversation.title });
  })();
  return true;
}

export function exportProjectData(projectId: string): Record<string, unknown> {
  const project = getProject(projectId);
  if (!project) throw new ProjectDataError(404, 'Projeto nao encontrado.');
  const db = getDb();
  const conversations = db.prepare(`SELECT * FROM conversations WHERE COALESCE(project_id, 'legacy') = ? ORDER BY created_at`).all(projectId) as Array<Record<string, unknown>>;
  const conversationIds = conversations.map(row => String(row.id));
  const messages: unknown[] = [];
  const runs: unknown[] = [];
  const runEvents: unknown[] = [];
  for (const conversationId of conversationIds) {
    messages.push(...db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, sequence').all(conversationId));
    const conversationRuns = db.prepare('SELECT * FROM runs WHERE conversation_id = ? ORDER BY created_at').all(conversationId) as Array<Record<string, unknown>>;
    runs.push(...conversationRuns);
    for (const run of conversationRuns) runEvents.push(...db.prepare('SELECT * FROM run_events WHERE run_id = ? ORDER BY sequence').all(String(run.id)));
  }
  const memories = listProjectMemories(projectId).map(memory => ({ ...memory, content: readProjectMemory(projectId, memory.id).content }));
  auditEvent(projectId, 'project.export', 'project', projectId, { conversations: conversations.length, memories: memories.length });
  return {
    format: 'personal-ai-agents-project-export', version: 1, exportedAt: new Date().toISOString(),
    project, settings: getProjectSettings(projectId), memories, conversations, messages, runs, runEvents,
    tasks: db.prepare(`SELECT * FROM tasks WHERE COALESCE(project_id, 'legacy') = ? ORDER BY created_at`).all(projectId),
    usage: db.prepare(`SELECT * FROM usage_events WHERE COALESCE(project_id, 'legacy') = ? ORDER BY created_at`).all(projectId),
    schedules: db.prepare(`SELECT * FROM schedules WHERE COALESCE(project_id, 'legacy') = ? ORDER BY created_at`).all(projectId),
  };
}

export function listAuditEvents(projectId?: string, limit = 100): unknown[] {
  return projectId
    ? getDb().prepare('SELECT * FROM audit_events WHERE project_id = ? ORDER BY created_at DESC LIMIT ?').all(projectId, Math.min(limit, 500))
    : getDb().prepare('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?').all(Math.min(limit, 500));
}
