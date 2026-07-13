import type { ModelMessage, ToolSet } from 'ai';
import { getToolEffect, type ToolEffect } from '../tools/effects.js';

export interface ToolRoutingDecision {
  requiresTool: boolean;
  activeTools: string[];
  matchedDomains: string[];
  requiredEffects: ToolEffect[];
}

const ACTION_REQUEST = /\b(crie|criar|faca|fazer|gere|gerar|escreva|salve|edite|altere|corrija|implemente|execute|rode|teste|verifique|abra|pesquise|busque|delete|apague|remova|agende|envie|publique|configure|delegue|leia|liste|revise|analise)\b/i;
const EXPLANATION_ONLY = /^\s*(?:como|por que|porque|qual|quais|o que|explique|me explique|me diga)\b/i;

const DOMAIN_TOOLS: Array<{ domain: string; pattern: RegExp; tools: string[] }> = [
  {
    domain: 'files',
    pattern: /\b(arquivo|pasta|diretorio|codigo|projeto|workspace|site|pagina|landing|html|css|javascript|typescript|readme)\b/i,
    tools: ['listFiles', 'readFile', 'writeFile', 'appendFile', 'editFile', 'deleteFile', 'runCommand'],
  },
  {
    domain: 'shell',
    pattern: /\b(comando|terminal|shell|npm|pnpm|yarn|build|typecheck|lint|testes?|git|script|processo|servidor)\b/i,
    tools: ['runCommand', 'readFile', 'listFiles'],
  },
  {
    domain: 'web',
    pattern: /\b(web|internet|site|url|pagina|documentacao|pesquis[ae]|busc[ae]|fonte|noticia)\b/i,
    tools: ['webSearch', 'readWebPage'],
  },
  {
    domain: 'agents',
    pattern: /\b(agente|worker|manager|equipe|time|subordinado|soul|perfil)\b/i,
    tools: ['listAgents', 'listSubordinates', 'listAgentProfiles', 'createAgent', 'configureAgent', 'seedAgentMemory', 'deleteAgent', 'sendMessage'],
  },
  {
    domain: 'delegation',
    pattern: /\b(delegue|delegar|distribua|paralelo|tarefas?)\b/i,
    tools: ['listTasks', 'createTask', 'updateTaskStatus', 'delegateTask', 'delegateTasks', 'deleteTask', 'clearBoard'],
  },
  {
    domain: 'skills',
    pattern: /\b(skill|habilidade|manual operacional|system prompt)\b/i,
    tools: ['listSkills', 'useSkill', 'createSkill', 'updateSkill'],
  },
  {
    domain: 'memory',
    pattern: /\b(memoria|memorize|lembre|nota diaria|notas profundas)\b/i,
    tools: ['searchVaultMemory', 'readMemory', 'saveMemory', 'readDailyNote', 'appendDailyNote', 'readDeepMemory', 'saveDeepMemory', 'recordMemoryOutcome'],
  },
  {
    domain: 'schedules',
    pattern: /\b(agendamento|agenda|cron|recorrente|todo dia|toda semana)\b/i,
    tools: ['listSchedules', 'createSchedule', 'deleteSchedule'],
  },
  {
    domain: 'conversations',
    pattern: /\b(conversa|chat|historico|mensagens anteriores)\b/i,
    tools: ['searchConversations', 'deleteConversation', 'clearConversations'],
  },
];

function messageText(message: ModelMessage): string {
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content
    .map(part => part && typeof part === 'object' && 'text' in part ? String(part.text) : '')
    .join(' ');
}

export function routeToolsForMessages(messages: ModelMessage[], tools: ToolSet): ToolRoutingDecision {
  const userText = messages
    .filter(message => message.role === 'user')
    .slice(-3)
    .map(messageText)
    .join('\n');
  const latest = messages.filter(message => message.role === 'user').slice(-1).map(messageText)[0] ?? '';
  const asksForAction = ACTION_REQUEST.test(latest) && !EXPLANATION_ONLY.test(latest);
  if (!asksForAction) return { requiresTool: false, activeTools: [], matchedDomains: [], requiredEffects: [] };

  const available = new Set(Object.keys(tools));
  const selected = new Set<string>();
  const matchedDomains: string[] = [];
  for (const domain of DOMAIN_TOOLS) {
    if (!domain.pattern.test(userText)) continue;
    matchedDomains.push(domain.domain);
    for (const name of domain.tools) {
      if (available.has(name)) selected.add(name);
    }
  }

  const requiredEffects: ToolEffect[] =
    /\b(delete|apague|remova)\b/i.test(latest) ? ['delete'] :
    /\b(execute|rode|teste|build|typecheck|lint)\b/i.test(latest) ? ['execute'] :
    /\b(envie|publique|delegue|distribua)\b/i.test(latest) ? ['communicate'] :
    /\b(configure|atualize)\b/i.test(latest) ? ['update'] :
    /\b(crie|criar|gere|gerar|escreva|salve|edite|altere|corrija|implemente|agende)\b/i.test(latest)
      ? (matchedDomains.includes('files') ? ['write', 'create', 'update'] : ['create', 'update']) :
    /\b(leia|liste|revise|analise|verifique|abra|pesquise|busque)\b/i.test(latest) ? ['read', 'execute'] :
    [...new Set([...selected].map(getToolEffect).filter(effect => effect !== 'unknown'))];

  return {
    requiresTool: selected.size > 0,
    activeTools: [...selected],
    matchedDomains,
    requiredEffects,
  };
}

export function prepareToolStep(decision: ToolRoutingDecision) {
  if (!decision.requiresTool) return undefined;
  return ({ stepNumber }: { stepNumber: number }) => ({
    activeTools: decision.activeTools,
    toolChoice: stepNumber === 0 ? 'required' as const : 'auto' as const,
  });
}
