import { generateText, streamText, stepCountIs, type ToolSet, type ModelMessage, type LanguageModel } from 'ai';
import { openai, createOpenAI } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';

// DeepSeek expoe uma API compativel com OpenAI — sem dependencia extra
const deepseek = createOpenAI({
  name: 'deepseek',
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY ?? '',
});

// Modo rapido: mesma API, mas com o thinking mode desligado via body extra
// (instancia separada em vez de estado global — delegacoes paralelas nao
// podem compartilhar um flag mutavel)
const deepseekFast = createOpenAI({
  name: 'deepseek-fast',
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY ?? '',
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body);
        body.thinking = { type: 'disabled' };
        init = { ...init, body: JSON.stringify(body) };
      } catch { /* ignore parse errors */ }
    }
    return globalThis.fetch(input, init);
  },
});

// Z.AI (modelos GLM) tambem e compativel com OpenAI.
// Usa o endpoint dedicado do "GLM Coding Plan" (assinatura mensal) em vez do
// pay-as-you-go padrao: contas com Coding Plan tem saldo zero no endpoint
// padrao (que so libera o modelo gratis glm-4.5-flash e recusa os demais
// com "Insufficient balance"), mas o endpoint dedicado libera todos os
// modelos contratados no plano.
const zai = createOpenAI({
  name: 'zai',
  baseURL: 'https://api.z.ai/api/coding/paas/v4',
  apiKey: process.env.ZAI_API_KEY ?? '',
});

const nvidia = createOpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY ?? '',
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body);
        const model: string = body.model ?? '';
        if (model.includes('nemotron')) {
          body.chat_template_kwargs = { enable_thinking: false };
        }
        body.stream = false;
        init = { ...init, body: JSON.stringify(body) };
      } catch { /* ignore parse errors */ }
    }
    return globalThis.fetch(input, init);
  },
});
import { getConfig } from '../config/loader.js';
import { readSoul, readMemory, readDailyNote } from './personality.js';
import { readUserProfile } from './user-profile.js';
import { DATA_AUTHORITY_NOTE, fenceUntrustedData } from './prompt-data.js';
import { listSkillMetas } from '../skills/loader.js';
import { PROVIDER_ENV_KEYS } from '../config/models.js';
import { addUsage } from './usage.js';
import type { AgentConfig } from '../config/defaults.js';

const DEFAULT_MAX_STEPS = 20;
const LEADER_MAX_STEPS = 40;

/**
 * Modelo barato/rapido para side-queries internas (recall de memorias etc):
 * DeepSeek fast quando disponivel; senao o modelo global.
 */
export function getSideQueryModel(): LanguageModel {
  const config = getConfig();
  switch (config.ai.provider) {
    case 'deepseek':
      return deepseekFast.chat(config.ai.model);
    case 'zai':
      return zai.chat(config.ai.model);
    case 'anthropic':
      return anthropic(config.ai.model);
    case 'google':
      return google(config.ai.model);
    case 'nvidia':
      return nvidia(config.ai.model);
    default:
      return openai(config.ai.model);
  }
}

// Deteccao de turno inacabado: cortado pelo limite de passos/tokens, ou
// terminando com promessa de acao imediata sem executa-la
const PROMISE_ENDING = /\b(vou|irei|agora vou|deixa eu|em seguida vou|passo agora a)\b[^.!?…]{0,80}[.!…]?\s*$/i;

export function looksUnfinished(text: string, finishReason: string): boolean {
  if (finishReason === 'tool-calls' || finishReason === 'length') return true;
  const tail = text.trim().slice(-200);
  if (tail.endsWith('?')) return false; // pergunta ao usuario = turno completo
  return PROMISE_ENDING.test(tail);
}

export const CONTINUE_HINT =
  '[Sistema] Seu turno anterior foi interrompido no meio do trabalho (ou terminou prometendo uma acao). Continue EXATAMENTE de onde parou e conclua o que falta usando suas ferramentas. Nao repita o que ja foi feito; nao descreva o plano de novo — execute.';

