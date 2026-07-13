import { createHash } from 'node:crypto';
import { parseFrontmatter } from '../skills/loader.js';

export type MemoryStatus = 'active' | 'tentative' | 'contested' | 'superseded' | 'stale' | 'needs_review';

export interface VaultMetadata {
  title: string;
  description: string;
  noteType: string;
  status: MemoryStatus;
  confidence: number;
  sourceType: string;
  tags: string[];
  aliases: string[];
  links: string[];
  implementedBy: string[];
  body: string;
}

const VALID_STATUS = new Set<MemoryStatus>([
  'active', 'tentative', 'contested', 'superseded', 'stale', 'needs_review',
]);

function listValue(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String).map(item => item.trim()).filter(Boolean);
    } catch {
      return trimmed.slice(1, -1).split(',').map(item => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    }
  }
  return trimmed.split(',').map(item => item.trim()).filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function firstHeading(body: string): string | undefined {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim();
}

export function extractWikiLinks(content: string): string[] {
  const links: string[] = [];
  for (const match of content.matchAll(/!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
    if (match[1]) links.push(match[1].trim());
  }
  return unique(links);
}

export function parseVaultMetadata(content: string, fallbackName: string, fallbackDescription = ''): VaultMetadata {
  const { data, body } = parseFrontmatter(content);
  const rawStatus = data.status as MemoryStatus | undefined;
  const confidence = Number(data.confidence);
  const explicitLinks = listValue(data.links);
  return {
    title: data.title || firstHeading(body) || fallbackName,
    description: data.description || fallbackDescription,
    noteType: data.type || 'memory',
    status: rawStatus && VALID_STATUS.has(rawStatus) ? rawStatus : 'active',
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 1,
    sourceType: data.source_type || data.source || 'agent_memory',
    tags: unique(listValue(data.tags).map(tag => tag.replace(/^#/, ''))),
    aliases: unique(listValue(data.aliases)),
    links: unique([...explicitLinks, ...extractWikiLinks(body)]),
    implementedBy: unique(listValue(data.implemented_by || data.implementedBy)),
    body: body.trim(),
  };
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

export interface BuildVaultNoteInput {
  title: string;
  description: string;
  content: string;
  noteType?: string;
  status?: MemoryStatus;
  confidence?: number;
  sourceType?: string;
  tags?: string[];
  aliases?: string[];
  links?: string[];
  implementedBy?: string[];
}

export function buildVaultMarkdown(input: BuildVaultNoteInput): string {
  const lines = [
    '---',
    `title: ${yamlString(input.title)}`,
    `description: ${yamlString(input.description)}`,
    `type: ${yamlString(input.noteType || 'memory')}`,
    `status: ${input.status || 'active'}`,
    `confidence: ${Math.max(0, Math.min(1, input.confidence ?? 1))}`,
    `source_type: ${yamlString(input.sourceType || 'agent_memory')}`,
    `tags: ${JSON.stringify(unique(input.tags ?? []))}`,
    `aliases: ${JSON.stringify(unique(input.aliases ?? []))}`,
    `links: ${JSON.stringify(unique(input.links ?? []))}`,
    `implemented_by: ${JSON.stringify(unique(input.implementedBy ?? []))}`,
    '---',
    '',
    input.content.trim(),
    '',
  ];
  return lines.join('\n');
}

export function stableHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function stableId(prefix: string, value: string): string {
  return `${prefix}:${stableHash(value).slice(0, 24)}`;
}

export function normalizeReference(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/\.md$/i, '')
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '');
}
