import type { ChatContext } from './cli.js';
import * as registry from '../agents/registry.js';
import { getConfig, getConfigPath, updateConfig } from '../config/loader.js';
import { refreshScheduler } from '../scheduler/engine.js';
import { getAvailableModels, findModel, getProviderLabel } from '../config/models.js';
import * as renderer from './renderer.js';
import { startGroupChat, stopGroupChat } from './group-chat.js';
import {
  loadLastConversation,
  getOrCreateConversation,
  createNewConversation,
  listConversations,
  findConversationByPrefix,
  loadConversationById,
  forkConversation,
} from '../db/conversation-helpers.js';
import { listSkillMetas, readSkillContent, getSkillsDir } from '../skills/loader.js';

export interface Command {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  execute: (args: string[], ctx: ChatContext) => Promise<void>;
}

export const commands: Command[] = [
  {
    name: '/ajuda',
    aliases: ['/help', '/h'],
    description: 'Mostra todos os comandos disponiveis',
    usage: '/ajuda',
    execute: async () => {
      renderer.renderHelp(
        commands.map(c => ({ name: `${c.usage}`, description: c.description }))
      );
    },
  },
  {
    name: '/agentes',
    aliases: ['/agents'],
    description: 'Lista todas as IAs disponiveis',
    usage: '/agentes',
    execute: async (_args, ctx) => {
      const agents = registry.listAgents();
      renderer.renderAgentList(
        agents.map(a => ({
          id: a.id,
          name: a.name,
          description: a.description,
          active: a.id === ctx.activeAgent.id,
        }))
      );
    },
  },
  {
    name: '/agente',
    aliases: ['/agent', '/a'],
    description: 'Muda para conversar com outra IA',
    usage: '/agente <nome>',
    execute: async (args, ctx) => {
      if (args.length === 0) {
        renderer.renderError('Informe o nome do agente. Ex: /agente luna');
        return;
      }
      const agentId = args[0].toLowerCase();
      const agent = registry.getAgent(agentId);
      if (!agent) {
        renderer.renderError(`Agente "${agentId}" nao encontrado. Use /agentes para ver a lista.`);
        return;
      }
      ctx.buildToolsForAgent(agent);
      ctx.activeAgent = agent;
      const config = getConfig();
      const { conversationId, messages } = loadLastConversation(
        agentId,
        config.display.maxHistoryMessages
      );
      ctx.messageHistory = messages;
      ctx.conversationId = conversationId ?? getOrCreateConversation(agentId);
      if (messages.length > 0) {
        renderer.renderSuccess(`Agora conversando com ${agent.name}! (${messages.length} mensagens restauradas)`);
      } else {
        renderer.renderSuccess(`Agora conversando com ${agent.name}!`);
      }
    },
  },
  {
    name: '/novo',
    aliases: ['/new', '/criar'],
    description: 'Cria uma nova IA',
    usage: '/novo <nome>',
    execute: async (args, ctx) => {
      if (args.length === 0) {
        renderer.renderError('Informe o nome da nova IA. Ex: /novo luna');
        return;
      }
      const name = args[0];
      try {
        const agent = registry.createAgent(name);
        ctx.buildToolsForAgent(agent);
        renderer.renderSuccess(`Agente "${agent.name}" criado! Use /agente ${agent.id} para conversar.`);
      } catch (error) {
        renderer.renderError(error instanceof Error ? error.message : 'Erro ao criar agente');
      }
    },
  },
  {
    name: '/deletar',
    aliases: ['/delete', '/del'],
    description: 'Deleta uma IA (com confirmacao)',
    usage: '/deletar <nome>',
    execute: async (args, ctx) => {
      if (args.length === 0) {
        renderer.renderError('Informe o ID do agente. Ex: /deletar luna');
        return;
      }
      const agentId = args[0].toLowerCase();
      try {
        registry.deleteAgent(agentId);
        if (ctx.activeAgent.id === agentId) {
          ctx.activeAgent = registry.getAgent('aria')!;
          ctx.messageHistory = [];
          ctx.conversationId = getOrCreateConversation('aria');
        }
        renderer.renderSuccess(`Agente "${agentId}" deletado.`);
      } catch (error) {
        renderer.renderError(error instanceof Error ? error.message : 'Erro ao deletar');
      }
    },
  },
  {
    name: '/grupo',
    aliases: ['/group', '/g'],
    description: 'Inicia chat em grupo com multiplas IAs',
    usage: '/grupo <ia1> <ia2> ...',
    execute: async (args, ctx) => {
      if (args.length < 2) {
        renderer.renderError('Informe pelo menos 2 agentes. Ex: /grupo aria luna');
        return;
      }
      const agents = args.map(a => registry.getAgent(a.toLowerCase())).filter(Boolean) as import('../agents/agent.js').Agent[];
      if (agents.length < 2) {
        renderer.renderError('Pelo menos 2 agentes validos sao necessarios.');
        return;
      }
      startGroupChat(ctx, agents);
    },
  },
  {
    name: '/sair-grupo',
    aliases: ['/leave-group', '/sg'],
    description: 'Sai do chat em grupo',
    usage: '/sair-grupo',
    execute: async (_args, ctx) => {
      stopGroupChat(ctx);
    },
  },
  {
    name: '/rodadas',
    aliases: ['/rounds', '/r'],
    description: 'Define numero de rodadas do grupo (1-10)',
    usage: '/rodadas <numero>',
    execute: async (args, ctx) => {
      if (!ctx.groupChat) {
        renderer.renderError('Voce nao esta em um chat de grupo. Use /grupo primeiro.');
        return;
      }
      if (args.length === 0) {
        renderer.renderSystemMessage(`Rodadas atuais: ${ctx.groupChat.config.maxRounds}`);
        return;
      }
      const n = parseInt(args[0], 10);
      if (isNaN(n) || n < 1 || n > 10) {
        renderer.renderError('Numero invalido. Use entre 1 e 10.');
        return;
      }
      ctx.groupChat.config.maxRounds = n;
      renderer.renderSuccess(`Rodadas configuradas para ${n}.`);
    },
  },
  {
    name: '/empresa',
    aliases: ['/orq', '/company'],
    description: 'Da um objetivo a agente principal, que monta um time e executa',
    usage: '/empresa <objetivo>',
    execute: async (args, ctx) => {
      if (args.length === 0) {
        renderer.renderError('Descreva o objetivo. Ex: /empresa pesquise sobre X e escreva um relatorio em workspace/relatorio.md');
        return;
      }
      const principal = registry.getAgent(registry.PRINCIPAL_ID);
      if (!principal) {
        renderer.renderError('Agente principal nao encontrado. Reinicie o sistema.');
        return;
      }
      if (ctx.groupChat) {
        renderer.renderError('Saia do chat em grupo primeiro (/sair-grupo).');
        return;
      }

      const objective = args.join(' ');

      if (ctx.activeAgent.id !== principal.id) {
        ctx.buildToolsForAgent(principal);
        ctx.activeAgent = principal;
        const config = getConfig();
        const { conversationId, messages } = loadLastConversation(principal.id, config.display.maxHistoryMessages);
        ctx.messageHistory = messages;
        ctx.conversationId = conversationId ?? getOrCreateConversation(principal.id);
      }

      renderer.renderSystemMessage(`${principal.name} assumiu. Planejando e montando o time...`);
      const { route } = await import('./router.js');
      await route(`[OBJETIVO]\n${objective}`, ctx);
    },
  },
  {
    name: '/board',
    aliases: ['/tarefas-empresa'],
    description: 'Mostra o board de tarefas (opcional: filtrar por equipe)',
    usage: '/board [equipe]',
    execute: async (args) => {
      const { listTaskRows } = await import('../tools/tasks.js');
      const team = args[0]?.toLowerCase();
      const tasks = listTaskRows(undefined, team);
      if (tasks.length === 0) {
        renderer.renderSystemMessage(team ? `Nenhuma tarefa na equipe "${team}".` : 'Board vazio. Use /empresa <objetivo> para gerar tarefas.');
        return;
      }
      const icons: Record<string, string> = { pending: '○', in_progress: '◐', done: '✓', failed: '✗', cancelled: '⊘' };
      console.log('');
      let lastTeam: string | null | undefined;
      for (const t of tasks) {
        if (t.team !== lastTeam) {
          console.log(`  --- equipe: ${t.team ?? '(geral)'} ---`);
          lastTeam = t.team;
        }
        const icon = icons[t.status] ?? '?';
        const assignee = t.assignee ? ` @${t.assignee}` : '';
        console.log(`  ${icon} [${t.id}] ${t.title}${assignee} (${t.status})`);
      }
      console.log('');
    },
  },
  {
    name: '/equipes',
    aliases: ['/teams'],
    description: 'Lista as equipes, seus agentes e tarefas abertas',
    usage: '/equipes',
    execute: async () => {
      const { listTaskRows } = await import('../tools/tasks.js');
      const config = getConfig();
      const teams = registry.listTeams();
      if (teams.length === 0) {
        renderer.renderSystemMessage('Nenhuma equipe ainda. Peca para a Aria criar agentes com uma equipe (ex: "crie 3 roteiristas na equipe historias").');
        return;
      }
      console.log('');
      for (const team of teams) {
        const members = registry.getTeamMembers(team).map(id => config.agents[id]?.name ?? id);
        const open = listTaskRows(undefined, team).filter(t => t.status === 'pending' || t.status === 'in_progress').length;
        console.log(`  ${team}: ${members.join(', ')} — ${open} tarefa(s) aberta(s) | workspace/${team}/`);
      }
      console.log('');
    },
  },
  {
    name: '/tarefas',
    aliases: ['/tasks', '/t'],
    description: 'Lista tarefas agendadas',
    usage: '/tarefas',
    execute: async () => {
      const { getDb } = await import('../db/connection.js');
      const db = getDb();
      const schedules = db.prepare(
        'SELECT id, agent_id, cron_expr, task_prompt, enabled, last_run FROM schedules ORDER BY created_at DESC'
      ).all() as Array<{ id: string; agent_id: string; cron_expr: string; task_prompt: string; enabled: number; last_run: string | null }>;

      if (schedules.length === 0) {
        renderer.renderSystemMessage('Nenhuma tarefa agendada.');
        return;
      }

      console.log('');
      for (const s of schedules) {
        const status = s.enabled ? '✓' : '✗';
        console.log(`  ${status} [${s.id.slice(0, 8)}] ${s.agent_id}: "${s.task_prompt}" (${s.cron_expr})`);
        if (s.last_run) {
          console.log(`    Ultima execucao: ${s.last_run}`);
        }
      }
      console.log('');
    },
  },
  {
    name: '/conversas',
    aliases: ['/convs'],
    description: 'Lista conversas recentes do agente (para retomar ou fork)',
    usage: '/conversas [agente]',
    execute: async (args, ctx) => {
      const agentId = (args[0] ?? ctx.activeAgent.id).toLowerCase();
      const convs = listConversations(agentId);
      if (convs.length === 0) {
        renderer.renderSystemMessage(`Nenhuma conversa registrada para "${agentId}".`);
        return;
      }
      console.log('');
      for (const c of convs) {
        const current = c.id === ctx.conversationId ? ' <- atual' : '';
        console.log(`  ${c.id.slice(0, 8)}  ${(c.title ?? '(sem titulo)').slice(0, 50).padEnd(50)} ${String(c.message_count).padStart(4)} msgs  ${c.updated_at}${current}`);
      }
      console.log('');
      renderer.renderSystemMessage('Use /retomar <id> ou /fork <id>.');
    },
  },
  {
    name: '/retomar',
    aliases: ['/resume'],
    description: 'Retoma uma conversa pelo id (veja /conversas)',
    usage: '/retomar <id>',
    execute: async (args, ctx) => {
      if (args.length === 0) {
        renderer.renderError('Informe o id da conversa. Ex: /retomar a1b2c3d4');
        return;
      }
      const conv = findConversationByPrefix(args[0]);
      if (!conv) {
        renderer.renderError(`Conversa "${args[0]}" nao encontrada (ou prefixo ambiguo — use mais caracteres).`);
        return;
      }
      const agent = registry.getAgent(conv.agent_id);
      if (!agent) {
        renderer.renderError(`O agente dono da conversa ("${conv.agent_id}") nao existe mais.`);
        return;
      }
      const config = getConfig();
      ctx.buildToolsForAgent(agent);
      ctx.activeAgent = agent;
      ctx.conversationId = conv.id;
      ctx.messageHistory = loadConversationById(conv.id, config.display.maxHistoryMessages);
      ctx.groupChat = null;
      renderer.renderSuccess(`Conversa ${conv.id.slice(0, 8)} retomada com ${agent.name} (${ctx.messageHistory.length} mensagens no contexto).`);
    },
  },
  {
    name: '/fork',
    aliases: [],
    description: 'Clona uma conversa (a atual, se sem id) e continua no clone',
    usage: '/fork [id]',
    execute: async (args, ctx) => {
      let sourceId = ctx.conversationId;
      if (args.length > 0) {
        const conv = findConversationByPrefix(args[0]);
        if (!conv) {
          renderer.renderError(`Conversa "${args[0]}" nao encontrada (ou prefixo ambiguo).`);
          return;
        }
        sourceId = conv.id;
      }
      if (!sourceId) {
        renderer.renderError('Nenhuma conversa ativa para fazer fork.');
        return;
      }
      const newId = forkConversation(sourceId);
      if (!newId) {
        renderer.renderError('Falha ao clonar a conversa.');
        return;
      }
      const config = getConfig();
      ctx.conversationId = newId;
      ctx.messageHistory = loadConversationById(newId, config.display.maxHistoryMessages);
      renderer.renderSuccess(`Fork criado (${newId.slice(0, 8)}) — a original fica intacta; voce esta no clone agora.`);
    },
  },
  {
    name: '/nova-conversa',
    aliases: ['/new-chat', '/nc'],
    description: 'Comeca uma conversa limpa (salva resumo da sessao na nota diaria)',
    usage: '/nova-conversa',
    execute: async (_args, ctx) => {
      try {
        const { summarizeSessionToDailyNote } = await import('../agents/memory-summarizer.js');
        const saved = await summarizeSessionToDailyNote(ctx.activeAgent, ctx.messageHistory);
        if (saved) {
          renderer.renderSystemMessage('Resumo da sessao salvo na nota diaria.');
        }
      } catch {
        // Summary is best-effort
      }
      ctx.messageHistory = [];
      ctx.conversationId = createNewConversation(ctx.activeAgent.id);
      renderer.renderSuccess('Nova conversa iniciada!');
    },
  },
  {
    name: '/modelo',
    aliases: ['/model', '/m'],
    description: 'Mostra ou muda o modelo de IA (ex: /modelo 3)',
    usage: '/modelo [numero|id]',
    execute: async (args) => {
      const config = getConfig();
      const available = getAvailableModels();

      if (available.length === 0) {
        renderer.renderError('Nenhuma chave de API configurada. Adicione no arquivo .env');
        return;
      }

      // No args = list models
      if (args.length === 0) {
        renderer.renderModelList(available, config.ai.model, config.ai.provider);
        return;
      }

      // With args = select model
      const selection = args.join(' ');
      const model = findModel(selection, available);

      if (!model) {
        renderer.renderError(`Modelo "${selection}" nao encontrado. Use /modelo para ver a lista.`);
        return;
      }

      updateConfig({
        ai: {
          ...config.ai,
          provider: model.provider,
          model: model.id,
        },
      });

      renderer.renderSuccess(`Modelo alterado para ${model.name} (${getProviderLabel(model.provider)})`);
    },
  },
  {
    name: '/onboarding',
    aliases: [],
    description: 'Refaz a entrevista de onboarding (perfil do usuario)',
    usage: '/onboarding',
    execute: async (_args, ctx) => {
      const config = getConfig();
      updateConfig({ user: { onboarded: false } });
      const principal = registry.getAgent(config.defaultAgent);
      if (principal && ctx.activeAgent.id !== principal.id) {
        ctx.buildToolsForAgent(principal);
        ctx.activeAgent = principal;
        const { conversationId, messages } = loadLastConversation(principal.id, config.display.maxHistoryMessages);
        ctx.messageHistory = messages;
        ctx.conversationId = conversationId ?? getOrCreateConversation(principal.id);
      }
      renderer.renderSuccess('Onboarding reativado!');
      const { route } = await import('./router.js');
      await route(
        '[Sistema] O usuario pediu para refazer o onboarding. Retome a entrevista de perfil de forma leve, revisando o que ja sabe e completando o que falta.',
        ctx
      );
    },
  },
  {
    name: '/skills',
    aliases: [],
    description: 'Lista as skills instaladas',
    usage: '/skills',
    execute: async () => {
      const skills = listSkillMetas();
      if (skills.length === 0) {
        renderer.renderSystemMessage(`Nenhuma skill instalada. Coloque pastas com SKILL.md em: ${getSkillsDir()}`);
        renderer.renderSystemMessage('Ou peca para um agente criar uma com a ferramenta createSkill.');
        return;
      }
      console.log('');
      for (const s of skills) {
        console.log(`  ${s.id.padEnd(28)} ${s.description}`);
      }
      console.log('');
    },
  },
  {
    name: '/skill',
    aliases: ['/sk'],
    description: 'Carrega uma skill na conversa atual',
    usage: '/skill <nome>',
    execute: async (args, ctx) => {
      if (args.length === 0) {
        renderer.renderError('Informe o nome da skill. Ex: /skill ponytail');
        return;
      }
      const skill = readSkillContent(args[0]);
      if (!skill) {
        renderer.renderError(`Skill "${args[0]}" nao encontrada. Use /skills para ver a lista.`);
        return;
      }
      ctx.messageHistory.push({
        role: 'user' as const,
        content: `[Skill carregada: ${skill.meta.id}]\nSiga estas instrucoes nas proximas tarefas:\n\n${skill.content}`,
      });
      ctx.messageHistory.push({
        role: 'assistant' as const,
        content: `Entendido, skill "${skill.meta.id}" carregada. Vou seguir essas instrucoes.`,
      });
      renderer.renderSuccess(`Skill "${skill.meta.id}" carregada na conversa.`);
    },
  },
  {
    name: '/config',
    aliases: ['/cfg'],
    description: 'Mostra o caminho do arquivo de configuracao',
    usage: '/config',
    execute: async () => {
      const configPath = getConfigPath();
      renderer.renderSystemMessage(`Arquivo de config: ${configPath}`);
      renderer.renderSystemMessage('Edite este arquivo para mudar configuracoes. As mudancas sao aplicadas em tempo real.');
    },
  },
  {
    name: '/mcp',
    aliases: [],
    description: 'Lista servers MCP conectados e suas ferramentas',
    usage: '/mcp',
    execute: async () => {
      const { getMcpStatus } = await import('../mcp/manager.js');
      const statuses = getMcpStatus();
      if (statuses.length === 0) {
        renderer.renderSystemMessage('Nenhum server MCP configurado. Adicione em mcp.servers no config.json (ex: {"meu-server": {"command": "node", "args": ["caminho/server.mjs"]}}).');
        return;
      }
      console.log('');
      for (const s of statuses) {
        const mark = s.connected ? '✓' : '✗';
        console.log(`  ${mark} ${s.server}${s.connected ? ` — ${s.tools.length} tool(s): ${s.tools.join(', ')}` : ` — falhou: ${s.error}`}`);
      }
      console.log('');
    },
  },
  {
    name: '/gc',
    aliases: ['/limpar-agentes'],
    description: 'Remove agentes temporarios ociosos (com confirmacao)',
    usage: '/gc',
    execute: async (_args, ctx) => {
      const { listTemporaries, cleanTemporaries } = await import('../agents/gc.js');
      const temps = listTemporaries();
      if (temps.length === 0) {
        renderer.renderSystemMessage('Nenhum agente temporario para limpar.');
        return;
      }
      const names = temps.map(t => `${t.id}${t.busy ? ' (ocupado — sera pulado)' : ''}`).join(', ');
      const { askConfirmation } = await import('./confirm.js');
      const result = await askConfirmation(`Remover ${temps.length} agente(s) temporario(s): ${names}?`);
      if (result.answer === 'no') {
        renderer.renderSystemMessage('Limpeza cancelada.');
        return;
      }
      const { removed, skipped } = cleanTemporaries();
      if (removed.length > 0) {
        renderer.renderSuccess(`Removidos: ${removed.join(', ')}`);
        if (removed.includes(ctx.activeAgent.id)) {
          const principal = registry.getAgent(registry.PRINCIPAL_ID)!;
          ctx.buildToolsForAgent(principal);
          ctx.activeAgent = principal;
        }
      }
      if (skipped.length > 0) {
        renderer.renderSystemMessage(`Pulados (ocupados): ${skipped.join(', ')}`);
      }
    },
  },
  {
    name: '/auto',
    aliases: [],
    description: 'Alterna execucao de comandos entre confirmar e automatico',
    usage: '/auto',
    execute: async () => {
      const config = getConfig();
      const newMode = config.shell.mode === 'auto' ? 'confirm' : 'auto';
      updateConfig({ shell: { ...config.shell, mode: newMode } });
      if (newMode === 'auto') {
        renderer.renderSuccess('Modo AUTO ativado: comandos executam sem confirmacao. Use /auto para voltar.');
      } else {
        renderer.renderSuccess('Modo CONFIRMAR ativado: comandos pedem sua aprovacao (s/n).');
      }
    },
  },
  {
    name: '/atualizar',
    aliases: ['/refresh'],
    description: 'Recarrega agendador, heartbeat e configuracoes',
    usage: '/atualizar',
    execute: async () => {
      refreshScheduler();
      const { refreshHeartbeat } = await import('../heartbeat/engine.js');
      refreshHeartbeat();
      renderer.renderSuccess('Configuracoes, agendador e heartbeat atualizados!');
    },
  },
  {
    name: '/limpar',
    aliases: ['/clear', '/cls'],
    description: 'Limpa a tela do terminal',
    usage: '/limpar',
    execute: async () => {
      console.clear();
    },
  },
  {
    name: '/sair',
    aliases: ['/quit', '/exit', '/q'],
    description: 'Encerra o programa (salva resumo da sessao na nota diaria)',
    usage: '/sair',
    execute: async (_args, ctx) => {
      try {
        const { summarizeSessionToDailyNote } = await import('../agents/memory-summarizer.js');
        const saved = await summarizeSessionToDailyNote(ctx.activeAgent, ctx.messageHistory);
        if (saved) {
          renderer.renderSystemMessage('Resumo da sessao salvo na nota diaria.');
        }
      } catch {
        // Summary is best-effort
      }
      const { getSessionUsage } = await import('../agents/usage.js');
      const usage = getSessionUsage();
      if (usage.calls > 0) {
        const cachePart = usage.cachedInputTokens > 0 ? ` (${Math.round(usage.cacheHitRate * 100)}% cache)` : '';
        const costPart = usage.costUsd !== null ? ` ≈ $${usage.costUsd.toFixed(4)}` : '';
        renderer.renderSystemMessage(
          `Sessao: ${usage.calls} chamada(s) de IA, ${usage.inputTokens.toLocaleString('pt-BR')} entrada${cachePart} / ${usage.outputTokens.toLocaleString('pt-BR')} saida${costPart}.`
        );
      }
      ctx.shouldExit = true;
    },
  },
];

export function findCommand(input: string): { command: Command; args: string[] } | null {
  const parts = input.trim().split(/\s+/);
  const cmdName = parts[0].toLowerCase();
  const args = parts.slice(1);

  const command = commands.find(
    c => c.name === cmdName || c.aliases.includes(cmdName)
  );

  return command ? { command, args } : null;
}
