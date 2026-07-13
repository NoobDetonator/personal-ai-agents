import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getProject, resolveProjectRoot, LEGACY_PROJECT_ID } from './service.js';

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_RAW_BYTES = 12 * 1024 * 1024;
const MAX_DIRECTORY_ITEMS = 2_000;
const MAX_SEARCH_FILES = 5_000;
const MAX_SEARCH_RESULTS = 200;
const MAX_SEARCH_FILE_BYTES = 512 * 1024;
const BLOCKED_SEGMENTS = new Set(['.git', '.aria', 'node_modules']);
const BLOCKED_EXTENSIONS = new Set(['.db', '.db-journal', '.db-wal', '.db-shm', '.key', '.pem', '.p12', '.pfx']);
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
};
const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.css', '.scss', '.less', '.html', '.htm', '.svg',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.kts', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.sh',
  '.ps1', '.bat', '.cmd', '.sql', '.graphql', '.gql', '.xml', '.yaml', '.yml', '.toml', '.ini', '.conf',
  '.vue', '.svelte', '.astro', '.dockerfile', '.gitignore', '.editorconfig',
]);

export type ProjectFileViewer = 'directory' | 'markdown' | 'json' | 'csv' | 'html' | 'image' | 'pdf' | 'code' | 'text' | 'unsupported';
export interface ProjectFileEntry {
  name: string; path: string; kind: 'file' | 'directory'; size: number | null; modifiedAt: string; viewer: ProjectFileViewer;
}
export interface ProjectFileDocument extends ProjectFileEntry {
  mime: string; etag: string; content?: string; rawUrl?: string;
}
export interface ProjectFileSearchResult { path: string; name: string; line: number; preview: string; }

