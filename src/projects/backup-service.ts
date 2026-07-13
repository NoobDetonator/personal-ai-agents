import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { getProject, resolveProjectRoot, LEGACY_PROJECT_ID } from './service.js';
import { exportProjectData, auditEvent } from './data-service.js';

const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
const MAX_BACKUP_FILES = 5_000;
const SKIP_DIRECTORIES = new Set(['.git', '.aria', 'node_modules']);
const SECRET_EXTENSIONS = new Set(['.key', '.pem', '.p12', '.pfx', '.db', '.db-wal', '.db-shm']);

export class ProjectBackupError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export interface ProjectBackupMeta {
  id: string;
  createdAt: string;
  size: number;
  files: number;
}

function backupDirectory(projectId: string): string {
  const project = getProject(projectId);
  if (!project) throw new ProjectBackupError(404, 'Projeto nao encontrado.');
  if (project.id === LEGACY_PROJECT_ID) throw new ProjectBackupError(403, 'Backups do projeto Legacy devem ser feitos no nivel da instalacao.');
  return path.join(path.dirname(resolveProjectRoot(project)), '.aria', 'backups');
}

function backupPath(projectId: string, id: string): string {
  if (!/^[a-z0-9-]{12,80}\.json$/i.test(id)) throw new ProjectBackupError(400, 'Identificador de backup invalido.');
  return path.join(backupDirectory(projectId), id);
}

function shouldSkip(name: string, directory: boolean): boolean {
  const lower = name.toLowerCase();
  if (directory) return SKIP_DIRECTORIES.has(lower);
  return lower === '.env' || lower.startsWith('.env.') || SECRET_EXTENSIONS.has(path.extname(lower));
}

function collectFiles(root: string): Array<{ path: string; contentBase64: string; modifiedAt: string }> {
  const files: Array<{ path: string; contentBase64: string; modifiedAt: string }> = [];
  const pending = [root];
  let total = 0;
  while (pending.length) {
    const directory = pending.pop()!;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (shouldSkip(entry.name, entry.isDirectory())) continue;
      const absolute = path.join(directory, entry.name);
      const linkStat = fs.lstatSync(absolute);
      if (linkStat.isSymbolicLink()) continue;
      if (entry.isDirectory()) { pending.push(absolute); continue; }
      if (!entry.isFile()) continue;
      if (files.length >= MAX_BACKUP_FILES) throw new ProjectBackupError(413, 'Projeto excede o limite de 5.000 arquivos por backup.');
      total += linkStat.size;
      if (total > MAX_BACKUP_BYTES) throw new ProjectBackupError(413, 'Projeto excede o limite de 25 MB por backup.');
      files.push({
        path: path.relative(root, absolute).split(path.sep).join('/'),
        contentBase64: fs.readFileSync(absolute).toString('base64'),
        modifiedAt: linkStat.mtime.toISOString(),
      });
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

export function createProjectBackup(projectId: string): ProjectBackupMeta {
  const project = getProject(projectId);
  if (!project) throw new ProjectBackupError(404, 'Projeto nao encontrado.');
  const directory = backupDirectory(projectId);
  fs.mkdirSync(directory, { recursive: true });
  const createdAt = new Date().toISOString();
  const id = `${createdAt.replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}.json`;
  const files = collectFiles(resolveProjectRoot(project));
  const payload = Buffer.from(JSON.stringify({
    format: 'personal-ai-agents-project-backup',
    version: 1,
    createdAt,
    project: exportProjectData(projectId),
    files,
  }, null, 2));
  if (payload.length > MAX_BACKUP_BYTES * 1.5) throw new ProjectBackupError(413, 'Backup serializado excede o limite seguro.');
  const target = path.join(directory, id);
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, payload, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temp, target);
  auditEvent(projectId, 'backup.create', 'backup', id, { files: files.length, bytes: payload.length });
  return { id, createdAt, size: payload.length, files: files.length };
}

export function listProjectBackups(projectId: string): ProjectBackupMeta[] {
  const directory = backupDirectory(projectId);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^[a-z0-9-]+\.json$/i.test(entry.name))
    .map(entry => {
      const absolute = path.join(directory, entry.name);
      const stat = fs.statSync(absolute);
      let files = 0;
      try { files = JSON.parse(fs.readFileSync(absolute, 'utf-8')).files?.length ?? 0; } catch { /* reporta zero */ }
      return { id: entry.name, createdAt: stat.mtime.toISOString(), size: stat.size, files };
    })
    .sort((a, b) => b.id.localeCompare(a.id));
}

export function readProjectBackup(projectId: string, id: string): { body: Buffer; filename: string } {
  const target = backupPath(projectId, id);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new ProjectBackupError(404, 'Backup nao encontrado.');
  auditEvent(projectId, 'backup.download', 'backup', id);
  return { body: fs.readFileSync(target), filename: id };
}

export function deleteProjectBackup(projectId: string, id: string, confirmId: string): void {
  if (id !== confirmId) throw new ProjectBackupError(400, 'Confirmacao invalida: informe o identificador exato.');
  const target = backupPath(projectId, id);
  if (!fs.existsSync(target)) throw new ProjectBackupError(404, 'Backup nao encontrado.');
  fs.unlinkSync(target);
  auditEvent(projectId, 'backup.delete', 'backup', id);
}
