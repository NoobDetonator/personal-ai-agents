import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_SCHEMA, DEFAULT_CONFIG, type AppConfig } from './defaults.js';

const ROOT_DIR = process.cwd();
const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');

let currentConfig: AppConfig = structuredClone(DEFAULT_CONFIG);

function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      typeof target[key] === 'object' &&
      target[key] !== null &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/** Move um config.json corrompido para um backup datado e retorna o caminho. */
function backupCorruptConfig(): string | null {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${CONFIG_PATH}.invalid-${stamp}`;
  try {
    fs.renameSync(CONFIG_PATH, backupPath);
    return backupPath;
  } catch {
    return null;
  }
}

export function loadConfig(): AppConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    currentConfig = structuredClone(DEFAULT_CONFIG);
    saveConfig();
    return currentConfig;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Config] Nao foi possivel ler config.json (${message}); usando padroes em memoria. O arquivo NAO foi alterado.`);
    currentConfig = structuredClone(DEFAULT_CONFIG);
    return currentConfig;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('config.json deve conter um objeto JSON');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const backup = backupCorruptConfig();
    console.error(
      `[Config] config.json corrompido (${message}). ` +
      (backup ? `Original preservado em: ${backup}. ` : 'Nao foi possivel criar backup; arquivo mantido. ') +
      'Usando padroes.',
    );
    currentConfig = structuredClone(DEFAULT_CONFIG);
    if (backup) saveConfig();
    return currentConfig;
  }

  const merged = deepMerge(DEFAULT_CONFIG, parsed as Record<string, any>) as AppConfig;
  const validation = CONFIG_SCHEMA.safeParse(merged);
  if (!validation.success) {
    console.error('[Config] config.json contem valores invalidos; usando padroes em memoria. Corrija os campos abaixo (o arquivo NAO foi alterado):');
    for (const issue of validation.error.issues) {
      console.error(`  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`);
    }
    currentConfig = structuredClone(DEFAULT_CONFIG);
    return currentConfig;
  }

  currentConfig = merged;
  // Regrava apenas se a forma canonica difere (ex.: chaves novas de versoes
  // mais recentes). Idempotente — evita loop com o watcher de config.
  if (raw !== JSON.stringify(currentConfig, null, 2)) {
    saveConfig();
  }
  return currentConfig;
}

/** Escrita atomica: grava em .tmp e renomeia por cima, evitando arquivo truncado. */
export function saveConfig(): void {
  const tmpPath = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(currentConfig, null, 2), 'utf-8');
  fs.renameSync(tmpPath, CONFIG_PATH);
}

export function getConfig(): AppConfig {
  return currentConfig;
}

export function updateConfig(partial: Partial<AppConfig>): AppConfig {
  currentConfig = deepMerge(currentConfig as any, partial as any) as AppConfig;
  saveConfig();
  return currentConfig;
}

export function updateAgentInConfig(agentId: string, agentConfig: AppConfig['agents'][string]): void {
  currentConfig.agents[agentId] = agentConfig;
  saveConfig();
}

export function removeAgentFromConfig(agentId: string): void {
  delete currentConfig.agents[agentId];
  saveConfig();
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}
