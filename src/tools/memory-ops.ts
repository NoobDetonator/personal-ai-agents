import { tool } from 'ai';
import { z } from 'zod';
import { readSoul } from '../agents/personality.js';
import {
  appendScopedDailyNote,
  appendScopedMemorySection,
  readScopedDailyNote,
  readScopedDeepMemory,
  readScopedMemory,
  saveScopedDeepMemory,
} from '../projects/agent-memory.js';
import { getProjectContext } from '../projects/context.js';
import { summarizeMemoryIfNeeded } from '../agents/memory-summarizer.js';
import { appendToUserProfile, PROFILE_SECTIONS } from '../agents/user-profile.js';
import { getConfig, updateAgentInConfig, updateConfig } from '../config/loader.js';
import { validateSoulText } from '../agents/prompt-composer.js';
import { askConfirmation } from '../chat/confirm.js';
import { recordMemoryFeedback, searchProjectVault } from '../memory/vault-service.js';

function normalizeLiteralCandidate(value: string): string {
  return value
    .trim()
    .replace(/^[`*_>'"“”‘’\s]+|[`*_<'"“”‘’\s]+$/gu, '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR');
}

/** Retorna sempre o texto humano original, nunca a versao reescrita pelo modelo. */
export function matchUserLiteral(userText: string, proposed: string): string | null {
  const trimmed = proposed.trim();
  if (trimmed && userText.includes(trimmed)) return trimmed;
  const normalized = normalizeLiteralCandidate(trimmed);
  if (!normalized) return null;
  const quoted = [...userText.matchAll(/["“]([^"”]{3,})["”]/gu)].map(match => match[1].trim());
  return quoted.find(candidate => normalizeLiteralCandidate(candidate) === normalized) ?? null;
}

export function createMemoryTools(agentId: string) {
  const readMemoryTool = tool({
    description: 'Ler seu arquivo de memoria para lembrar de informacoes passadas',
    inputSchema: z.object({}),
    execute: async () => {
      const memory = readScopedMemory(agentId);
      return { memory: memory || '(Memoria vazia)' };
    },
  });

  const saveMemoryTool = tool({
    description: 'Salvar uma informacao importante na sua memoria para lembrar depois',
    inputSchema: z.object({
      section: z.enum(['Sobre o Usuario', 'Preferencias', 'Notas Importantes'])
        .describe('Em qual secao salvar a informacao'),
      content: z.string().describe('O que lembrar (uma frase curta e clara)'),
    }),
    execute: async ({ section, content }) => {
      appendScopedMemorySection(agentId, section, content);
      // Fire-and-forget: summarize if memory exceeds threshold
      if (!getProjectContext()) summarizeMemoryIfNeeded(agentId).catch(() => {});
      return { success: true, message: `Salvo em "${section}": ${content}` };
    },
  });

  const readSoulTool = tool({
    description: 'Ler seu arquivo de personalidade (soul)',
    inputSchema: z.object({}),
    execute: async () => {
      const soul = readSoul(agentId);
      return { soul: soul || '(Sem personalidade definida)' };
    },
  });

  const editSoulTool = tool({
    description: 'Propor uma edicao manual da propria soul. Exige aprovacao humana, respeita o limite final e remove a proveniencia de perfil.',
    inputSchema: z.object({
      newContent: z.string().describe('Novo conteudo completo do arquivo de personalidade (soul.md)'),
    }),
    execute: async ({ newContent }) => {
      const sizeError = validateSoulText(newContent);
      if (sizeError) return { error: sizeError };

      const confirmation = await askConfirmation(
        `O agente "${agentId}" quer reescrever a propria soul e remover o perfil gerenciado. Permitir?`,
        { allowAlways: false },
      );
      if (confirmation.answer !== 'yes') {
        return { error: 'Edicao da soul negada pelo usuario.' };
      }

      const { writeFileSync } = await import('node:fs');
      const { join, resolve } = await import('node:path');
      const soulPath = resolve(join(process.cwd(), 'agents', agentId, 'soul.md'));
      writeFileSync(soulPath, newContent, 'utf-8');
      const cfg = getConfig().agents[agentId];
      if (cfg) {
        updateAgentInConfig(agentId, { ...cfg, profile: null, profileRevision: null });
      }
      return { success: true, message: 'Personalidade atualizada manualmente; perfil gerenciado removido.' };
    },
  });

  const appendDailyNoteTool = tool({
    description:
      'Registrar um acontecimento na sua nota diaria (diario de bordo). Use para eventos, tarefas concluidas e contexto do dia — diferente da memoria de longo prazo (saveMemory).',
    inputSchema: z.object({
      content: z.string().describe('O que registrar (uma frase objetiva)'),
    }),
    execute: async ({ content }) => {
      appendScopedDailyNote(agentId, content);
      return { success: true };
    },
  });

  const readDailyNoteTool = tool({
    description: 'Ler uma nota diaria sua (a de hoje ou de uma data especifica)',
    inputSchema: z.object({
      date: z.string().optional().describe('Data no formato YYYY-MM-DD (padrao: hoje)'),
    }),
    execute: async ({ date }) => {
      const note = readScopedDailyNote(agentId, date);
      return { note: note || '(Sem nota para essa data)' };
    },
  });

  const updateUserProfileTool = tool({
    description:
      'Registrar um fato sobre o USUARIO no perfil compartilhado (USER.md), visivel para todos os agentes. Use para identidade, trabalho, gostos e preferencias do usuario — nao para fatos do seu proprio trabalho (esses vao na sua memoria).',
    inputSchema: z.object({
      section: z.enum(PROFILE_SECTIONS).describe('Secao do perfil'),
      content: z.string().describe('O fato, em uma frase curta e clara'),
    }),
    execute: async ({ section, content }) => {
      appendToUserProfile(section, content);
      return { success: true, message: `Perfil atualizado em "${section}".` };
    },
  });

  const finishOnboardingTool = tool({
    description:
      'Concluir o onboarding do usuario (quando voce ja coletou o essencial do perfil, ou quando ele pedir para pular a entrevista).',
    inputSchema: z.object({}),
    execute: async () => {
      const config = getConfig();
      if (config.agents[agentId]?.role !== 'principal') {
        return { error: 'Apenas a agente principal conclui o onboarding.' };
      }
      updateConfig({ user: { onboarded: true } });
      return { success: true, message: 'Onboarding concluido! Perfil do usuario registrado.' };
    },
  });

  const saveDeepMemoryTool = tool({
    description:
      'Salvar uma MEMORIA PROFUNDA. Quando o usuario ditar uma regra, preferencia ou convencao neste turno, use sourceType="user" e copie somente o trecho literal em verbatimExcerpt; o backend preservara esse texto sem acrescentar inferencias. Conteudo sintetizado pelo agente deve usar outra origem.',
    inputSchema: z.object({
      slug: z.string().describe('Identificador kebab-case (ex: "projeto-analyzai-contexto")'),
      description: z.string().describe('Uma frase dizendo o que contem e quando e util (usada para decidir a recuperacao)'),
      content: z.string().describe('O conteudo completo da memoria em Markdown'),
      noteType: z.enum(['memory', 'decision', 'preference', 'lesson', 'project', 'procedure', 'reference']).optional()
        .describe('Tipo semantico da nota'),
      status: z.enum(['active', 'tentative']).optional()
        .describe('Use tentative quando o conteudo ainda nao foi confirmado'),
      confidence: z.number().min(0).max(1).optional(),
      sourceType: z.enum(['user', 'agent', 'observation', 'tool_result', 'imported']).optional()
        .describe('Use user exclusivamente para conteudo ditado diretamente na mensagem humana atual'),
      verbatimExcerpt: z.string().optional()
        .describe('Trecho literal da mensagem atual. Obrigatorio quando sourceType=user; vira o conteudo canonico sem expansoes.'),
      tags: z.array(z.string()).max(12).optional(),
      aliases: z.array(z.string()).max(8).optional(),
      links: z.array(z.string()).max(20).optional()
        .describe('Titulos de outras notas relacionadas; geram wikilinks no grafo'),
      implementedBy: z.array(z.string()).max(20).optional()
        .describe('Caminhos relativos de arquivos que implementam esta memoria ou decisao'),
    }),
    execute: async ({ slug, description, content, noteType, status, confidence, sourceType, verbatimExcerpt, tags, aliases, links, implementedBy }) => {
      try {
        const currentUserText = getProjectContext()?.userMessage ?? '';
        const directMemoryRequest = /\b(salv|guard|registr|lembr|mem[oó]ria)\w*/iu.test(currentUserText);
        if (directMemoryRequest && sourceType !== 'user') {
          return { error: 'Esta memoria foi ditada pelo usuario. Tente novamente com sourceType="user" e verbatimExcerpt copiado literalmente da mensagem atual.' };
        }
        let canonicalContent = content;
        if (sourceType === 'user') {
          const excerpt = verbatimExcerpt ? matchUserLiteral(currentUserText, verbatimExcerpt) : null;
          if (!excerpt) {
            return { error: 'verbatimExcerpt deve ser um trecho literal e completo da mensagem humana atual.' };
          }
          canonicalContent = excerpt;
        }
        const saved = saveScopedDeepMemory(agentId, slug, description, canonicalContent, {
          noteType, status, confidence, sourceType, tags, aliases, links, implementedBy,
        });
        return { success: true, slug: saved };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Erro ao salvar memoria' };
      }
    },
  });

  const readDeepMemoryTool = tool({
    description: 'Ler uma memoria profunda especifica pelo slug',
    inputSchema: z.object({
      slug: z.string().describe('Slug da memoria'),
    }),
    execute: async ({ slug }) => {
      const content = readScopedDeepMemory(agentId, slug);
      return content ? { content } : { error: `Memoria "${slug}" nao encontrada.` };
    },
  });

  const searchVaultMemoryTool = tool({
    description:
      'Buscar primeiro no Aria Vault por memorias e decisoes relevantes do projeto. Retorna somente trechos e metadados, com origem e confianca.',
    inputSchema: z.object({
      query: z.string().default('').describe('Palavras ou pergunta de busca'),
      status: z.enum(['active', 'tentative', 'contested', 'superseded', 'stale', 'needs_review']).optional(),
      noteType: z.string().optional(),
      limit: z.number().int().min(1).max(20).default(8),
    }),
    execute: async ({ query, status, noteType, limit }) => {
      try {
        const projectId = getProjectContext()?.projectId ?? 'legacy';
        const role = getConfig().agents[agentId]?.role ?? 'worker';
        const results = searchProjectVault(projectId, query, {
          status,
          type: noteType,
          limit,
          agentId: role === 'worker' ? agentId : undefined,
        });
        return { results, count: results.length, authority: 'data-only' };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Falha ao buscar no Vault' };
      }
    },
  });

  const recordMemoryOutcomeTool = tool({
    description:
      'Registrar se uma memoria ou estrategia recuperada foi util, levou a um beco sem saida ou precisou de correcao. Nao promove fatos automaticamente.',
    inputSchema: z.object({
      question: z.string().describe('Pergunta, tarefa ou hipotese avaliada'),
      outcome: z.enum(['useful', 'dead_end', 'corrected']),
      memoryId: z.string().optional().describe('ID do documento retornado por searchVaultMemory'),
      answer: z.string().optional(),
      notes: z.string().optional(),
    }),
    execute: async ({ question, outcome, memoryId, answer, notes }) => {
      try {
        const projectId = getProjectContext()?.projectId ?? 'legacy';
        const id = recordMemoryFeedback({
          projectId, memoryId, agentId, question, outcome, answer, notes,
        });
        return { success: true, id };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Falha ao registrar resultado' };
      }
    },
  });

  return {
    readMemory: readMemoryTool,
    saveMemory: saveMemoryTool,
    readSoul: readSoulTool,
    editSoul: editSoulTool,
    appendDailyNote: appendDailyNoteTool,
    readDailyNote: readDailyNoteTool,
    saveDeepMemory: saveDeepMemoryTool,
    readDeepMemory: readDeepMemoryTool,
    searchVaultMemory: searchVaultMemoryTool,
    recordMemoryOutcome: recordMemoryOutcomeTool,
    updateUserProfile: updateUserProfileTool,
    finishOnboarding: finishOnboardingTool,
  };
}
