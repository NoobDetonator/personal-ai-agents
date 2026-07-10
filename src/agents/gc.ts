import { getConfig } from '../config/loader.js';
import * as registry from './registry.js';
import { listActiveDelegations } from '../tools/tasks.js';

export interface TemporaryAgentInfo {
  id: string;
  name: string;
  team: string | null;
  busy: boolean; // com delegacao em andamento — nao deve ser removido agora
}

export function listTemporaries(): TemporaryAgentInfo[] {
  const config = getConfig();
  const busyIds = new Set(listActiveDelegations().map(d => d.to));

  return Object.entries(config.agents)
    .filter(([, cfg]) => cfg.temporary === true)
    .map(([id, cfg]) => ({
      id,
      name: cfg.name,
      team: cfg.team ?? null,
      busy: busyIds.has(id),
    }));
}

/**
 * Remove os agentes temporarios ociosos (pula os com delegacao ativa).
 * Retorna os ids removidos e os pulados.
 */
export function cleanTemporaries(): { removed: string[]; skipped: string[] } {
  const removed: string[] = [];
  const skipped: string[] = [];

  for (const temp of listTemporaries()) {
    if (temp.busy) {
      skipped.push(temp.id);
      continue;
    }
    try {
      registry.deleteAgent(temp.id);
      removed.push(temp.id);
    } catch {
      skipped.push(temp.id);
    }
  }

  return { removed, skipped };
}
