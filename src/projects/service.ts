import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/connection.js';
import { LEGACY_PROJECT_ID, LEGACY_PROJECT_ROOT } from '../db/schema.js';
import type { ProjectExecutionContext } from './context.js';

export { LEGACY_PROJECT_ID } from '../db/schema.js';

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  root_path: string;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
}

export interface ProjectSettings {
  project_id: string;
  default_model: string | null;
  default_provider: string | null;
  shell_mode: string | null;
  delegation_timeout_sec: number | null;
  max_concurrency: number | null;
  memory_enabled: number;
}

export interface CreateProjectInput {
  name: string;
  description?: string | null;
  defaultModel?: string | null;
  defaultProvider?: string | null;
}

const PROJECTS_SUBDIR = 'workspace/projects';

/** Raiz do processo (cwd), como no restante do backend. */
function rootDir(): string {
  return process.cwd();
}

/** Slug sanitizado apenas para exibição — NUNCA usado para derivar caminho. */
export function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'projeto';
}

function uniqueSlug(base: string): string {
  const db = getDb();
  let candidate = base;
  let n = 1;
  while (db.prepare('SELECT 1 FROM projects WHERE slug = ?').get(candidate)) {
    candidate = `${base}-${++n}`;
  }
  return candidate;
}

/**
 * Caminho absoluto da raiz de confinamento (diretório de arquivos) de um
 * projeto, resolvido a partir do root_path armazenado. Nunca deriva do nome.
 */
export function resolveProjectRoot(project: Pick<Project, 'root_path'>): string {
  return path.resolve(rootDir(), project.root_path);
}

/** Diretório interno .aria/ de um projeto (fora do alcance das file tools). */
function projectMetaDir(project: Project): string | null {
  if (project.id === LEGACY_PROJECT_ID) return null;
  // root_path = workspace/projects/<id>/files → .aria fica no diretório pai.
  return path.resolve(rootDir(), path.dirname(project.root_path), '.aria');
}

function rowToProject(row: Record<string, unknown>): Project {
  return row as unknown as Project;
}

export function listProjects(status?: 'active' | 'archived'): Project[] {
  const db = getDb();
  const rows = status
    ? db.prepare('SELECT * FROM projects WHERE status = ? ORDER BY last_opened_at DESC, updated_at DESC').all(status)
    : db.prepare('SELECT * FROM projects ORDER BY last_opened_at DESC, updated_at DESC').all();
  return (rows as Array<Record<string, unknown>>).map(rowToProject);
}

export function getProject(id: string): Project | null {
  const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToProject(row) : null;
}

export function getProjectSettings(id: string): ProjectSettings | null {
  const row = getDb().prepare('SELECT * FROM project_settings WHERE project_id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? (row as unknown as ProjectSettings) : null;
}

/** Garante que os diretórios físicos de um projeto existam. */
export function ensureProjectDirectories(project: Project): void {
  fs.mkdirSync(resolveProjectRoot(project), { recursive: true });
  const meta = projectMetaDir(project);
  if (meta) {
    fs.mkdirSync(path.join(meta, 'memories'), { recursive: true });
    fs.mkdirSync(path.join(meta, 'previews'), { recursive: true });
  }
}

/**
 * Cria um projeto: gera id/slug/root_path, cria diretórios, grava project.json,
 * insere registros. Em falha, faz rollback (remove diretório e linhas criadas).
 */
export function createProject(input: CreateProjectInput): Project {
  const name = input.name.trim();
  if (!name) throw new Error('Nome do projeto é obrigatório.');

  const db = getDb();
  const id = randomUUID();
  const slug = uniqueSlug(slugify(name));
  const rootPath = `${PROJECTS_SUBDIR}/${id}/files`;
  const projectDir = path.resolve(rootDir(), PROJECTS_SUBDIR, id);

  let dirCreated = false;
  const insert = db.transaction(() => {
    db.prepare(
      `INSERT INTO projects (id, name, slug, description, root_path, status)
       VALUES (?, ?, ?, ?, ?, 'active')`,
    ).run(id, name, slug, input.description ?? null, rootPath);
    db.prepare(
      `INSERT INTO project_settings (project_id, default_model, default_provider)
       VALUES (?, ?, ?)`,
    ).run(id, input.defaultModel ?? null, input.defaultProvider ?? null);
  });

  try {
    insert();
    const project = getProject(id)!;
    ensureProjectDirectories(project);
    dirCreated = true;
    fs.writeFileSync(
      path.join(projectDir, 'project.json'),
      JSON.stringify({ id, name, slug, description: input.description ?? null, root_path: rootPath }, null, 2),
      'utf-8',
    );
    return project;
  } catch (error) {
    // Rollback: remove diretório e registros criados.
    try {
      db.prepare('DELETE FROM projects WHERE id = ?').run(id); // cascade em project_settings
    } catch { /* best-effort */ }
    if (dirCreated) {
      try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
    throw new Error(`Falha ao criar projeto "${name}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function updateProject(id: string, patch: { name?: string; description?: string | null }): Project | null {
  const db = getDb();
  const existing = getProject(id);
  if (!existing) return null;
  const name = patch.name?.trim() || existing.name;
  const description = patch.description !== undefined ? patch.description : existing.description;
  db.prepare(`UPDATE projects SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(name, description, id);
  return getProject(id);
}

export function archiveProject(id: string): boolean {
  const info = getDb().prepare(
    `UPDATE projects SET status = 'archived', updated_at = datetime('now') WHERE id = ?`,
  ).run(id);
  return info.changes > 0;
}

/**
 * Deleta um projeto. Exige que confirmName == project.name. O projeto Legacy
 * nunca pode ser deletado. Remove diretório do projeto (exceto Legacy, cujo
 * root é o workspace inteiro).
 */
export function deleteProject(id: string, confirmName: string): { ok: boolean; error?: string } {
  if (id === LEGACY_PROJECT_ID) {
    return { ok: false, error: 'O projeto Legacy não pode ser deletado.' };
  }
  const project = getProject(id);
  if (!project) return { ok: false, error: 'Projeto não encontrado.' };
  if (confirmName !== project.name) {
    return { ok: false, error: 'Confirmação inválida: digite o nome exato do projeto.' };
  }
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
  const projectDir = path.resolve(rootDir(), path.dirname(project.root_path));
  try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  return { ok: true };
}

export function touchLastOpened(id: string): void {
  getDb().prepare(`UPDATE projects SET last_opened_at = datetime('now') WHERE id = ?`).run(id);
}

/**
 * Monta um ProjectExecutionContext resolvendo o projectRoot a partir do id.
 * Lança se o projeto não existir.
 */
export function buildProjectContext(
  projectId: string,
  extra?: { conversationId?: string; runId?: string },
): ProjectExecutionContext {
  const project = getProject(projectId);
  if (!project) throw new Error(`Projeto não encontrado: ${projectId}`);
  ensureProjectDirectories(project);
  return {
    projectId: project.id,
    projectRoot: resolveProjectRoot(project),
    conversationId: extra?.conversationId,
    runId: extra?.runId,
  };
}

/**
 * Garante o projeto Legacy e seu diretório. A criação da linha é feita na
 * migração; aqui garantimos o diretório físico de confinamento.
 */
export function ensureLegacyProject(): Project {
  const legacy = getProject(LEGACY_PROJECT_ID);
  if (!legacy) {
    throw new Error('Projeto Legacy ausente — a migração deveria tê-lo criado.');
  }
  fs.mkdirSync(path.resolve(rootDir(), LEGACY_PROJECT_ROOT), { recursive: true });
  return legacy;
}