// Anti-fabricacao: padroes de "alegou que executou algo" — se aparecem numa
// resposta SEM nenhuma tool call no turno, o turno e refeito com correcao
const FABRICATION_CLAIM =
  /(comando (foi |ja )?executad|executei|rodei o comando|arquivo .{0,60}(criado|salvo|gerado|deletado)|criei o arquivo|deletei o arquivo|agendamento .{0,40}(criado|deletado)|tarefa agendada)/i;

export function looksFabricated(text: string, toolCallCount: number): boolean {
  return toolCallCount === 0 && FABRICATION_CLAIM.test(text);
}

export const ANTI_FABRICATION_RETRY_HINT =
  '[Verificacao do sistema] Sua resposta anterior alegou ter executado uma acao, mas voce NAO chamou nenhuma ferramenta neste turno — isso e inaceitavel. Agora CHAME as ferramentas necessarias de verdade e reporte apenas o resultado real retornado por elas. Se nao for possivel executar, diga claramente que nao executou.';

export class Agent {
  public readonly id: string;
  private tools: ToolSet = {};

  constructor(id: string) {
    this.id = id;
  }

  get name(): string {
    const config = getConfig();
    return config.agents[this.id]?.name ?? this.id;
  }

  get description(): string {
    const config = getConfig();
    return config.agents[this.id]?.description ?? '';
  }

  get agentConfig(): AgentConfig | undefined {
    return getConfig().agents[this.id];
  }

  setTools(tools: ToolSet): void {
    this.tools = tools;
  }

  /**
   * Resolves the agent-level provider/model, falling back to the global
   * config when the agent's provider has no API key configured.
   */
  private resolveProviderAndModel(): { provider: string; model: string } {
    const config = getConfig();
    const agentCfg = config.agents[this.id];
    let provider = agentCfg?.provider ?? config.ai.provider;
    let model = agentCfg?.model ?? config.ai.model;

    const envKey = PROVIDER_ENV_KEYS[provider as keyof typeof PROVIDER_ENV_KEYS];
    if (envKey && !process.env[envKey]) {
      provider = config.ai.provider;
      model = config.ai.model;
    }

    return { provider, model };
  }

  getModel(): LanguageModel {
    const { provider, model } = this.resolveProviderAndModel();

    const fastMode = getConfig().agents[this.id]?.thinking === false;

    switch (provider) {
      case 'deepseek':
        return fastMode ? deepseekFast.chat(model) : deepseek.chat(model);
      case 'zai':
        return zai.chat(model);
      case 'anthropic':
        return anthropic(model);
      case 'google':
        return google(model);
      case 'nvidia':
        return nvidia(model);
      case 'openai':
      default:
        return openai(model);
    }
  }

