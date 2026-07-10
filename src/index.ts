import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { loadConfig, updateConfig, getConfig } from './config/loader.js';
import { startConfigWatcher, stopConfigWatcher } from './config/watcher.js';
import { initDatabase, closeDatabase } from './db/connection.js';
import { initRegistry } from './agents/registry.js';
import { loadSkills, startSkillsWatcher, stopSkillsWatcher, listSkillMetas } from './skills/loader.js';
import { startScheduler, stopScheduler, getActiveTaskCount } from './scheduler/engine.js';
import { startHeartbeat, stopHeartbeat } from './heartbeat/engine.js';
import { startWebServer, stopWebServer } from './web/server.js';
import { startMcpClients, stopMcpClients } from './mcp/manager.js';
import { initAllAgentTools, startCli } from './chat/cli.js';
import { getAvailableModels } from './config/models.js';

const PROVIDER_KEYS: Record<string, string> = {
  deepseek: 'DEEPSEEK_API_KEY',
  zai: 'ZAI_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
};

function checkApiKeys(): boolean {
  const hasAny = Object.values(PROVIDER_KEYS).some(key => !!process.env[key]);

  if (!hasAny) {
    console.log('');
    console.log(chalk.red.bold('  Nenhuma chave de API encontrada!'));
    console.log('');
    console.log(chalk.yellow('  Crie um arquivo .env na raiz do projeto com pelo menos uma chave:'));
    console.log('');
    console.log(chalk.gray('  DEEPSEEK_API_KEY=sk-...'));
    console.log(chalk.gray('  ZAI_API_KEY=...'));
    console.log(chalk.gray('  OPENAI_API_KEY=sk-...'));
    console.log(chalk.gray('  ANTHROPIC_API_KEY=sk-ant-...'));
    console.log(chalk.gray('  GOOGLE_GENERATIVE_AI_API_KEY=AI...'));
    console.log(chalk.gray('  NVIDIA_API_KEY=nvapi-...'));
    console.log('');
    console.log(chalk.gray('  Copie o arquivo .env.example para .env e preencha suas chaves.'));
    console.log('');
    return false;
  }

  return true;
}

function autoSelectProvider(): void {
  const config = getConfig();
  const currentProviderKey = PROVIDER_KEYS[config.ai.provider];

  // If current provider has a valid key, nothing to do
  if (currentProviderKey && !!process.env[currentProviderKey]) return;

  // Current provider has no key — find the first available model
  const available = getAvailableModels();
  if (available.length === 0) return;

  const firstModel = available[0];
  updateConfig({
    ai: {
      ...config.ai,
      provider: firstModel.provider,
      model: firstModel.id,
    },
  });
  console.log(chalk.yellow(`  Provider "${config.ai.provider}" sem chave de API.`));
  console.log(chalk.yellow(`  Trocando automaticamente para ${firstModel.name} (${firstModel.provider}).`));
}

async function main(): Promise<void> {
  // 1. Check API keys
  if (!checkApiKeys()) {
    process.exit(1);
  }

  // 2. Load/heal config
  loadConfig();
  console.log(chalk.gray('  Config carregado.'));

  // 3. Auto-select provider if current one has no API key
  autoSelectProvider();

  // 4. Start config watcher
  startConfigWatcher();

  // 5. Initialize database
  initDatabase();
  console.log(chalk.gray('  Banco de dados inicializado.'));

  // 5b. Ensure agent workspace directory exists
  const workspaceDir = path.join(process.cwd(), 'workspace');
  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir, { recursive: true });
  }

  // 6. Discover and register agents
  initRegistry();
  console.log(chalk.gray('  Agentes registrados.'));

  // 6a. Warn about leftover temporary agents from previous work
  const { listTemporaries } = await import('./agents/gc.js');
  const temps = listTemporaries();
  if (temps.length > 0) {
    console.log(chalk.yellow(`  🧹 ${temps.length} agente(s) temporario(s) de trabalhos anteriores: ${temps.map(t => t.id).join(', ')} — use /gc para limpar.`));
  }

  // 6b. Load skills
  loadSkills();
  startSkillsWatcher();
  const skillCount = listSkillMetas().length;
  if (skillCount > 0) {
    console.log(chalk.gray(`  Skills: ${skillCount} carregada(s).`));
  }

  // 6c. Connect MCP servers (tools must exist before agent toolsets)
  await startMcpClients();

  // 7. Build tool sets for all agents
  initAllAgentTools();

  // 8. Start scheduler
  startScheduler();
  const taskCount = getActiveTaskCount();
  if (taskCount > 0) {
    console.log(chalk.gray(`  Agendador: ${taskCount} tarefa(s) ativa(s).`));
  }

  // 8b. Start heartbeat (if enabled in config)
  startHeartbeat();
  if (getConfig().heartbeat.enabled) {
    console.log(chalk.gray(`  Heartbeat ativo a cada ${getConfig().heartbeat.intervalMin} min.`));
  }

  // 8c. Start web panel
  startWebServer();
  if (getConfig().web.enabled) {
    console.log(chalk.gray(`  Painel web: `) + chalk.cyan(`http://localhost:${getConfig().web.port}`));
  }

  // 8d. Loud warning when shell auto mode is on (commands run unconfirmed)
  if (getConfig().shell.mode === 'auto') {
    console.log(chalk.yellow.bold('  ⚠ Shell em modo AUTO: comandos executam SEM confirmacao. Use /auto para voltar ao modo confirmar.'));
  }

  // 9. Launch CLI
  await startCli();

  // Cleanup on exit
  cleanup();
}

function cleanup(): void {
  stopScheduler();
  stopHeartbeat();
  stopWebServer();
  stopConfigWatcher();
  stopSkillsWatcher();
  void stopMcpClients();
  closeDatabase();
}

// Graceful shutdown
process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

main().catch((error) => {
  console.error(chalk.red('Erro fatal:'), error);
  process.exit(1);
});
