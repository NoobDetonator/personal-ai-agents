import { tool } from 'ai';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import type { Agent } from '../agents/agent.js';
import * as registry from '../agents/registry.js';
import { getAgentDir, writeMemory, readSoul } from '../agents/personality.js';
import { getConfig, updateAgentInConfig } from '../config/loader.js';
import {
  composeSoul,
  listProfiles,
  validateSoulText,
  validateSeedMemory,
} from '../agents/prompt-composer.js';

/**
 * Tools de gestao de agentes. `creatorId` e o agente dono do toolset —
 * usado para definir parent/team dos criados e validar hierarquia.
 */
export function createAgentManagementTools(creatorId: string, onAgentCreated?: (agent: Agent) => void) {
  const createAgentTool = tool({
    description:
      'Criar um novo agente subordinado a voce. PREFIRA profileId (veja listAgentProfiles): a soul e composta automaticamente a partir do perfil, e "personality" vira a funcao especifica (1-2 frases). Sem profileId, "personality" e a soul completa — CONCISA (max ~150 palavras). Use team para agrupar agentes do mesmo projeto.',
    inputSchema: z.object({
      name: z.string().describe('Nome do agente (ex: "roteirista1"). Minusculas, sem espacos.'),
      profileId: z.string().optional().describe('Perfil da biblioteca (ex: "programador", "pesquisador", "revisor-codigo" — liste com listAgentProfiles). Compoe a soul automaticamente.'),
      personality: z.string().optional().describe('Com profileId: funcao especifica deste agente em 1-2 frases. Sem profileId: personalidade completa (vira o soul.md, max ~150 palavras).'),
      description: z.string().optional().describe('Descricao de uma linha (aparece nas listagens)'),
      team: z.string().optional().describe('Equipe do agente (ex: "roteiristas"). Se omitido, herda a sua.'),
      role: z.enum(['manager', 'worker']).optional().describe('Papel: "manager" lidera uma equipe (so a principal pode criar managers). Padrao: worker.'),
      temporary: z.boolean().optional().describe('true para agente temporario (descartavel apos a tarefa)'),
      fastMode: z.boolean().optional().describe('true = agente rapido sem thinking mode (DeepSeek): responde muito mais rapido e custa menos. Recomendado para workers de execucao direta; deixe false so para tarefas que exigem raciocinio profundo.'),
      initialMemory: z.string().optional().describe('Memoria inicial para condicionar o agente (contexto do projeto, instrucoes)'),
    }),
    execute: async ({ name, profileId, personality, description, team, role, temporary, fastMode, initialMemory }) => {
      try {
        const creatorCfg = getConfig().agents[creatorId];
        const creatorRole = creatorCfg?.role ?? 'worker';

        let finalRole: 'manager' | 'worker' = 'worker';
        if (role === 'manager') {
          if (creatorRole !== 'principal') {
            return { error: 'Apenas a agente principal pode criar managers.' };
          }
          finalRole = 'manager';
        }

        const finalTeam = team ?? creatorCfg?.team ?? null;
        const displayName = name.charAt(0).toUpperCase() + name.slice(1);

        let customSoul: string | undefined;
        if (profileId) {
          // Composicao deterministica: perfil da biblioteca + funcao curta
          customSoul = composeSoul({
            profileId,
            agentName: displayName,
            team: finalTeam,
            temporary,
            mission: personality,
          });
        } else if (personality) {
          const sizeError = validateSoulText(personality);
          if (sizeError) return { error: sizeError };
          customSoul = `# Personalidade\n\n${personality}\n\n## Comportamento\n- Seja objetivo e execute o que seu superior pedir, reportando resultados reais\n- Use suas ferramentas de verdade — nunca invente resultados\n- Salve aprendizados na sua memoria e melhore sua soul quando perceber necessidade\n`;
        }

        if (initialMemory) {
          const memError = validateSeedMemory(initialMemory);
          if (memError) return { error: memError };
        }

        const agent = registry.createAgent(name, {
          soul: customSoul,
          description,
          role: finalRole,
          parent: creatorId,
          team: finalTeam,
          temporary,
          thinking: fastMode ? false : undefined,
          profile: profileId ?? null,
        });

        if (initialMemory) {
          writeMemory(agent.id, `# Memoria\n\n## Contexto Inicial\n${initialMemory}\n\n## Notas Importantes\n- (Nada registrado ainda)\n`);
        }

        if (onAgentCreated) {
          onAgentCreated(agent);
        }
        return {
          success: true,
          message: `Agente "${agent.name}" (${agent.id}) criado como ${finalRole}, subordinado a ${creatorId}${profileId ? `, com perfil "${profileId}"` : ''}.`,
          id: agent.id,
          team: finalTeam,
          profile: profileId ?? null,
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Erro ao criar agente' };
      }
    },
  });

  const configureAgentTool = tool({
    description:
      'Reescrever a personalidade (soul.md) de um agente SUBORDINADO a voce. Passe profileId para compor a partir de um perfil da biblioteca (com "mission" opcional), OU newSoul com o texto completo (conciso, max ~150 palavras).',
    inputSchema: z.object({
      agentId: z.string().describe('ID do agente subordinado'),
      profileId: z.string().optional().describe('Perfil da biblioteca para compor a soul (veja listAgentProfiles)'),
      mission: z.string().optional().describe('Com profileId: funcao especifica em 1-2 frases'),
      newSoul: z.string().optional().describe('Sem profileId: novo conteudo completo do soul.md'),
    }),
    execute: async ({ agentId, profileId, mission, newSoul }) => {
      if (!registry.agentExists(agentId)) {
        return { error: `Agente "${agentId}" nao encontrado.` };
      }
      if (!registry.isSuperiorOf(creatorId, agentId)) {
        return { error: 'Voce so pode configurar agentes abaixo de voce na hierarquia.' };
      }

      const cfg = getConfig().agents[agentId];
      let soul: string;
      try {
        if (profileId) {
          soul = composeSoul({
            profileId,
            agentName: cfg?.name ?? agentId,
            team: cfg?.team ?? null,
            temporary: cfg?.temporary,
            mission,
          });
        } else if (newSoul) {
          const sizeError = validateSoulText(newSoul);
          if (sizeError) return { error: sizeError };
          soul = newSoul;
        } else {
          return { error: 'Informe profileId (com mission opcional) ou newSoul.' };
        }
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Erro ao compor soul' };
      }

      fs.writeFileSync(path.join(getAgentDir(agentId), 'soul.md'), soul, 'utf-8');
      if (cfg) {
        updateAgentInConfig(agentId, { ...cfg, profile: profileId ?? null });
      }
      return {
        success: true,
        message: `Soul de "${agentId}" atualizado${profileId ? ` com o perfil "${profileId}"` : ''}.`,
      };
    },
  });

  const listAgentProfilesTool = tool({
    description:
      'Listar os perfis da biblioteca disponiveis para createAgent/configureAgent (profileId), com o resumo de cada papel.',
    inputSchema: z.object({}),
    execute: async () => ({
      perfis: listProfiles().map(p => ({ id: p.id, papel: p.title, resumo: p.summary })),
      dica: 'Use profileId no createAgent e descreva a funcao especifica em "personality" (1-2 frases). Manual completo de cada perfil via readFile no arquivo em skills/system-prompter/perfis/.',
    }),
  });

  const seedAgentMemoryTool = tool({
    description:
      'Semear/substituir a memoria (memory.md) de um agente SUBORDINADO com contexto inicial do trabalho.',
    inputSchema: z.object({
      agentId: z.string().describe('ID do agente subordinado'),
      memory: z.string().describe('Conteudo da memoria inicial (contexto, objetivos, instrucoes do projeto)'),
    }),
    execute: async ({ agentId, memory }) => {
      if (!registry.agentExists(agentId)) {
        return { error: `Agente "${agentId}" nao encontrado.` };
      }
      if (!registry.isSuperiorOf(creatorId, agentId)) {
        return { error: 'Voce so pode configurar agentes abaixo de voce na hierarquia.' };
      }
      const memError = validateSeedMemory(memory);
      if (memError) return { error: memError };
      writeMemory(agentId, `# Memoria\n\n## Contexto do Trabalho\n${memory}\n\n## Notas Importantes\n- (Nada registrado ainda)\n`);
      return { success: true, message: `Memoria de "${agentId}" semeada.` };
    },
  });

  const listSubordinatesTool = tool({
    description: 'Listar seus subordinados diretos (e as equipes deles)',
    inputSchema: z.object({}),
    execute: async () => {
      const config = getConfig();
      const subs = registry.getDirectSubordinates(creatorId).map(id => ({
        id,
        name: config.agents[id]?.name ?? id,
        role: config.agents[id]?.role ?? 'worker',
        team: config.agents[id]?.team ?? null,
        temporary: config.agents[id]?.temporary ?? false,
        soulResumo: readSoul(id).slice(0, 150),
      }));
      return { subordinados: subs };
    },
  });

  const deleteAgentTool = tool({
    description:
      'Deletar um agente SUBORDINADO a voce (use para limpar agentes temporarios apos o trabalho). Remove os arquivos permanentemente.',
    inputSchema: z.object({
      agentId: z.string().describe('ID do agente a deletar'),
    }),
    execute: async ({ agentId }) => {
      try {
        registry.deleteAgent(agentId, creatorId);
        return { success: true, message: `Agente "${agentId}" deletado.` };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Erro ao deletar' };
      }
    },
  });

  return {
    createAgent: createAgentTool,
    configureAgent: configureAgentTool,
    seedAgentMemory: seedAgentMemoryTool,
    listSubordinates: listSubordinatesTool,
    listAgentProfiles: listAgentProfilesTool,
    deleteAgent: deleteAgentTool,
  };
}

export const listAgentsTool = tool({
  description: 'Listar todos os agentes do sistema com papel, equipe e hierarquia',
  inputSchema: z.object({}),
  execute: async () => {
    const config = getConfig();
    const agents = registry.listAgents();
    return {
      agents: agents.map(a => {
        const cfg = config.agents[a.id];
        return {
          id: a.id,
          name: a.name,
          description: a.description,
          role: cfg?.role ?? 'worker',
          parent: cfg?.parent ?? null,
          team: cfg?.team ?? null,
          temporary: cfg?.temporary ?? false,
        };
      }),
    };
  },
});
