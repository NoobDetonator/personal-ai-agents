import { tool } from 'ai';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig, getConfigPath } from '../config/loader.js';
import { askConfirmation } from '../chat/confirm.js';

// Extensions that are always blocked regardless of config (database files)
const PROTECTED_EXTENSIONS = ['.db', '.db-journal', '.db-wal', '.db-shm'];

// Directory names the agent can never touch
const PROTECTED_DIRS = ['.git', 'node_modules'];

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function canonicalizePath(filePath: string): string | null {
  const resolved = path.resolve(filePath);
  let existing = resolved;
  const missingSegments: string[] = [];

  try {
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) return null;
      missingSegments.unshift(path.basename(existing));
      existing = parent;
    }
    const physicalBase = fs.realpathSync.native(existing);
    return path.resolve(physicalBase, ...missingSegments);
  } catch {
    return null;
  }
}

function samePath(a: string, b: string): boolean {
  // Windows paths are case-insensitive
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function resolveAllowedPath(filePath: string): string | null {
  const config = getConfig();
  const lexical = path.resolve(filePath);

  try {
    if (fs.existsSync(lexical) && fs.lstatSync(lexical).isSymbolicLink()) return null;
  } catch {
    return null;
  }

  const physical = canonicalizePath(lexical);
  if (!physical) return null;

  // config.json controls shell mode and permissions — writable only via updateConfig
  const protectedConfig = canonicalizePath(getConfigPath()) ?? path.resolve(getConfigPath());

  for (const candidate of [lexical, physical]) {
    const ext = path.extname(candidate).toLowerCase();
    const base = path.basename(candidate).toLowerCase();
    const segments = candidate.split(path.sep).map(segment => segment.toLowerCase());

    if (samePath(candidate, protectedConfig)) return null;
    if (config.fileOps.blockedExtensions.includes(ext)) return null;
    if (base === '.env' || base.startsWith('.env.')) return null;
    if (PROTECTED_EXTENSIONS.includes(ext)) return null;
    if (PROTECTED_DIRS.some(dir => segments.includes(dir))) return null;
  }

  const allowedRoots = [...config.fileOps.allowedPaths];
  if (config.obsidian.vaultPath) allowedRoots.push(config.obsidian.vaultPath);

  const allowed = allowedRoots.some(root => {
    const physicalRoot = canonicalizePath(root);
    return physicalRoot !== null && isInside(physicalRoot, physical);
  });
  return allowed ? physical : null;
}

function checkFileSize(filePath: string): boolean {
  try {
    return fs.statSync(filePath).size <= getConfig().fileOps.maxFileSizeKB * 1024;
  } catch {
    return true;
  }
}

function checkContentSize(content: string, existingBytes: number = 0): boolean {
  const maxBytes = getConfig().fileOps.maxFileSizeKB * 1024;
  return existingBytes + Buffer.byteLength(content, 'utf-8') <= maxBytes;
}

async function confirmDestructive(action: string, filePath: string): Promise<boolean> {
  if (!getConfig().fileOps.confirmDestructive) return true;
  const result = await askConfirmation(
    `${action}: "${filePath}"?`,
    { allowAlways: false },
  );
  return result.answer === 'yes';
}

export const readFileTool = tool({
  description: 'Ler o conteudo de um arquivo',
  inputSchema: z.object({
    path: z.string().describe('Caminho do arquivo para ler'),
  }),
  execute: async ({ path: filePath }) => {
    const resolved = resolveAllowedPath(filePath);
    if (!resolved) {
      return { error: `Acesso negado ao caminho: ${filePath}` };
    }
    if (!fs.existsSync(resolved)) {
      return { error: `Arquivo nao encontrado: ${filePath}` };
    }
    if (!fs.statSync(resolved).isFile()) {
      return { error: `O caminho nao e um arquivo: ${filePath}` };
    }
    if (!checkFileSize(resolved)) {
      return { error: `Arquivo muito grande para ler` };
    }
    const content = fs.readFileSync(resolved, 'utf-8');
    return { content, path: resolved };
  },
});

export const writeFileTool = tool({
  description: 'Criar ou sobrescrever um arquivo com conteudo',
  inputSchema: z.object({
    path: z.string().describe('Caminho do arquivo'),
    content: z.string().describe('Conteudo a ser escrito'),
  }),
  execute: async ({ path: filePath, content }) => {
    const resolved = resolveAllowedPath(filePath);
    if (!resolved) {
      return { error: `Acesso negado ao caminho: ${filePath}` };
    }
    if (!checkContentSize(content)) {
      return { error: `Conteudo excede o limite de tamanho configurado` };
    }
    if (fs.existsSync(resolved) && !await confirmDestructive('Sobrescrever arquivo', resolved)) {
      return { error: 'Sobrescrita negada pelo usuario.' };
    }
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(resolved, content, 'utf-8');
    return { success: true, path: resolved };
  },
});

export const appendFileTool = tool({
  description:
    'Adicionar conteudo ao FINAL de um arquivo existente (ou criar se nao existir). ESSENCIAL para arquivos grandes: escreva a primeira parte com writeFile e continue com appendFile em blocos — nunca tente escrever um arquivo longo inteiro de uma vez.',
  inputSchema: z.object({
    path: z.string().describe('Caminho do arquivo'),
    content: z.string().describe('Conteudo a adicionar ao final'),
  }),
  execute: async ({ path: filePath, content }) => {
    const resolved = resolveAllowedPath(filePath);
    if (!resolved) {
      return { error: `Acesso negado ao caminho: ${filePath}` };
    }
    const existingBytes = fs.existsSync(resolved) ? fs.statSync(resolved).size : 0;
    if (!checkContentSize(content, existingBytes)) {
      return { error: `Conteudo excede o limite de tamanho configurado` };
    }
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(resolved, content, 'utf-8');
    const stats = fs.statSync(resolved);
    return { success: true, path: resolved, totalBytes: stats.size };
  },
});

export const editFileTool = tool({
  description: 'Substituir texto especifico em um arquivo existente',
  inputSchema: z.object({
    path: z.string().describe('Caminho do arquivo'),
    search: z.string().describe('Texto a ser encontrado'),
    replace: z.string().describe('Texto substituto'),
  }),
  execute: async ({ path: filePath, search, replace }) => {
    const resolved = resolveAllowedPath(filePath);
    if (!resolved) {
      return { error: `Acesso negado ao caminho: ${filePath}` };
    }
    if (!fs.existsSync(resolved)) {
      return { error: `Arquivo nao encontrado: ${filePath}` };
    }
    if (!fs.statSync(resolved).isFile() || !checkFileSize(resolved)) {
      return { error: `Arquivo invalido ou muito grande para editar` };
    }
    let content = fs.readFileSync(resolved, 'utf-8');
    if (!content.includes(search)) {
      return { error: `Texto nao encontrado no arquivo` };
    }
    content = content.replace(search, replace);
    if (!checkContentSize(content)) {
      return { error: `Resultado excede o limite de tamanho configurado` };
    }
    fs.writeFileSync(resolved, content, 'utf-8');
    return { success: true, path: resolved };
  },
});

export const deleteFileTool = tool({
  description: 'Deletar um arquivo (use com cuidado)',
  inputSchema: z.object({
    path: z.string().describe('Caminho do arquivo para deletar'),
  }),
  execute: async ({ path: filePath }) => {
    const resolved = resolveAllowedPath(filePath);
    if (!resolved) {
      return { error: `Acesso negado ao caminho: ${filePath}` };
    }
    if (!fs.existsSync(resolved)) {
      return { error: `Arquivo nao encontrado: ${filePath}` };
    }
    if (!fs.statSync(resolved).isFile()) {
      return { error: `O caminho nao e um arquivo: ${filePath}` };
    }
    if (!await confirmDestructive('Deletar arquivo', resolved)) {
      return { error: 'Exclusao negada pelo usuario.' };
    }
    fs.unlinkSync(resolved);
    return { success: true, path: resolved };
  },
});

export const listFilesTool = tool({
  description: 'Listar arquivos e pastas em um diretorio',
  inputSchema: z.object({
    path: z.string().describe('Caminho do diretorio').default('workspace'),
  }),
  execute: async ({ path: dirPath }) => {
    const resolved = resolveAllowedPath(dirPath);
    if (!resolved) {
      return { error: `Acesso negado ao caminho: ${dirPath}` };
    }
    if (!fs.existsSync(resolved)) {
      return { error: `Diretorio nao encontrado: ${dirPath}` };
    }
    if (!fs.statSync(resolved).isDirectory()) {
      return { error: `O caminho nao e um diretorio: ${dirPath}` };
    }
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const items = entries.map(e => ({
      name: e.name,
      type: e.isDirectory() ? 'pasta' : 'arquivo',
    }));
    return { path: resolved, items };
  },
});
