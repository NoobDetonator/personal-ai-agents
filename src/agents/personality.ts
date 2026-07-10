import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = process.cwd();
const AGENTS_DIR = path.join(ROOT_DIR, 'agents');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.join(__dirname, 'templates');

export function getAgentsDir(): string {
  return AGENTS_DIR;
}

export function getAgentDir(agentId: string): string {
  return path.join(AGENTS_DIR, agentId);
}

export function readSoul(agentId: string): string {
  const soulPath = path.join(AGENTS_DIR, agentId, 'soul.md');
  try {
    return fs.readFileSync(soulPath, 'utf-8');
  } catch {
    return '';
  }
}

export function readMemory(agentId: string): string {
  const memoryPath = path.join(AGENTS_DIR, agentId, 'memory.md');
  try {
    return fs.readFileSync(memoryPath, 'utf-8');
  } catch {
    return '';
  }
}

export function writeMemory(agentId: string, content: string): void {
  const memoryPath = path.join(AGENTS_DIR, agentId, 'memory.md');
  fs.writeFileSync(memoryPath, content, 'utf-8');
}

export function appendToMemorySection(agentId: string, section: string, content: string): void {
  const memory = readMemory(agentId);
  const sectionHeader = `## ${section}`;
  const placeholder = '- (Nada registrado ainda)';

  let updated: string;
  if (memory.includes(sectionHeader)) {
    const sectionIndex = memory.indexOf(sectionHeader);
    const afterHeader = sectionIndex + sectionHeader.length;
    const nextSectionIndex = memory.indexOf('\n## ', afterHeader);
    const sectionEnd = nextSectionIndex === -1 ? memory.length : nextSectionIndex;
    const sectionContent = memory.substring(afterHeader, sectionEnd);

    let newSectionContent: string;
    if (sectionContent.includes(placeholder)) {
      newSectionContent = sectionContent.replace(placeholder, `- ${content}`);
    } else {
      newSectionContent = sectionContent.trimEnd() + `\n- ${content}\n`;
    }

    updated = memory.substring(0, afterHeader) + newSectionContent + memory.substring(sectionEnd);
  } else {
    updated = memory + `\n## ${section}\n- ${content}\n`;
  }

  writeMemory(agentId, updated);
}

// --- Daily notes (OpenClaw-style: agents/<id>/memory/YYYY-MM-DD.md) ---

function todayStamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getDailyNotePath(agentId: string, dateStamp?: string): string {
  return path.join(AGENTS_DIR, agentId, 'memory', `${dateStamp ?? todayStamp()}.md`);
}

export function readDailyNote(agentId: string, dateStamp?: string): string {
  try {
    return fs.readFileSync(getDailyNotePath(agentId, dateStamp), 'utf-8');
  } catch {
    return '';
  }
}

export function appendDailyNote(agentId: string, content: string): void {
  const notePath = getDailyNotePath(agentId);
  const dir = path.dirname(notePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const entry = `- [${time}] ${content.trim()}\n`;

  if (!fs.existsSync(notePath)) {
    fs.writeFileSync(notePath, `# Nota diaria — ${todayStamp()}\n\n${entry}`, 'utf-8');
  } else {
    fs.appendFileSync(notePath, entry, 'utf-8');
  }
}

// --- Deep memories (memdir-style: agents/<id>/memories/<slug>.md) ---

export function getMemoriesDir(agentId: string): string {
  return path.join(AGENTS_DIR, agentId, 'memories');
}

export function saveDeepMemoryFile(agentId: string, slug: string, description: string, content: string): string {
  const clean = slug.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-');
  if (!clean) {
    throw new Error('Slug de memoria invalido.');
  }
  const dir = getMemoriesDir(agentId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, `${clean}.md`);
  fs.writeFileSync(filePath, `---\ndescription: ${description}\n---\n\n${content.trim()}\n`, 'utf-8');
  return clean;
}

export function readDeepMemoryFile(agentId: string, slug: string): string | null {
  const filePath = path.join(getMemoriesDir(agentId), `${slug}.md`);
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export function createAgentFiles(agentId: string, customSoul?: string): void {
  const agentDir = path.join(AGENTS_DIR, agentId);

  if (!fs.existsSync(agentDir)) {
    fs.mkdirSync(agentDir, { recursive: true });
  }

  const soulPath = path.join(agentDir, 'soul.md');
  if (!fs.existsSync(soulPath)) {
    const soulTemplate = customSoul || fs.readFileSync(path.join(TEMPLATES_DIR, 'default-soul.md'), 'utf-8');
    fs.writeFileSync(soulPath, soulTemplate, 'utf-8');
  }

  const memoryPath = path.join(agentDir, 'memory.md');
  if (!fs.existsSync(memoryPath)) {
    const memoryTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'default-memory.md'), 'utf-8');
    fs.writeFileSync(memoryPath, memoryTemplate, 'utf-8');
  }
}

export function deleteAgentFiles(agentId: string): void {
  const agentDir = path.join(AGENTS_DIR, agentId);
  if (fs.existsSync(agentDir)) {
    fs.rmSync(agentDir, { recursive: true });
  }
}

export function discoverAgents(): string[] {
  if (!fs.existsSync(AGENTS_DIR)) {
    fs.mkdirSync(AGENTS_DIR, { recursive: true });
  }

  return fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}
