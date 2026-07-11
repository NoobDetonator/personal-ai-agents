import fs from 'node:fs';
import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';

export interface SkillMeta {
  id: string;          // folder name (slug)
  name: string;        // from frontmatter (falls back to id)
  description: string; // from frontmatter
  protected: boolean;  // frontmatter `protected: true` — skill interna, imutavel via updateSkill
  dir: string;         // absolute path to the skill folder
  filePath: string;    // absolute path to SKILL.md
}

const SKILLS_DIR = path.join(process.cwd(), 'skills');

let skills = new Map<string, SkillMeta>();
let watcher: FSWatcher | null = null;

export function getSkillsDir(): string {
  return SKILLS_DIR;
}

/**
 * Minimal YAML frontmatter parser: handles `key: value` pairs with optional
 * quotes and indented continuation lines. Enough for the agentskills.io
 * standard (name + description) without pulling in a YAML dependency.
 */
export function parseFrontmatter(content: string): { data: Record<string, string>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { data: {}, body: content };
  }

  const data: Record<string, string> = {};
  let currentKey: string | null = null;

  for (const rawLine of match[1].split(/\r?\n/)) {
    const keyMatch = rawLine.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      let value = keyMatch[2].trim();
      // Block scalars (| or >): value comes from continuation lines
      if (value === '|' || value === '>' || value === '|-' || value === '>-') {
        value = '';
      }
      data[currentKey] = stripQuotes(value);
    } else if (currentKey && /^\s+\S/.test(rawLine)) {
      // Indented continuation line
      const cont = rawLine.trim();
      data[currentKey] = data[currentKey] ? `${data[currentKey]} ${cont}` : cont;
    }
  }

  return { data, body: content.slice(match[0].length) };
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function loadSkills(): void {
  const next = new Map<string, SkillMeta>();

  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
  }

  for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const dir = path.join(SKILLS_DIR, entry.name);
    const filePath = path.join(dir, 'SKILL.md');
    if (!fs.existsSync(filePath)) continue;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const { data } = parseFrontmatter(content);
      next.set(entry.name, {
        id: entry.name,
        name: data.name || entry.name,
        description: data.description || '',
        protected: data.protected === 'true',
        dir,
        filePath,
      });
    } catch {
      // Skip malformed skills without breaking startup
    }
  }

  skills = next;
}

export function listSkillMetas(): SkillMeta[] {
  return Array.from(skills.values()).sort((a, b) => a.id.localeCompare(b.id));
}

export function getSkillMeta(idOrName: string): SkillMeta | undefined {
  const key = idOrName.toLowerCase().trim();
  return (
    skills.get(key) ??
    Array.from(skills.values()).find(
      s => s.id.toLowerCase() === key || s.name.toLowerCase() === key
    )
  );
}

export interface SkillContent {
  meta: SkillMeta;
  content: string;   // full SKILL.md (frontmatter + body)
  files: string[];   // other files in the skill folder (relative paths)
}

export function readSkillContent(idOrName: string): SkillContent | undefined {
  const meta = getSkillMeta(idOrName);
  if (!meta) return undefined;

  const content = fs.readFileSync(meta.filePath, 'utf-8');
  const files: string[] = [];

  const walk = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
      } else if (entry.name !== 'SKILL.md') {
        files.push(rel);
      }
    }
  };
  walk(meta.dir, '');

  return { meta, content, files };
}

export function createSkillFiles(id: string, name: string, description: string, instructions: string): SkillMeta {
  const slug = id.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-');
  if (!slug) {
    throw new Error('Nome de skill invalido.');
  }
  if (skills.has(slug)) {
    throw new Error(`Skill "${slug}" ja existe. Use updateSkill para melhora-la.`);
  }

  const dir = path.join(SKILLS_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });

  const content = [
    '---',
    `name: ${name || slug}`,
    `description: ${description}`,
    '---',
    '',
    instructions.trim(),
    '',
  ].join('\n');

  fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf-8');
  loadSkills();
  return skills.get(slug)!;
}

export function updateSkillFiles(idOrName: string, updates: { description?: string; instructions?: string }): SkillMeta {
  const meta = getSkillMeta(idOrName);
  if (!meta) {
    throw new Error(`Skill "${idOrName}" nao encontrada.`);
  }
  if (meta.protected) {
    throw new Error(
      `Skill "${meta.id}" e interna e protegida contra alteracao. Proponha a melhoria ao usuario em vez de alterar.`,
    );
  }

  const current = fs.readFileSync(meta.filePath, 'utf-8');
  const { data, body } = parseFrontmatter(current);

  const name = data.name || meta.id;
  const description = updates.description ?? data.description ?? '';
  const instructions = updates.instructions ?? body;

  const content = [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    '---',
    '',
    instructions.trim(),
    '',
  ].join('\n');

  fs.writeFileSync(meta.filePath, content, 'utf-8');
  loadSkills();
  return skills.get(meta.id)!;
}

// --- Watcher (hot reload, same pattern as config/watcher.ts) ---

export function startSkillsWatcher(): void {
  if (watcher) return;

  watcher = watch(SKILLS_DIR, {
    ignoreInitial: true,
    depth: 2,
    awaitWriteFinish: { stabilityThreshold: 300 },
  });

  const reload = (): void => {
    try {
      loadSkills();
    } catch {
      // keep last good state
    }
  };

  watcher.on('add', reload);
  watcher.on('change', reload);
  watcher.on('unlink', reload);
  watcher.on('unlinkDir', reload);
}

export function stopSkillsWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}
