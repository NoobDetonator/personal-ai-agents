import chalk from 'chalk';
import { getProviderLabel } from '../config/models.js';
import { emitBus } from '../web/bus.js';

const AGENT_COLORS = [
  chalk.cyan,
  chalk.magenta,
  chalk.yellow,
  chalk.green,
  chalk.blue,
  chalk.red,
];

const colorMap = new Map<string, (text: string) => string>();
let colorIndex = 0;

function getAgentColor(agentId: string): (text: string) => string {
  if (!colorMap.has(agentId)) {
    colorMap.set(agentId, AGENT_COLORS[colorIndex % AGENT_COLORS.length]);
    colorIndex++;
  }
  return colorMap.get(agentId)!;
}

export function renderWelcome(agentName: string): void {
  console.log('');
  console.log(chalk.bold.cyan('╔══════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║') + chalk.bold.white('   Personal AI Agents - Sistema de IAs   ') + chalk.bold.cyan('║'));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════════╝'));
  console.log('');
  console.log(chalk.gray(`  Agente ativo: `) + chalk.bold.cyan(agentName));
  console.log(chalk.gray(`  Digite /ajuda para comandos, / para trocar de modelo, Tab autocompleta`));
  console.log('');
}

export function renderAgentMessage(agentId: string, agentName: string, text: string): void {
  const color = getAgentColor(agentId);
  console.log('');
  console.log(color(`[${agentName}]`) + ' ' + text);
  console.log('');
  emitBus('chat_message', { agentId, agentName, text });
}

// --- Activity spinner (shown during "dead air": before the first token, and
// while waiting for a tool call to resolve) ---

const THINKING_VERBS = [
  'pensando', 'elaborando', 'refletindo', 'analisando', 'processando',
  'organizando as ideias', 'conectando os pontos', 'maquinando',
  'consultando a memória', 'ponderando', 'investigando', 'calculando',
];

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

let activityTimer: ReturnType<typeof setInterval> | null = null;

function pickThinkingVerb(): string {
  return THINKING_VERBS[Math.floor(Math.random() * THINKING_VERBS.length)];
}

function startActivitySpinner(label: string): void {
  stopActivitySpinner();
  const startedAt = Date.now();
  let frame = 0;
  const tick = (): void => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    const spinner = chalk.cyan(SPINNER_FRAMES[frame % SPINNER_FRAMES.length]);
    frame++;
    process.stdout.write(`\r${spinner} ${chalk.gray(`${label} (${elapsed}s)`)}`);
  };
  tick();
  activityTimer = setInterval(tick, 120);
}

function stopActivitySpinner(): void {
  if (activityTimer) {
    clearInterval(activityTimer);
    activityTimer = null;
    process.stdout.write('\r' + ' '.repeat(100) + '\r');
  }
}

/**
 * Substitui o rotulo do spinner ativo (ex: sub-progresso de uma delegacao:
 * "↳ Worker ⚙ writeFile..."). Reinicia o contador de segundos do sub-passo.
 */
export function updateActivityLabel(label: string): void {
  if (activityTimer) {
    startActivitySpinner(label);
  }
}

// --- Streaming ---

let streamAgent: { id: string; name: string } | null = null;
let namePrinted = false;
let hasTextOnLine = false;
let streamBuffer = '';

function ensureNamePrinted(): void {
  stopActivitySpinner();
  if (!namePrinted && streamAgent) {
    const color = getAgentColor(streamAgent.id);
    process.stdout.write(color(`[${streamAgent.name}]`) + ' ');
    namePrinted = true;
  }
}

export function renderStreamStart(agentId: string, agentName: string): void {
  streamAgent = { id: agentId, name: agentName };
  namePrinted = false;
  hasTextOnLine = false;
  streamBuffer = '';
  console.log('');
  startActivitySpinner(`${agentName} está ${pickThinkingVerb()}...`);
  emitBus('stream_start', { agentId, agentName });
}

export function renderStreamChunk(text: string): void {
  ensureNamePrinted();
  hasTextOnLine = true;
  streamBuffer += text;
  process.stdout.write(text);
  if (streamAgent) {
    emitBus('stream_delta', { agentId: streamAgent.id, text });
  }
}

/**
 * Called on every tool call. The spinner always restarts (so long-running
 * tools never go dark), but the permanent "⚙ toolName" transcript line only
 * prints when `showChip` is true (the display.showToolCalls setting).
 */
