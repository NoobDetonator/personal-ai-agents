import fs from 'node:fs';
import path from 'node:path';
import {
  appendDailyNote,
  appendToMemorySection,
  getMemoriesDir,
  readDailyNote,
  readDeepMemoryFile,
  readMemory,
  saveDeepMemoryFile,
} from '../agents/personality.js';
import { getProjectContext } from './context.js';
import { getProjectSettings } from './service.js';

function memoryDisabled(): boolean {
  const ctx = getProjectContext();
  return !!ctx && getProjectSettings(ctx.projectId)?.memory_enabled === 0;
}

function scopedAgentDir(agentId: string): string | null {
  const ctx = getProjectContext();
  if (!ctx || ctx.projectId === 'legacy') return null;
  if (!/^[a-z0-9_-]+$/i.test(agentId)) throw new Error('ID de agente invalido.');
  return path.join(path.dirname(ctx.projectRoot), '.aria', 'agents', agentId);
}

function todayStamp(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function readText(filePath: string): string {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return ''; }
}

export function readScopedMemory(agentId: string): string {
  if (memoryDisabled()) return '';
  const dir = scopedAgentDir(agentId);
  return dir ? readText(path.join(dir, 'memory.md')) : readMemory(agentId);
}

export function appendScopedMemorySection(agentId: string, section: string, content: string): void {
  if (memoryDisabled()) throw new Error('Memoria desativada neste projeto.');
  const dir = scopedAgentDir(agentId);
  if (!dir) return appendToMemorySection(agentId, section, content);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'memory.md');
  const current = readText(filePath);
  const header = `## ${section}`;
  let updated: string;
  if (!current.includes(header)) {
    updated = `${current.trimEnd()}${current ? '\n\n' : ''}${header}\n- ${content.trim()}\n`;
  } else {
    const start = current.indexOf(header) + header.length;
    const next = current.indexOf('\n## ', start);
    const end = next === -1 ? current.length : next;
    const body = current.slice(start, end).replace('- (Nada registrado ainda)', '').trimEnd();
    updated = current.slice(0, start) + `${body ? `${body}\n` : '\n'}- ${content.trim()}\n` + current.slice(end);
  }
  fs.writeFileSync(filePath, updated, 'utf-8');
}

export function readScopedDailyNote(agentId: string, date?: string): string {
  if (memoryDisabled()) return '';
  const dir = scopedAgentDir(agentId);
  return dir ? readText(path.join(dir, 'daily', `${date ?? todayStamp()}.md`)) : readDailyNote(agentId, date);
}

export function appendScopedDailyNote(agentId: string, content: string): void {
  if (memoryDisabled()) throw new Error('Memoria desativada neste projeto.');
  const dir = scopedAgentDir(agentId);
  if (!dir) return appendDailyNote(agentId, content);
  const dailyDir = path.join(dir, 'daily');
  fs.mkdirSync(dailyDir, { recursive: true });
  const stamp = todayStamp();
  const filePath = path.join(dailyDir, `${stamp}.md`);
  const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const entry = `- [${time}] ${content.trim()}\n`;
  fs.appendFileSync(filePath, fs.existsSync(filePath) ? entry : `# Nota diaria - ${stamp}\n\n${entry}`, 'utf-8');
}

export function getScopedMemoriesDir(agentId: string): string {
  if (memoryDisabled()) return path.join(getProjectContext()!.projectRoot, '.aria-disabled-memory', agentId);
  const dir = scopedAgentDir(agentId);
  return dir ? path.join(dir, 'memories') : getMemoriesDir(agentId);
}

export function saveScopedDeepMemory(agentId: string, slug: string, description: string, content: string): string {
  if (memoryDisabled()) throw new Error('Memoria desativada neste projeto.');
  const dir = scopedAgentDir(agentId);
  if (!dir) return saveDeepMemoryFile(agentId, slug, description, content);
  const clean = slug.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-');
  if (!clean) throw new Error('Slug de memoria invalido.');
  const memoriesDir = path.join(dir, 'memories');
  fs.mkdirSync(memoriesDir, { recursive: true });
  fs.writeFileSync(path.join(memoriesDir, `${clean}.md`), `---\ndescription: ${description}\n---\n\n${content.trim()}\n`, 'utf-8');
  return clean;
}

export function readScopedDeepMemory(agentId: string, slug: string): string | null {
  if (memoryDisabled()) return null;
  const dir = scopedAgentDir(agentId);
  if (!dir) return readDeepMemoryFile(agentId, slug);
  const content = readText(path.join(dir, 'memories', `${slug}.md`));
  return content || null;
}
