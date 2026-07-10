import { watch, type FSWatcher } from 'chokidar';
import { loadConfig, getConfigPath } from './loader.js';

type ConfigChangeHandler = () => void;

let watcher: FSWatcher | null = null;
const handlers: ConfigChangeHandler[] = [];

export function startConfigWatcher(): void {
  const configPath = getConfigPath();

  watcher = watch(configPath, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300 },
  });

  watcher.on('change', () => {
    loadConfig();
    for (const handler of handlers) {
      handler();
    }
  });
}

export function onConfigChange(handler: ConfigChangeHandler): void {
  handlers.push(handler);
}

export function stopConfigWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}
