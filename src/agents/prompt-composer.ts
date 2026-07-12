import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getSkillsDir, parseFrontmatter } from '../skills/loader.js';

/**
 * Compositor deterministico de souls a partir da biblioteca de perfis
 * (skills/system-prompter/perfis). Garante em codigo o que a skill
 * system-prompter recomenda: soul curta, perfil aplicado de forma
 * consistente e origem registrada — sem depender do modelo lembrar
 * de seguir o manual.
 */

export const MAX_SOUL_WORDS = 150;
export const MAX_MISSION_WORDS = 30;
export const MAX_SEED_MEMORY_CHARS = 4000;

const PROFILES_SKILL_ID = 'system-prompter';

// Arquivos da biblioteca que nao sao papeis instanciaveis
const NON_ROLE_FILES = new Set(['core-operacional.md', 'aria-super-system.md']);

export interface ProfileInfo {
  id: string;      // slug (nome do arquivo sem .md)
  title: string;   // H1 do perfil
  summary: string; // primeiro paragrafo apos o H1 (essencia do papel)
  file: string;    // caminho relativo, legivel via readFile
  revision: string; // hash curto do conteudo usado para compor a soul
}

export function getProfilesDir(): string {
  return path.join(getSkillsDir(), PROFILES_SKILL_ID, 'perfis');
}

/**
 * Extrai titulo (H1) e resumo (primeiro paragrafo de prosa apos o H1,
 * pulando blockquotes de integracao) de um perfil em Markdown.
 */
