import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG, type AppConfig } from './defaults.js';

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

export function loadConfig(): AppConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      currentConfig = deepMerge(DEFAULT_CONFIG, parsed) as AppConfig;
    } else {
      currentConfig = structuredClone(DEFAULT_CONFIG);
    }
  } catch {
    currentConfig = structuredClone(DEFAULT_CONFIG);
  }

  saveConfig();
  return currentConfig;
}

export function saveConfig(): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(currentConfig, null, 2), 'utf-8');
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
