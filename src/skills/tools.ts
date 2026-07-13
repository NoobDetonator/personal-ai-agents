import { tool } from 'ai';
import { z } from 'zod';
import {
  listSkillMetas,
  readSkillContent,
  createSkillFiles,
  updateSkillFiles,
  getSkillMeta,
  buildSkillDraft,
} from './loader.js';
import { askConfirmation } from '../chat/confirm.js';
import { auditEvent } from '../projects/data-service.js';
import { getProjectContext } from '../projects/context.js';

export const listSkillsTool = tool({
  description: 'Listar todas as skills (habilidades documentadas) disponiveis',
  inputSchema: z.object({}),
  execute: async () => {
    const skills = listSkillMetas();
    if (skills.length === 0) {
      return { skills: [], message: 'Nenhuma skill instalada ainda. Voce pode criar uma com createSkill.' };
    }
    return {
      skills: skills.map(s => ({ id: s.id, name: s.name, description: s.description })),
    };
  },
});

export const useSkillTool = tool({
  description:
    'Carregar as instrucoes completas de uma skill. SEMPRE use esta ferramenta antes de executar uma tarefa coberta por uma skill disponivel.',
  inputSchema: z.object({
    name: z.string().describe('Nome (id) da skill a carregar'),
  }),
  execute: async ({ name }) => {
    const skill = readSkillContent(name);
    if (!skill) {
      return { error: `Skill "${name}" nao encontrada. Use listSkills para ver as disponiveis.` };
    }
    return {
      id: skill.meta.id,
      instructions: skill.content,
      extraFiles: skill.files.length > 0
        ? {
            note: 'Arquivos auxiliares desta skill (leia com readFile se as instrucoes mandarem):',
            basePath: skill.meta.dir,
            files: skill.files,
          }
        : undefined,
    };
  },
});

export const createSkillTool = tool({
  description:
    'Propor e criar uma nova skill reutilizavel. O backend valida, mostra a previa completa ao usuario e so grava depois da aprovacao humana.',
  inputSchema: z.object({
    id: z.string().min(1).max(80).describe('Identificador em kebab-case (ex: "gerar-relatorio-semanal")'),
    description: z.string().min(8).max(240).describe('Uma unica frase dizendo O QUE a skill faz e QUANDO usa-la'),
    instructions: z.string().min(40).max(20_000).describe('Corpo completo da skill em Markdown: passos, exemplos, verificacao e cuidados'),
  }),
  execute: async ({ id, description, instructions }) => {
    try {
      const draft = buildSkillDraft(id, id, description, instructions);
      if (getSkillMeta(draft.id)) {
        return { error: `Skill "${draft.id}" ja existe. Use updateSkill para melhora-la.` };
      }
      const preview = draft.instructions.length > 1800
        ? `${draft.instructions.slice(0, 1800)}\n...[previa truncada]`
        : draft.instructions;
      const confirmation = await askConfirmation(
        [
          `Criar a skill GLOBAL persistente "${draft.id}"?`,
          `Descricao: ${draft.description}`,
          `SHA-256 proposto: ${draft.sha256}`,
          'Previa das instrucoes:',
          preview,
        ].join('\n'),
        { allowAlways: false },
      );
      if (confirmation.answer !== 'yes') {
        return { error: confirmation.timedOut
          ? 'Confirmacao expirou. A skill nao foi criada.'
          : 'Criacao da skill negada pelo usuario.' };
      }

      const meta = createSkillFiles(draft.id, draft.name, draft.description, draft.instructions);
      try {
        auditEvent(getProjectContext()?.projectId ?? null, 'skill.create', 'skill', meta.id, {
          scope: 'global',
          sha256: draft.sha256,
        });
      } catch { /* auditoria indisponivel nao invalida a escrita concluida */ }
      return { success: true, id: meta.id, path: meta.filePath, sha256: draft.sha256, scope: 'global' };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Erro ao criar skill' };
    }
  },
});

export const updateSkillTool = tool({
  description:
    'Propor a reescrita completa de uma skill existente. Skills protegidas sao imutaveis; skills comuns exibem previa e hash antes da aprovacao.',
  inputSchema: z.object({
    name: z.string().min(1).max(80).describe('Nome (id) da skill a melhorar'),
    instructions: z.string().min(40).max(20_000).describe('Novo corpo completo da skill em Markdown'),
    description: z.string().min(8).max(240).optional().describe('Nova descricao de uma unica frase (opcional)'),
  }),
  execute: async ({ name, instructions, description }) => {
    try {
      const existing = getSkillMeta(name);
      if (!existing) return { error: `Skill "${name}" nao encontrada.` };
      if (existing.protected) {
        return { error: `Skill "${existing.id}" e interna e protegida contra alteracao.` };
      }

      const draft = buildSkillDraft(
        existing.id,
        existing.name,
        description ?? existing.description,
        instructions,
      );
      const preview = draft.instructions.length > 1800
        ? `${draft.instructions.slice(0, 1800)}\n...[previa truncada]`
        : draft.instructions;
      const result = await askConfirmation(
        [
          `Reescrever a skill GLOBAL "${existing.id}"?`,
          `Descricao proposta: ${draft.description}`,
          `Novo SHA-256: ${draft.sha256}`,
          'Previa das novas instrucoes:',
          preview,
          'A versao anterior sera arquivada localmente antes da troca.',
        ].join('\n'),
        { allowAlways: false },
      );
      if (result.answer !== 'yes') {
        return { error: result.timedOut
          ? 'Confirmacao expirou. A skill nao foi alterada.'
          : 'Alteracao da skill negada pelo usuario.' };
      }

      const meta = updateSkillFiles(existing.id, {
        instructions: draft.instructions,
        description: draft.description,
      });
      try {
        auditEvent(getProjectContext()?.projectId ?? null, 'skill.update', 'skill', meta.id, {
          scope: 'global',
          sha256: draft.sha256,
          previousVersionArchived: true,
        });
      } catch { /* auditoria indisponivel nao invalida a escrita concluida */ }
      return { success: true, id: meta.id, path: meta.filePath, sha256: draft.sha256, scope: 'global' };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Erro ao atualizar skill' };
    }
  },
});