export function renderStreamToolCall(toolName: string, showChip: boolean = true): void {
  ensureNamePrinted();
  if (showChip) {
    // Break the line if text was already streaming, then show the indicator
    const prefix = hasTextOnLine ? '\n' : '';
    hasTextOnLine = false;
    process.stdout.write(prefix + chalk.gray(`⚙ ${toolName}...`) + '\n  ');
  }
  if (streamAgent) {
    emitBus('tool_call', { agentId: streamAgent.id, toolName });
    startActivitySpinner(`${streamAgent.name} está executando ${toolName}...`);
  }
}

export function renderStreamEnd(): void {
  stopActivitySpinner();
  console.log('');
  console.log('');
  if (streamAgent) {
    emitBus('stream_end', { agentId: streamAgent.id, agentName: streamAgent.name, text: streamBuffer });
  }
  streamAgent = null;
  namePrinted = false;
  hasTextOnLine = false;
  streamBuffer = '';
}

export function renderTokenUsage(inputTokens: number, outputTokens: number, cachedInputTokens: number = 0): void {
  const cachePart = cachedInputTokens > 0 && inputTokens > 0
    ? ` (${Math.round((cachedInputTokens / inputTokens) * 100)}% cache)`
    : '';
  console.log(chalk.gray(`  tokens: ${inputTokens} entrada${cachePart} / ${outputTokens} saida`));
  emitBus('tokens', { inputTokens, outputTokens, cachedInputTokens });
}

export function renderSystemMessage(text: string): void {
  console.log(chalk.gray(`  ${text}`));
  emitBus('system', { text });
}

export function renderError(text: string): void {
  console.log(chalk.red(`  Erro: ${text}`));
  emitBus('error', { text });
}

export function renderSuccess(text: string): void {
  console.log(chalk.green(`  ${text}`));
}

export function renderAgentList(agents: Array<{ id: string; name: string; description: string; active: boolean }>): void {
  console.log('');
  console.log(chalk.bold('  Agentes disponiveis:'));
  console.log('');
  for (const agent of agents) {
    const color = getAgentColor(agent.id);
    const marker = agent.active ? chalk.green(' (ativo)') : '';
    console.log(`  ${color(agent.name)} ${chalk.gray(`(${agent.id})`)}${marker}`);
    if (agent.description) {
      console.log(chalk.gray(`    ${agent.description}`));
    }
  }
  console.log('');
}

export function renderHelp(commands: Array<{ name: string; description: string }>): void {
  console.log('');
  console.log(chalk.bold('  Comandos disponiveis:'));
  console.log('');
  for (const cmd of commands) {
    console.log(`  ${chalk.cyan(cmd.name.padEnd(25))} ${chalk.gray(cmd.description)}`);
  }
  console.log('');
  console.log(chalk.gray('  Atalhos: "/" mostra os modelos, "/<numero>" troca (ex: /2), Tab autocompleta.'));
  console.log(chalk.gray('  Ou simplesmente digite uma mensagem para conversar com a IA.'));
  console.log('');
}

export function renderGroupHeader(agentNames: string[]): void {
  console.log('');
  console.log(chalk.bold.yellow(`  Chat em grupo com: ${agentNames.join(', ')}`));
  console.log(chalk.gray('  Use /sair-grupo para voltar ao chat individual'));
  console.log('');
  emitBus('group_header', { participants: agentNames });
}

export function renderModelList(
  models: Array<{ id: string; name: string; provider: string; description: string }>,
  currentModel: string,
  currentProvider: string,
): void {
  console.log('');
  console.log(chalk.bold('  Modelos disponiveis:'));

  let lastProvider = '';
  let index = 1;
  for (const model of models) {
    if (model.provider !== lastProvider) {
      console.log('');
      console.log(chalk.bold.yellow(`  --- ${getProviderLabel(model.provider)} ---`));
      lastProvider = model.provider;
    }

    const isCurrent = model.id === currentModel && model.provider === currentProvider;
    const marker = isCurrent ? chalk.green(' <- atual') : '';
    const num = chalk.gray(`${String(index).padStart(2)}.`);
    console.log(`  ${num} ${chalk.cyan(model.name.padEnd(22))} ${chalk.gray(model.description)}${marker}`);
    index++;
  }

  console.log('');
  console.log(chalk.gray('  Use: /modelo <numero> ou /modelo <id-do-modelo>'));
  console.log('');
}

export function renderRoundSeparator(round: number, maxRounds: number): void {
  console.log('');
  console.log(chalk.gray(`  --- Rodada ${round + 1}/${maxRounds} ---`));
  console.log('');
}

export function getPromptString(agentName: string, isGroup: boolean): string {
  if (isGroup) {
    return chalk.yellow('grupo> ');
  }
  return chalk.cyan(`${agentName.toLowerCase()}> `);
}
