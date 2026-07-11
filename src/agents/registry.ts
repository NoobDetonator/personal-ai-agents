import { getConfig, updateAgentInConfig, removeAgentFromConfig } from '../config/loader.js';
import { createAgentFiles, deleteAgentFiles, discoverAgents } from './personality.js';
import type { AgentConfig, AgentRole } from '../config/defaults.js';
import { Agent } from './agent.js';

const agents = new Map<string, Agent>();

export const PRINCIPAL_ID = 'aria';

export interface CreateAgentOptions {
  soul?: string;
  description?: string;
  role?: AgentRole;
  parent?: string | null;
  team?: string | null;
  temporary?: boolean;
  /** false = modo rapido (sem thinking) */
  thinking?: boolean;
  provider?: string | null;
  model?: string | null;
  /** Perfil da biblioteca usado para compor a soul (registrado na config) */
  profile?: string | null;
}

export function initRegistry(): void {
  const config = getConfig();
  const discovered = discoverAgents();

  // First run: only the principal exists — she builds the rest
  if (discovered.length === 0) {
    createAgentFiles(PRINCIPAL_ID);
    discovered.push(PRINCIPAL_ID);
  }

  for (const agentId of discovered) {
    const existing = config.agents[agentId];

    if (!existing) {
      updateAgentInConfig(agentId, {
        name: agentId.charAt(0).toUpperCase() + agentId.slice(1),
        description: agentId === PRINCIPAL_ID
          ? 'Agente principal — sua assistente e a mae/configuradora dos demais agentes'
          : `Agente ${agentId}`,
        provider: null,
        model: null,
        enabled: true,
        role: agentId === PRINCIPAL_ID ? 'principal' : 'worker',
        parent: agentId === PRINCIPAL_ID ? null : PRINCIPAL_ID,
        team: null,
      });
    } else if (!existing.role) {
      // Migration: entries from before the hierarchy existed
      updateAgentInConfig(agentId, {
        ...existing,
        role: agentId === PRINCIPAL_ID ? 'principal' : 'worker',
        parent: agentId === PRINCIPAL_ID ? null : PRINCIPAL_ID,
        team: existing.team ?? null,
      });
    }

    agents.set(agentId, new Agent(agentId));
  }
}

export function getAgent(agentId: string): Agent | undefined {
  return agents.get(agentId);
}

export function listAgents(): Agent[] {
  return Array.from(agents.values());
}

export function listAgentIds(): string[] {
  return Array.from(agents.keys());
}

export function agentExists(agentId: string): boolean {
  return agents.has(agentId);
}

// --- Hierarchy helpers ---

export function getAgentConfig(agentId: string): AgentConfig | undefined {
  return getConfig().agents[agentId];
}

export function getRole(agentId: string): AgentRole {
  return getAgentConfig(agentId)?.role ?? 'worker';
}

/**
 * True when `superiorId` is above `agentId` in the hierarchy:
 * the principal is above everyone; otherwise walk the parent chain.
 */
export function isSuperiorOf(superiorId: string, agentId: string): boolean {
  if (superiorId === agentId) return false;
  if (getRole(superiorId) === 'principal') return true;

  const config = getConfig();
  let current = config.agents[agentId]?.parent ?? null;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    if (current === superiorId) return true;
    seen.add(current);
    current = config.agents[current]?.parent ?? null;
  }
  return false;
}

export function getDirectSubordinates(agentId: string): string[] {
  const config = getConfig();
  return Object.keys(config.agents).filter(id => config.agents[id].parent === agentId);
}

export function getTeamMembers(team: string): string[] {
  const config = getConfig();
  return Object.keys(config.agents).filter(id => config.agents[id].team === team);
}

export function listTeams(): string[] {
  const config = getConfig();
  const teams = new Set<string>();
  for (const id of Object.keys(config.agents)) {
    const t = config.agents[id].team;
    if (t) teams.add(t);
  }
  return Array.from(teams).sort();
}

// --- Creation / deletion ---

export function createAgent(agentId: string, opts: CreateAgentOptions = {}): Agent {
  const id = agentId.toLowerCase().replace(/[^a-z0-9_-]/g, '');

  if (!id) {
    throw new Error('Nome de agente invalido.');
  }
  if (agents.has(id)) {
    throw new Error(`Agente "${id}" ja existe.`);
  }

  createAgentFiles(id, opts.soul);

  updateAgentInConfig(id, {
    name: id.charAt(0).toUpperCase() + id.slice(1),
    description: opts.description ?? `Agente ${id}`,
    provider: opts.provider ?? null,
    model: opts.model ?? null,
    enabled: true,
    role: opts.role ?? 'worker',
    parent: opts.parent ?? PRINCIPAL_ID,
    team: opts.team ?? null,
    ...(opts.temporary ? { temporary: true } : {}),
    ...(opts.thinking === false ? { thinking: false } : {}),
    ...(opts.profile ? { profile: opts.profile } : {}),
  });

  const agent = new Agent(id);
  agents.set(id, agent);
  return agent;
}

/**
 * Deletes an agent. `requesterId` (when given, i.e. agent-initiated) must be
 * a superior of the target. The principal can never be deleted.
 */
export function deleteAgent(agentId: string, requesterId?: string): void {
  if (getRole(agentId) === 'principal') {
    throw new Error('Nao e possivel deletar o agente principal.');
  }
  if (!agents.has(agentId)) {
    throw new Error(`Agente "${agentId}" nao encontrado.`);
  }
  if (requesterId && !isSuperiorOf(requesterId, agentId)) {
    throw new Error(`Voce so pode deletar agentes abaixo de voce na hierarquia.`);
  }

  // Re-parent orphaned subordinates to the deleted agent's parent
  const parentOfDeleted = getAgentConfig(agentId)?.parent ?? PRINCIPAL_ID;
  for (const subId of getDirectSubordinates(agentId)) {
    const sub = getAgentConfig(subId);
    if (sub) {
      updateAgentInConfig(subId, { ...sub, parent: parentOfDeleted });
    }
  }

  agents.delete(agentId);
  deleteAgentFiles(agentId);
  removeAgentFromConfig(agentId);
}