export function extractProfileInfo(markdown: string, id: string): ProfileInfo {
  const { body } = parseFrontmatter(markdown);
  const lines = body.split(/\r?\n/);

  let title = id;
  let index = 0;
  for (; index < lines.length; index++) {
    const match = lines[index].match(/^#\s+(.+)$/);
    if (match) {
      title = match[1].replace(/^System Prompt:\s*/i, '').replace(/\s+—.*$/, '').trim();
      index++;
      break;
    }
  }

  const paragraph: string[] = [];
  let inBlockquote = false;
  for (; index < lines.length; index++) {
    const line = lines[index].trim();
    if (line.startsWith('>')) {
      inBlockquote = true;
      continue;
    }
    if (line === '') {
      if (paragraph.length > 0) break;
      inBlockquote = false;
      continue;
    }
    if (inBlockquote) continue; // continuacao de blockquote sem ">"
    if (line.startsWith('#') || line.startsWith('---') || line.startsWith('|')) {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(line);
  }

  let summary = paragraph.join(' ').replace(/\s+/g, ' ').trim();
  if (summary.length > 420) {
    const cut = summary.slice(0, 420);
    summary = cut.slice(0, Math.max(cut.lastIndexOf('. ') + 1, cut.lastIndexOf(' '))).trim();
  }

  const revision = createHash('sha256').update(markdown, 'utf8').digest('hex').slice(0, 12);
  return { id, title, summary, file: `skills/${PROFILES_SKILL_ID}/perfis/${id}.md`, revision };
}

export function listProfiles(): ProfileInfo[] {
  const dir = getProfilesDir();
  if (!fs.existsSync(dir)) return [];

  const profiles: ProfileInfo[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.md') || NON_ROLE_FILES.has(file)) continue;
    try {
      const markdown = fs.readFileSync(path.join(dir, file), 'utf-8');
      profiles.push(extractProfileInfo(markdown, file.replace(/\.md$/, '')));
    } catch {
      // perfil ilegivel nao derruba a listagem
    }
  }
  return profiles.sort((a, b) => a.id.localeCompare(b.id));
}

export function getProfile(id: string): ProfileInfo | undefined {
  const slug = id.toLowerCase().trim().replace(/\.md$/, '');
  return listProfiles().find(p => p.id === slug);
}

/** Manual integral confiavel de um perfil gerenciado. */
export function readProfileManual(id: string): string | null {
  const profile = getProfile(id);
  if (!profile) return null;
  try {
    return fs.readFileSync(path.join(getProfilesDir(), `${profile.id}.md`), 'utf-8').trim();
  } catch {
    return null;
  }
}

/** Nucleo comum aplicado a todo agente com perfil gerenciado. */
export function readOperationalCore(): string | null {
  try {
    return fs.readFileSync(path.join(getProfilesDir(), 'core-operacional.md'), 'utf-8').trim();
  } catch {
    return null;
  }
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export interface ComposeSoulOptions {
  profileId: string;
  agentName: string;
  team?: string | null;
  temporary?: boolean;
  /** 1-2 frases com a funcao especifica deste agente neste trabalho */
  mission?: string;
}

/**
 * Gera uma soul curta e padronizada a partir de um perfil da biblioteca.
 * Lanca erro descritivo se o perfil nao existir ou a missao for longa demais.
 */
export function composeSoul(opts: ComposeSoulOptions): string {
  const profile = getProfile(opts.profileId);
  if (!profile) {
    const available = listProfiles().map(p => p.id).join(', ');
    throw new Error(`Perfil "${opts.profileId}" nao existe. Disponiveis: ${available}`);
  }
  if (opts.mission && countWords(opts.mission) > MAX_MISSION_WORDS) {
    throw new Error(
      `A funcao/missao tem mais de ${MAX_MISSION_WORDS} palavras. Resuma-a; contexto extenso pertence a initialMemory.`,
    );
  }

  const vinculo = opts.temporary ? 'temporario' : 'permanente';
  const equipe = opts.team ? ` da equipe "${opts.team}"` : '';
  const missao = opts.mission ? `\nSua funcao neste trabalho: ${opts.mission.trim()}\n` : '';

  const soul = `# Personalidade

Voce e ${opts.agentName}, agente ${vinculo}${equipe}, no papel de ${profile.title}.

${profile.summary}
${missao}
## Como trabalha
- Manual completo do papel: leia "${profile.file}" com readFile antes de tarefas que exigem rigor total
- Use suas ferramentas de verdade e reporte apenas resultados reais e verificados
- Reporte ao superior no formato pedido; diga claramente o que nao conseguiu concluir
`;

  const sizeError = validateSoulText(soul);
  if (sizeError) {
    throw new Error(`A soul composta para o perfil "${profile.id}" ficou invalida: ${sizeError}`);
  }
  return soul;
}

/** Monta e valida o caminho manual com o mesmo limite aplicado ao arquivo final. */
export function composeManualSoul(personality: string): string {
  const soul = `# Personalidade

${personality.trim()}

## Comportamento
- Seja objetivo e execute o que seu superior pedir, reportando resultados reais
- Use suas ferramentas de verdade; nunca invente resultados
- Salve aprendizados na sua memoria; alteracoes da soul exigem aprovacao humana
`;
  const sizeError = validateSoulText(soul);
  if (sizeError) throw new Error(sizeError);
  return soul;
}

/**
 * Valida uma soul escrita a mao (sem perfil). Retorna mensagem de erro ou null.
 */
export function validateSoulText(soul: string): string | null {
  const words = countWords(soul);
  if (words > MAX_SOUL_WORDS) {
    return (
      `Soul com ${words} palavras excede o limite de ${MAX_SOUL_WORDS}. ` +
      'Condense a identidade (detalhe operacional pertence a initialMemory/delegacao) ou use profileId para compor a partir de um perfil da biblioteca.'
    );
  }
  return null;
}

/** Valida memoria inicial/semeada. Retorna mensagem de erro ou null. */
export function validateSeedMemory(memory: string): string | null {
  if (memory.length > MAX_SEED_MEMORY_CHARS) {
    return (
      `Memoria inicial com ${memory.length} caracteres excede o limite de ${MAX_SEED_MEMORY_CHARS}. ` +
      'Resuma; conteudo extenso pertence a memoria profunda (saveDeepMemory) ou ao prompt de delegacao.'
    );
  }
  return null;
}
