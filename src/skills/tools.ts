import { tool } from 'ai';
import { z } from 'zod';
import {
  listSkillMetas,
  readSkillContent,
  createSkillFiles,
  updateSkillFiles,
  getSkillMeta,
} from './loader.js';
import { askConfirmation } from '../chat/confirm.js';

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
    'Criar uma nova skill reutilizavel. Use apos dominar uma tarefa complexa ou repetivel, para que voce (e outros agentes) executem melhor da proxima vez. Escreva instrucoes passo a passo, claras e acionaveis.',
  inputSchema: z.object({
    id: z.string().describe('Identificador curto em kebab-case (ex: "gerar-relatorio-semanal")'),
    description: z
      .string()
      .describe('Uma frase dizendo O QUE a skill faz e QUANDO usa-la (usado para decidir quando carrega-la)'),
    instructions: z.string().describe('Corpo da skill em Markdown: passos, exemplos, cuidados'),
  }),
  execute: async ({ id, description, instructions }) => {
    const confirmation = await askConfirmation(
      `A agente principal quer criar a skill persistente "${id}". Permitir?`,
      { allowAlways: false },
    );
    if (confirmation.answer !== 'yes') {
      return { error: 'Criacao da skill negada pelo usuario.' };
    }

    try {
      const meta = createSkillFiles(id, id, description, instructions);
      return { success: true, id: meta.id, path: meta.filePath };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Erro ao criar skill' };
    }
  },
});

export const updateSkillTool = tool({
  description:
    'Melhorar uma skill existente com o que voce aprendeu usando ela (corrigir passos, adicionar exemplos ou casos especiais). Substitui o corpo de instrucoes.',
  inputSchema: z.object({
    name: z.string().describe('Nome (id) da skill a melhorar'),
    instructions: z.string().describe('Novo corpo completo da skill em Markdown'),
    description: z.string().optional().describe('Nova descricao de uma frase (opcional)'),
  }),
  execute: async ({ name, instructions, description }) => {
    try {
      const existing = getSkillMeta(name);
      if (existing && !existing.protected) {
        // Skills condicionam o comportamento de TODOS os agentes futuros;
        // alteracao permanente exige aprovacao humana, sem "sempre permitir"
        const result = await askConfirmation(
          `Um agente quer reescrever a skill "${existing.id}". Permitir?`,
          { allowAlways: false },
        );
        if (result.answer !== 'yes') {
          return { error: 'Alteracao da skill negada pelo usuario.' };
        }
      }
      const meta = updateSkillFiles(name, { instructions, description });
      return { success: true, id: meta.id, path: meta.filePath };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Erro ao atualizar skill' };
    }
  },
});