export class ProjectFileError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
function isSensitiveName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === '.env' || lower.startsWith('.env.') || BLOCKED_EXTENSIONS.has(path.extname(lower));
}
function normalizeRelativePath(input: string): string {
  if (input.includes('\0')) throw new ProjectFileError(400, 'Caminho invalido.');
  const raw = input.replace(/\\/g, '/').trim();
  if (!raw || raw === '.') return '';
  if (raw.startsWith('/') || /^[a-z]:/i.test(raw) || raw.startsWith('//')) {
    throw new ProjectFileError(400, 'Use um caminho relativo ao projeto.');
  }
  const segments = raw.split('/').filter(Boolean);
  if (segments.some(segment => segment === '..')) throw new ProjectFileError(403, 'Traversal de caminho recusado.');
  return segments.filter(segment => segment !== '.').join('/');
}
function assertVisibleSegments(projectId: string, relativePath: string): void {
  const segments = relativePath.split('/').filter(Boolean);
  if (segments.some(segment => BLOCKED_SEGMENTS.has(segment.toLowerCase()) || isSensitiveName(segment))) {
    throw new ProjectFileError(403, 'Caminho protegido pelo isolamento do projeto.');
  }
  if (projectId === LEGACY_PROJECT_ID && segments[0]?.toLowerCase() === 'projects') {
    throw new ProjectFileError(403, 'A pasta interna de projetos nao pertence ao projeto Legacy.');
  }
}
function resolveExisting(projectId: string, input: string): { root: string; absolute: string; relative: string; stat: fs.Stats } {
  const project = getProject(projectId);
  if (!project) throw new ProjectFileError(404, 'Projeto nao encontrado.');
  const relative = normalizeRelativePath(input);
  assertVisibleSegments(projectId, relative);
  const root = resolveProjectRoot(project);
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  const realRoot = fs.realpathSync.native(root);
  const absolute = path.resolve(root, ...relative.split('/').filter(Boolean));
  if (!isInside(root, absolute)) throw new ProjectFileError(403, 'Caminho fora do projeto.');
  let cursor = root;
  for (const segment of relative.split('/').filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) throw new ProjectFileError(404, 'Arquivo ou pasta nao encontrado.');
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new ProjectFileError(403, 'Links simbolicos e junctions nao sao permitidos.');
  }
  const physical = fs.realpathSync.native(absolute);
  if (!isInside(realRoot, physical)) throw new ProjectFileError(403, 'Caminho fisico fora do projeto.');
  return { root: realRoot, absolute: physical, relative, stat: fs.statSync(physical) };
}
function viewerFor(name: string, stat?: fs.Stats, sample?: Buffer): ProjectFileViewer {
  if (stat?.isDirectory()) return 'directory';
  const lower = name.toLowerCase();
  const ext = path.extname(lower);
  if (IMAGE_MIME[ext]) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.md' || ext === '.markdown' || ext === '.mdx') return 'markdown';
  if (ext === '.json' || ext === '.jsonc') return 'json';
  if (ext === '.csv' || ext === '.tsv') return 'csv';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (CODE_EXTENSIONS.has(ext) || CODE_EXTENSIONS.has(lower) || lower === 'dockerfile') return 'code';
  if (sample?.includes(0)) return 'unsupported';
  return 'text';
}
function mimeFor(name: string, viewer: ProjectFileViewer): string {
  const ext = path.extname(name.toLowerCase());
  if (IMAGE_MIME[ext]) return IMAGE_MIME[ext];
  if (viewer === 'pdf') return 'application/pdf';
  if (viewer === 'json') return 'application/json; charset=utf-8';
  if (viewer === 'html') return 'text/html; charset=utf-8';
  if (viewer === 'markdown') return 'text/markdown; charset=utf-8';
  if (viewer === 'csv') return ext === '.tsv' ? 'text/tab-separated-values; charset=utf-8' : 'text/csv; charset=utf-8';
  return 'text/plain; charset=utf-8';
}
function etagFor(stat: fs.Stats): string {
  return `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
}
function toEntry(root: string, absolute: string, stat: fs.Stats): ProjectFileEntry {
  return {
    name: path.basename(absolute), path: path.relative(root, absolute).split(path.sep).join('/'),
    kind: stat.isDirectory() ? 'directory' : 'file', size: stat.isFile() ? stat.size : null,
    modifiedAt: stat.mtime.toISOString(), viewer: viewerFor(absolute, stat),
  };
}
function canExposeChild(projectId: string, parentRelative: string, name: string): boolean {
  try { assertVisibleSegments(projectId, [parentRelative, name].filter(Boolean).join('/')); return true; } catch { return false; }
}

export function listProjectFiles(projectId: string, directory = ''): { path: string; entries: ProjectFileEntry[] } {
  const target = resolveExisting(projectId, directory);
  if (!target.stat.isDirectory()) throw new ProjectFileError(400, 'O caminho informado nao e uma pasta.');
  const entries: ProjectFileEntry[] = [];
  for (const dirent of fs.readdirSync(target.absolute, { withFileTypes: true })) {
    if (entries.length >= MAX_DIRECTORY_ITEMS) break;
    if (!canExposeChild(projectId, target.relative, dirent.name)) continue;
    const absolute = path.join(target.absolute, dirent.name);
    try {
      const linkStat = fs.lstatSync(absolute);
      if (linkStat.isSymbolicLink()) continue;
      const physical = fs.realpathSync.native(absolute);
      if (!isInside(target.root, physical)) continue;
      const stat = fs.statSync(physical);
      if (!stat.isFile() && !stat.isDirectory()) continue;
      entries.push(toEntry(target.root, absolute, stat));
    } catch { continue; }
  }
  entries.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name, 'pt-BR') : a.kind === 'directory' ? -1 : 1);
  return { path: target.relative, entries };
}

export function readProjectFile(projectId: string, filePath: string): ProjectFileDocument {
  const target = resolveExisting(projectId, filePath);
  if (!target.stat.isFile()) throw new ProjectFileError(400, 'O caminho informado nao e um arquivo.');
  if (target.stat.size > MAX_RAW_BYTES) throw new ProjectFileError(413, 'Arquivo excede o limite de visualizacao de 12 MB.');
  const sample = fs.readFileSync(target.absolute).subarray(0, Math.min(target.stat.size, 8_192));
  const viewer = viewerFor(target.relative, target.stat, sample);
  const document: ProjectFileDocument = {
    ...toEntry(target.root, target.absolute, target.stat), viewer,
    mime: mimeFor(target.relative, viewer), etag: etagFor(target.stat),
  };
  if (viewer === 'image' || viewer === 'pdf') {
    document.rawUrl = `/api/projects/${encodeURIComponent(projectId)}/file/raw?path=${encodeURIComponent(target.relative)}`;
    return document;
  }
  if (viewer === 'unsupported') throw new ProjectFileError(415, 'Formato binario sem visualizador seguro.');
  if (target.stat.size > MAX_TEXT_BYTES) throw new ProjectFileError(413, 'Arquivo de texto excede o limite de 2 MB.');
  document.content = fs.readFileSync(target.absolute, 'utf-8');
  return document;
}

export function readProjectRawFile(projectId: string, filePath: string): { absolute: string; name: string; mime: string; etag: string; size: number } {
  const target = resolveExisting(projectId, filePath);
  if (!target.stat.isFile()) throw new ProjectFileError(400, 'O caminho informado nao e um arquivo.');
  if (target.stat.size > MAX_RAW_BYTES) throw new ProjectFileError(413, 'Arquivo excede o limite de visualizacao de 12 MB.');
  const viewer = viewerFor(target.relative, target.stat);
  if (viewer !== 'image' && viewer !== 'pdf') throw new ProjectFileError(415, 'Acesso bruto permitido apenas para imagens e PDF.');
  return { absolute: target.absolute, name: path.basename(target.relative), mime: mimeFor(target.relative, viewer), etag: etagFor(target.stat), size: target.stat.size };
}

export interface ProjectFileMutationResult { path: string; kind: 'file' | 'directory'; document?: ProjectFileDocument; }

function resolveWriteTarget(projectId: string, input: string): { root: string; absolute: string; relative: string; parent: string } {
  const project = getProject(projectId);
  if (!project) throw new ProjectFileError(404, 'Projeto nao encontrado.');
  const relative = normalizeRelativePath(input);
  if (!relative) throw new ProjectFileError(400, 'Informe um caminho de arquivo ou pasta.');
  assertVisibleSegments(projectId, relative);
  const parentRelative = path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative);
  const parentTarget = resolveExisting(projectId, parentRelative);
  if (!parentTarget.stat.isDirectory()) throw new ProjectFileError(400, 'A pasta de destino nao e valida.');
  const absolute = path.join(parentTarget.absolute, path.posix.basename(relative));
  if (!isInside(parentTarget.root, absolute)) throw new ProjectFileError(403, 'Caminho fora do projeto.');
  if (fs.existsSync(absolute) && fs.lstatSync(absolute).isSymbolicLink()) {
    throw new ProjectFileError(403, 'Links simbolicos e junctions nao sao permitidos.');
  }
  return { root: parentTarget.root, absolute, relative, parent: parentTarget.absolute };
}

function writeLockPath(absolute: string): string {
  return path.join(path.dirname(absolute), `.${path.basename(absolute)}.paa-write.lock`);
}

export function writeProjectFile(
  projectId: string,
  filePath: string,
  content: string,
  options: { expectedEtag?: string | null; create?: boolean } = {},
): ProjectFileDocument {
  const bytes = Buffer.byteLength(content, 'utf-8');
  if (bytes > MAX_TEXT_BYTES) throw new ProjectFileError(413, 'Arquivo de texto excede o limite de 2 MB.');
  const target = resolveWriteTarget(projectId, filePath);
  const lock = writeLockPath(target.absolute);
  let lockHandle: number | null = null;
  let temp: string | null = null;
  try {
    try { lockHandle = fs.openSync(lock, 'wx', 0o600); }
    catch { throw new ProjectFileError(409, 'Outro salvamento deste arquivo esta em andamento.'); }

    const exists = fs.existsSync(target.absolute);
    if (exists) {
      if (options.create) throw new ProjectFileError(409, 'O arquivo ja existe.');
      const existing = resolveExisting(projectId, target.relative);
      if (!existing.stat.isFile()) throw new ProjectFileError(400, 'O caminho informado nao e um arquivo.');
      const viewer = viewerFor(existing.relative, existing.stat, fs.readFileSync(existing.absolute).subarray(0, 8192));
      if (viewer === 'image' || viewer === 'pdf' || viewer === 'unsupported') throw new ProjectFileError(415, 'Este formato nao pode ser editado como texto.');
      if (!options.expectedEtag) throw new ProjectFileError(428, 'Informe o ETag atual para salvar.');
      if (etagFor(existing.stat) !== options.expectedEtag) throw new ProjectFileError(409, 'O arquivo mudou desde que foi aberto. Recarregue antes de salvar.');
      temp = path.join(target.parent, `.${path.basename(target.absolute)}.paa-${process.pid}-${Date.now()}.tmp`);
      fs.writeFileSync(temp, content, { encoding: 'utf-8', flag: 'wx', mode: existing.stat.mode });
      const latest = fs.statSync(target.absolute);
      if (etagFor(latest) !== options.expectedEtag) throw new ProjectFileError(409, 'O arquivo mudou durante o salvamento. Tente novamente.');
      fs.renameSync(temp, target.absolute);
      temp = null;
    } else {
      if (!options.create) throw new ProjectFileError(404, 'Arquivo nao encontrado.');
      fs.writeFileSync(target.absolute, content, { encoding: 'utf-8', flag: 'wx', mode: 0o600 });
    }
  } catch (error) {
    if (error instanceof ProjectFileError) throw error;
    throw new ProjectFileError(500, 'Nao foi possivel salvar o arquivo: ' + (error instanceof Error ? error.message : String(error)));
  } finally {
    try { if (temp && fs.existsSync(temp)) fs.rmSync(temp, { force: true }); } catch { /* best effort */ }
    try { if (lockHandle !== null) fs.closeSync(lockHandle); } catch { /* best effort */ }
    try { if (lockHandle !== null && fs.existsSync(lock)) fs.rmSync(lock, { force: true }); } catch { /* best effort */ }
  }
  return readProjectFile(projectId, target.relative);
}

export function createProjectDirectory(projectId: string, directory: string): ProjectFileMutationResult {
  const target = resolveWriteTarget(projectId, directory);
  if (fs.existsSync(target.absolute)) throw new ProjectFileError(409, 'O caminho ja existe.');
  fs.mkdirSync(target.absolute);
  return { path: target.relative, kind: 'directory' };
}

export function renameProjectPath(
  projectId: string,
  sourcePath: string,
  destinationPath: string,
  expectedEtag?: string | null,
): ProjectFileMutationResult {
  const source = resolveExisting(projectId, sourcePath);
  if (!source.relative) throw new ProjectFileError(403, 'A raiz do projeto nao pode ser renomeada.');
  if (!expectedEtag) throw new ProjectFileError(428, 'Informe o ETag atual para renomear.');
  if (etagFor(source.stat) !== expectedEtag) throw new ProjectFileError(409, 'O item mudou desde que foi aberto.');
  const destination = resolveWriteTarget(projectId, destinationPath);
  if (fs.existsSync(writeLockPath(source.absolute))) throw new ProjectFileError(409, 'Outro salvamento deste arquivo esta em andamento.');
  if (fs.existsSync(destination.absolute)) throw new ProjectFileError(409, 'O destino ja existe.');
  fs.renameSync(source.absolute, destination.absolute);
  return {
    path: destination.relative,
    kind: source.stat.isDirectory() ? 'directory' : 'file',
    document: source.stat.isFile() ? readProjectFile(projectId, destination.relative) : undefined,
  };
}

export function deleteProjectPath(
  projectId: string,
  targetPath: string,
  confirmPath: string,
  expectedEtag?: string | null,
): ProjectFileMutationResult {
  const target = resolveExisting(projectId, targetPath);
  if (!target.relative) throw new ProjectFileError(403, 'A raiz do projeto nao pode ser excluida.');
  if (confirmPath !== target.relative) throw new ProjectFileError(400, 'Confirmacao invalida: informe o caminho exato.');
  if (!expectedEtag) throw new ProjectFileError(428, 'Informe o ETag atual para excluir.');
  if (etagFor(target.stat) !== expectedEtag) throw new ProjectFileError(409, 'O item mudou desde que foi aberto.');
  if (fs.existsSync(writeLockPath(target.absolute))) throw new ProjectFileError(409, 'Outro salvamento deste arquivo esta em andamento.');
  const kind = target.stat.isDirectory() ? 'directory' : 'file';
  if (kind === 'directory' && fs.readdirSync(target.absolute).length > 0) {
    throw new ProjectFileError(409, 'A pasta precisa estar vazia para ser excluida.');
  }
  kind === 'directory' ? fs.rmdirSync(target.absolute) : fs.unlinkSync(target.absolute);
  return { path: target.relative, kind };
}

export function searchProjectFiles(projectId: string, query: string): { query: string; results: ProjectFileSearchResult[]; truncated: boolean } {
  const needle = query.trim();
  if (needle.length < 2) throw new ProjectFileError(400, 'A busca precisa ter pelo menos 2 caracteres.');
  if (needle.length > 120) throw new ProjectFileError(400, 'Busca muito longa.');
  const rootTarget = resolveExisting(projectId, '');
  const pending = [rootTarget.absolute];
  const results: ProjectFileSearchResult[] = [];
  let inspected = 0;
  while (pending.length && inspected < MAX_SEARCH_FILES && results.length < MAX_SEARCH_RESULTS) {
    const directory = pending.pop()!;
    let children: fs.Dirent[];
    try { children = fs.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      const relative = path.relative(rootTarget.root, absolute).split(path.sep).join('/');
      const parent = path.posix.dirname(relative);
      if (!canExposeChild(projectId, parent === '.' ? '' : parent, child.name)) continue;
      let stat: fs.Stats;
      try {
        const linkStat = fs.lstatSync(absolute);
        if (linkStat.isSymbolicLink()) continue;
        const physical = fs.realpathSync.native(absolute);
        if (!isInside(rootTarget.root, physical)) continue;
        stat = fs.statSync(physical);
      } catch { continue; }
      if (stat.isDirectory()) { pending.push(absolute); continue; }
      if (!stat.isFile()) continue;
      inspected++;
      if (stat.size > MAX_SEARCH_FILE_BYTES) continue;
      const sample = fs.readFileSync(absolute).subarray(0, Math.min(stat.size, 8_192));
      const viewer = viewerFor(relative, stat, sample);
      if (viewer === 'image' || viewer === 'pdf' || viewer === 'unsupported') continue;
      const lines = fs.readFileSync(absolute, 'utf-8').split(/\r?\n/);
      const lowerNeedle = needle.toLocaleLowerCase('pt-BR');
      for (let index = 0; index < lines.length && results.length < MAX_SEARCH_RESULTS; index++) {
        if (!lines[index].toLocaleLowerCase('pt-BR').includes(lowerNeedle)) continue;
        results.push({ path: relative, name: child.name, line: index + 1, preview: lines[index].trim().slice(0, 240) });
      }
    }
  }
  return { query: needle, results, truncated: pending.length > 0 || inspected >= MAX_SEARCH_FILES || results.length >= MAX_SEARCH_RESULTS };
}

export function diffProjectFile(projectId: string, filePath: string): { path: string; available: boolean; diff: string; reason?: string } {
  const target = resolveExisting(projectId, filePath);
  if (!target.stat.isFile()) throw new ProjectFileError(400, 'O caminho informado nao e um arquivo.');
  const relative = path.relative(target.root, target.absolute).split(path.sep).join('/');
  const repo = spawnSync('git', ['-C', target.root, 'rev-parse', '--show-toplevel'], { encoding: 'utf-8', windowsHide: true, timeout: 3_000 });
  if (repo.status !== 0) return { path: relative, available: false, diff: '', reason: 'Este projeto nao possui um repositorio Git.' };
  const repoRoot = path.resolve(repo.stdout.trim());
  if (!isInside(repoRoot, target.absolute)) return { path: relative, available: false, diff: '', reason: 'Arquivo fora da raiz Git detectada.' };
  const repoRelative = path.relative(repoRoot, target.absolute);
  const tracked = spawnSync('git', ['-C', repoRoot, 'ls-files', '--error-unmatch', '--', repoRelative], {
    encoding: 'utf-8', windowsHide: true, timeout: 3_000,
  });
  if (tracked.status !== 0) return { path: relative, available: false, diff: '', reason: 'Este arquivo ainda nao e rastreado pelo Git.' };
  const result = spawnSync('git', ['-C', repoRoot, 'diff', '--no-ext-diff', '--no-color', 'HEAD', '--', repoRelative], {
    encoding: 'utf-8', windowsHide: true, timeout: 5_000, maxBuffer: 1024 * 1024,
  });
  if (result.error || (result.status !== 0 && !result.stdout)) {
    return { path: relative, available: false, diff: '', reason: 'Nao foi possivel calcular o diff com o HEAD.' };
  }
  return { path: relative, available: true, diff: result.stdout.slice(0, 1024 * 1024) };
}