  /**
   * System prompt ordenado do estavel para o volatil: o cache de contexto do
   * DeepSeek e por prefixo de tokens, entao soul/regras/hierarquia (que quase
   * nao mudam) vem primeiro e perfil/memoria/nota diaria (que mudam durante o
   * dia) ficam no final — mudancas volateis nao invalidam o prefixo cacheado.
   */
  buildSystemPrompt(): string {
    const config = getConfig();
    const parts: string[] = [];

    // --- Bloco estavel ---

    const soul = readSoul(this.id);
    if (soul) {
      parts.push(soul);
    }

    const team = config.agents[this.id]?.team;
    const workDir = team ? `workspace/${team}/` : 'workspace/';

    parts.push(
      `---\n# Contexto\nSeu nome e "${this.name}" (id: ${this.id}). Modelo: ${config.ai.model} (${config.ai.provider}). Area de trabalho padrao: "${workDir}".`
    );

    parts.push(this.buildHierarchySection());

    parts.push(
      '---\n# Regras de Operacao (obrigatorias)\n' +
      '- Responda sempre em portugues brasileiro, salvo pedido contrario.\n' +
      '- NUNCA simule ou invente resultado de ferramenta: se a tarefa exige executar, criar/ler arquivo, pesquisar ou agendar, CHAME a ferramenta nesta mesma resposta e reporte apenas o resultado real; se falhar ou for negada, diga claramente.\n' +
      '- Antes de reportar qualquer entrega, VERIFIQUE com ferramentas (releia arquivos criados, liste diretorios, rode o testavel); so diga "pronto" para o que conferiu; se faltou algo, diga exatamente o que falta.\n' +
      '- Arquivos grandes (mais de ~150 linhas): escreva em PARTES (writeFile no primeiro bloco + appendFile nos seguintes) — em chamada unica o arquivo sai truncado.\n' +
      '- Nunca termine a resposta prometendo uma acao ("vou fazer X") — execute ANTES de responder.\n' +
      '- Skills: chame useSkill APENAS antes de executar uma tarefa tecnica coberta por uma skill listada; NUNCA para conversa ou pergunta simples. Apos dominar uma tarefa repetivel, considere createSkill/updateSkill.\n' +
      '- Memoria: fatos curtos do usuario → saveMemory; eventos do dia → appendDailyNote; conteudo EXTENSO (procedimentos, contexto de projetos) → saveDeepMemory (sera recuperado automaticamente quando relevante). Se o usuario citar algo antigo que voce nao lembra, use searchConversations antes de dizer que nao sabe.'
    );

    const skills = listSkillMetas();
    if (skills.length > 0) {
      const skillLines = skills
        .map(s => {
          const desc = s.description.length > 140 ? s.description.slice(0, 140) + '…' : s.description;
          return `- ${s.id}: ${desc}`;
        })
        .join('\n');
      parts.push(`---\n# Skills Disponiveis (corpo completo via useSkill)\n${skillLines}`);
    }

    if (config.obsidian.vaultPath) {
      parts.push(
        `Vault do Obsidian do usuario: ${config.obsidian.vaultPath} — leia/crie notas com as ferramentas de arquivo (Markdown com [[wikilinks]]).`
      );
    }

    // Fecha o trecho estavel com a nota de autoridade (constante, cacheavel)
    parts.push(DATA_AUTHORITY_NOTE);

    // --- Bloco volatil (fica no final para preservar o prefixo de cache) ---
    // Perfil, memoria e nota sao gravados por agentes/sessoes anteriores e
    // podem carregar conteudo de origem externa: entram cercados como dados.

    const userProfile = readUserProfile();
    if (userProfile) {
      parts.push(
        '---\n# Perfil do Usuario (compartilhado entre todos os agentes)\n' +
        fenceUntrustedData('dados-perfil-usuario', userProfile)
      );
    }

    let memory = readMemory(this.id);
    if (memory) {
      // Cap estilo memdir: o indice curto fica no prompt; conteudo extenso
      // pertence as memorias profundas (recuperadas sob demanda)
      if (memory.length > 2048) {
        memory = memory.slice(0, 2048) +
          '\n\n[...memoria truncada. Mova conteudo extenso para memorias profundas (saveDeepMemory) e mantenha aqui apenas o essencial.]';
      }
      parts.push('---\n# Sua Memoria\n' + fenceUntrustedData('dados-memoria', memory));
    }

    const dailyNote = readDailyNote(this.id);
    if (dailyNote) {
      parts.push('---\n# Sua Nota de Hoje\n' + fenceUntrustedData('dados-nota-diaria', dailyNote));
    }

    return parts.join('\n\n');
  }

