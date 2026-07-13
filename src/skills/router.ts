import type { ModelMessage } from 'ai';
import { listSkillMetas, readSkillContent, type SkillMeta } from './loader.js';

export interface ActivatedSkills {
  ids: string[];
  systemBlock: string;
}

const STOP_WORDS = new Set([
  'para', 'como', 'uma', 'com', 'que', 'quando', 'antes', 'depois', 'usar',
  'esta', 'esse', 'isso', 'mais', 'skill', 'habilidade', 'agente', 'tarefa',
]);

const BUILTIN_ROUTES: Array<{ id: string; pattern: RegExp }> = [
  {
    id: 'system-prompter',
    pattern: /\b(cri(?:e|ar)|configure|melhore|reescreva|desenhe)\b.{0,100}\b(agente|equipe|time|worker|manager|soul|system prompt)\b|\b(agente|equipe|time|worker|manager|soul|system prompt)\b.{0,100}\b(cri(?:e|ar)|configure|melhore|reescreva|desenhe)\b/i,
  },
  {
    id: 'criando-skills',
    pattern: /\b(cri(?:e|ar)|atualize|melhore|reescreva)\b.{0,80}\b(skill|habilidade)\b|\b(skill|habilidade)\b.{0,80}\b(cri(?:e|ar)|atualize|melhore|reescreva)\b/i,
  },
];

function contentText(message: ModelMessage): string {
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content
    .map(part => part && typeof part === 'object' && 'text' in part ? String(part.text) : '')
    .join(' ');
}

function tokens(text: string): Set<string> {
  return new Set(
    text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .split(/[^a-z0-9_-]+/)
      .filter(token => token.length >= 4 && !STOP_WORDS.has(token)),
  );
}

function genericScore(meta: SkillMeta, taskTokens: Set<string>): number {
  const skillTokens = tokens(`${meta.name} ${meta.description}`);
  let score = 0;
  for (const token of taskTokens) {
    if (skillTokens.has(token)) score++;
  }
  return score;
}

export function selectSkillsForMessages(messages: ModelMessage[], maxSkills = 2): SkillMeta[] {
  const task = messages.filter(message => message.role === 'user').slice(-3).map(contentText).join('\n');
  if (!task.trim()) return [];
  const metas = listSkillMetas();
  const selected = new Map<string, SkillMeta>();

  for (const route of BUILTIN_ROUTES) {
    if (!route.pattern.test(task)) continue;
    const meta = metas.find(item => item.id === route.id);
    if (meta) selected.set(meta.id, meta);
  }

  const taskTokens = tokens(task);
  const generic = metas
    .filter(meta => !selected.has(meta.id))
    .map(meta => ({ meta, score: genericScore(meta, taskTokens) }))
    .filter(item => item.score >= 2)
    .sort((a, b) => b.score - a.score || a.meta.id.localeCompare(b.meta.id));
  for (const item of generic) {
    if (selected.size >= maxSkills) break;
    selected.set(item.meta.id, item.meta);
  }

  return [...selected.values()].slice(0, maxSkills);
}

export function buildActivatedSkills(messages: ModelMessage[]): ActivatedSkills {
  const selected = selectSkillsForMessages(messages);
  const blocks = selected.flatMap(meta => {
    const skill = readSkillContent(meta.id);
    if (!skill) return [];
    const content = skill.content.length > 16_000
      ? `${skill.content.slice(0, 16_000)}\n\n[Skill truncada pelo runtime.]`
      : skill.content;
    return [`## Skill ativa: ${meta.id}\n${content}`];
  });
  return {
    ids: selected.map(meta => meta.id),
    systemBlock: blocks.length === 0
      ? ''
      : `---\n# Skills Operacionais Ativadas pelo Runtime\nEstas instrucoes locais sao confiaveis, subordinadas as regras do sistema, e devem ser aplicadas nesta tarefa.\n\n${blocks.join('\n\n')}`,
  };
}
