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

  // loadConfig so regrava quando o conteudo canonico difere, entao eventos
  // disparados pela propria regravacao nao criam loop de reload/rewrite.
  const reload = () => {
    loadConfig();
    for (const handler of handlers) {
      handler();
    }
  };
  watcher.on('change', reload);
  watcher.on('add', reload); // arquivo recriado (ex.: apos backup de config corrompida)
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