  private buildHierarchySection(): string {
    const config = getConfig();
    const myCfg = config.agents[this.id];
    const role = myCfg?.role ?? 'worker';
    const lines: string[] = ['---', '# Hierarquia'];

    if (role === 'principal') {
      lines.push(
        'Voce e a agente PRINCIPAL ("mae") do sistema: assistente direta do usuario e criadora/configuradora de todos os outros agentes. ' +
        'Voce pode criar agentes e equipes (createAgent), condicionar a personalidade e memoria deles (configureAgent, seedAgentMemory), ' +
        'delegar tarefas (delegateTask/delegateTasks), acompanhar o board (createTask/listTasks) e deletar subordinados temporarios (deleteAgent). ' +
        'Todos os agentes do sistema estao abaixo de voce.'
      );
    } else if (role === 'manager') {
      lines.push(
        'Voce e MANAGER: lidera seus subordinados, cria workers quando precisar (createAgent), delega tarefas a eles e reporta resultados ao seu superior. ' +
        'Respeite a hierarquia: decisoes finais sao do seu superior.'
      );
    } else {
      lines.push(
        'Voce e um agente EXECUTOR (worker): execute com excelencia o que seu superior pedir e reporte resultados objetivos e reais. ' +
        'Se precisar de ajuda pontual, voce pode criar um agente temporario subordinado a voce (createAgent com temporary=true) e deleta-lo ao final.'
      );
    }

    const parent = myCfg?.parent;
    if (parent && config.agents[parent]) {
      lines.push(`Seu superior direto: ${config.agents[parent].name} (${parent}).`);
    }

    const subs = Object.keys(config.agents).filter(id => config.agents[id].parent === this.id);
    if (subs.length > 0) {
      const subList = subs.map(id => `${config.agents[id].name} (${id}${config.agents[id].team ? `, equipe ${config.agents[id].team}` : ''})`).join(', ');
      lines.push(`Seus subordinados diretos: ${subList}.`);
    }

    const team = myCfg?.team;
    if (team) {
      const teammates = Object.keys(config.agents)
        .filter(id => id !== this.id && config.agents[id].team === team)
        .map(id => `${config.agents[id].name} (${id})`)
        .join(', ');
      lines.push(`Sua equipe: "${team}"${teammates ? ` — colegas: ${teammates}` : ''}.`);
    }

    lines.push('Voce pode conversar com qualquer agente via sendMessage (e ler recados com checkMessages).');

    return lines.join('\n');
  }

  private getProvider(): string {
    return this.resolveProviderAndModel().provider;
  }

  private getMaxSteps(): number {
    const role = getConfig().agents[this.id]?.role ?? 'worker';
    return role === 'principal' || role === 'manager' ? LEADER_MAX_STEPS : DEFAULT_MAX_STEPS;
  }

  async chat(messages: ModelMessage[], opts?: { systemHint?: string; abortSignal?: AbortSignal }): Promise<{
    text: string;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    toolCallCount: number;
    finishReason: string;
  }> {
    const config = getConfig();
    const provider = this.getProvider();
    const temperature = provider === 'nvidia' ? 0.2 : config.ai.temperature;

    const result = await generateText({
      model: this.getModel(),
      system: this.buildSystemPrompt() + (opts?.systemHint ? `\n\n${opts.systemHint}` : ''),
      messages,
      tools: this.tools,
      stopWhen: stepCountIs(this.getMaxSteps()),
      maxOutputTokens: config.ai.maxOutputTokens,
      temperature,
      abortSignal: opts?.abortSignal,
    });

    const toolCallCount = result.steps.reduce((sum, step) => sum + step.toolCalls.length, 0);
    const inputTokens = result.usage?.inputTokens ?? 0;
    const outputTokens = result.usage?.outputTokens ?? 0;
    const cachedInputTokens =
      result.usage?.inputTokenDetails?.cacheReadTokens ?? result.usage?.cachedInputTokens ?? 0;
    addUsage(inputTokens, outputTokens, cachedInputTokens, this.resolveProviderAndModel().model);

    return {
      text: result.text,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      toolCallCount,
      finishReason: String(result.finishReason),
    };
  }

