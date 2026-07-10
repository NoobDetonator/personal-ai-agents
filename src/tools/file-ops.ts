import { tool } from 'ai';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../config/loader.js';

// Extensions that are always blocked regardless of config (database files)
const PROTECTED_EXTENSIONS = ['.db', '.db-journal', '.db-wal', '.db-shm'];

// Directory names the agent can never touch
const PROTECTED_DIRS = ['.git', 'node_modules'];

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isPathAllowed(filePath: string): boolean {
  const config = getConfig();
  const resolved = path.resolve(filePath);
  const ext = path.extname(resolved).toLowerCase();
  const base = path.basename(resolved).toLowerCase();

  if (config.fileOps.blockedExtensions.includes(ext)) {
    return false;
  }

  // Sensitive files: .env*, databases, git internals, node_modules
  if (base === '.env' || base.startsWith('.env.')) {
    return false;
  }
  if (PROTECTED_EXTENSIONS.includes(ext)) {
    return false;
  }
  const segments = resolved.split(path.sep).map(s => s.toLowerCase());
  if (PROTECTED_DIRS.some(dir => segments.includes(dir))) {
    return false;
  }

  const allowedRoots = [...config.fileOps.allowedPaths];
  if (config.obsidian.vaultPath) {
    allowedRoots.push(config.obsidian.vaultPath);
  }

  return allowedRoots.some(allowed => {
    const allowedResolved = path.resolve(allowed);
    return isInside(allowedResolved, resolved);
  });
}

function checkFileSize(filePath: string): boolean {
  const config = getConfig();
  try {
    const stats = fs.statSync(filePath);
    return stats.size <= config.fileOps.maxFileSizeKB * 1024;
  } catch {
    return true;
  }
}

export const readFileTool = tool({
  description: 'Ler o conteudo de um arquivo',
  inputSchema: z.object({
    path: z.string().describe('Caminho do arquivo para ler'),
  }),
  execute: async ({ path: filePath }) => {
    const resolved = path.resolve(filePath);
    if (!isPathAllowed(resolved)) {
      return { error: `Acesso negado ao caminho: ${filePath}` };
    }
    if (!fs.existsSync(resolved)) {
      return { error: `Arquivo nao encontrado: ${filePath}` };
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
    const resolved = path.resolve(filePath);
    if (!isPathAllowed(resolved)) {
      return { error: `Acesso negado ao caminho: ${filePath}` };
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
    const resolved = path.resolve(filePath);
    if (!isPathAllowed(resolved)) {
      return { error: `Acesso negado ao caminho: ${filePath}` };
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
    const resolved = path.resolve(filePath);
    if (!isPathAllowed(resolved)) {
      return { error: `Acesso negado ao caminho: ${filePath}` };
    }
    if (!fs.existsSync(resolved)) {
      return { error: `Arquivo nao encontrado: ${filePath}` };
    }
    let content = fs.readFileSync(resolved, 'utf-8');
    if (!content.includes(search)) {
      return { error: `Texto nao encontrado no arquivo` };
    }
    content = content.replace(search, replace);
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
    const resolved = path.resolve(filePath);
    if (!isPathAllowed(resolved)) {
      return { error: `Acesso negado ao caminho: ${filePath}` };
    }
    if (!fs.existsSync(resolved)) {
      return { error: `Arquivo nao encontrado: ${filePath}` };
    }
    fs.unlinkSync(resolved);
    return { success: true, path: resolved };
  },
});

export const listFilesTool = tool({
  description: 'Listar arquivos e pastas em um diretorio',
  inputSchema: z.object({
    path: z.string().describe('Caminho do diretorio').default('.'),
  }),
  execute: async ({ path: dirPath }) => {
    const resolved = path.resolve(dirPath);
    if (!isPathAllowed(resolved)) {
      return { error: `Acesso negado ao caminho: ${dirPath}` };
    }
    if (!fs.existsSync(resolved)) {
      return { error: `Diretorio nao encontrado: ${dirPath}` };
    }
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const items = entries.map(e => ({
      name: e.name,
      type: e.isDirectory() ? 'pasta' : 'arquivo',
    }));
    return { path: resolved, items };
  },
});