  async chatStream(
    messages: ModelMessage[],
    handlers: {
      onTextDelta?: (text: string) => void;
      onToolCall?: (toolName: string) => void;
    } = {},
    opts?: { systemHint?: string; abortSignal?: AbortSignal },
  ): Promise<{
    text: string;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    toolCallCount: number;
    finishReason: string;
  }> {
    const config = getConfig();
    const provider = this.getProvider();

    // NVIDIA custom fetch forces stream=false; fall back to non-streaming
    if (provider === 'nvidia') {
      const result = await this.chat(messages, opts);
      handlers.onTextDelta?.(result.text);
      return result;
    }

    const temperature = config.ai.temperature;

    const result = streamText({
      model: this.getModel(),
      system: this.buildSystemPrompt() + (opts?.systemHint ? `\n\n${opts.systemHint}` : ''),
      messages,
      tools: this.tools,
      stopWhen: stepCountIs(this.getMaxSteps()),
      maxOutputTokens: config.ai.maxOutputTokens,
      temperature,
      abortSignal: opts?.abortSignal,
    });

    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens = 0;
    let toolCallCount = 0;
    let finishReason = 'stop';

    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          text += part.text;
          handlers.onTextDelta?.(part.text);
          break;
        case 'tool-call':
          toolCallCount++;
          handlers.onToolCall?.(part.toolName);
          break;
        case 'finish':
          inputTokens = part.totalUsage.inputTokens ?? 0;
          outputTokens = part.totalUsage.outputTokens ?? 0;
          cachedInputTokens =
            part.totalUsage.inputTokenDetails?.cacheReadTokens ?? part.totalUsage.cachedInputTokens ?? 0;
          finishReason = String(part.finishReason);
          break;
        case 'abort':
          // Abort pode chegar como parte do stream em vez de excecao —
          // propagar como erro para timeout/cancelamento funcionarem
          throw new Error('Chamada abortada (timeout ou cancelamento).');
        case 'error':
          throw part.error instanceof Error ? part.error : new Error(String(part.error));
      }
    }

    addUsage(inputTokens, outputTokens, cachedInputTokens, this.resolveProviderAndModel().model);
    return { text, inputTokens, outputTokens, cachedInputTokens, toolCallCount, finishReason };
  }

  async processMessage(
    content: string,
    opts?: { context?: string; abortSignal?: AbortSignal; onToolCall?: (toolName: string) => void },
  ): Promise<string> {
    const messages: ModelMessage[] = [];

    if (opts?.context) {
      messages.push({ role: 'user', content: opts.context });
      messages.push({ role: 'assistant', content: 'Entendido.' });
    }

    messages.push({ role: 'user', content });

    // chatStream (sem render de texto) para expor progresso das tool calls
    const run = () =>
      this.chatStream(
        messages,
        { onToolCall: opts?.onToolCall },
        { abortSignal: opts?.abortSignal },
      );

    let result = await run();

    // Auto-continuacao: turno cortado no meio do trabalho → continua (max 2x)
    let continuations = 0;
    while (looksUnfinished(result.text, result.finishReason) && continuations < 2) {
      continuations++;
      messages.push({ role: 'assistant', content: result.text });
      messages.push({ role: 'user', content: CONTINUE_HINT });
      result = await run();
    }

    // Anti-fabricacao: alegou execucao sem chamar ferramenta → refaz uma vez
    if (looksFabricated(result.text, result.toolCallCount)) {
      result = await this.chatStream(
        messages,
        { onToolCall: opts?.onToolCall },
        { abortSignal: opts?.abortSignal, systemHint: ANTI_FABRICATION_RETRY_HINT },
      );

      if (looksFabricated(result.text, result.toolCallCount)) {
        return '[FALHA] O agente alegou ter executado a tarefa sem chamar nenhuma ferramenta (2 tentativas). Nada foi executado de verdade — trate como tarefa NAO realizada.';
      }
    }

    return result.text;
  }
}
