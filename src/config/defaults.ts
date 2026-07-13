import { z } from 'zod';

export type AgentRole = 'principal' | 'manager' | 'worker';

export interface AgentConfig {
  name: string;
  description: string;
  provider: string | null;
  model: string | null;
  enabled: boolean;
  role: AgentRole;
  parent: string | null;
  team: string | null;
  temporary?: boolean;
  /** false = modo rapido (DeepSeek sem thinking); ausente/true = padrao */
  thinking?: boolean;
  /** Perfil da biblioteca (skills/system-prompter/perfis) usado para compor a soul */
  profile?: string | null;
  /** Hash curto do conteudo exato do perfil usado na composicao */
  profileRevision?: string | null;
}

export interface AppConfig {
  version: number;
  ai: {
    provider: 'deepseek' | 'zai' | 'openai' | 'anthropic' | 'google' | 'nvidia';
    model: string;
    maxOutputTokens: number;
    temperature: number;
  };
  defaultAgent: string;
  search: {
    maxResults: number;
    braveSearch: {
      enabled: boolean;
    };
  };
  fileOps: {
    allowedPaths: string[];
    blockedExtensions: string[];
    maxFileSizeKB: number;
    confirmDestructive: boolean;
  };
  shell: {
    mode: 'confirm' | 'auto' | 'off';
    allowlist: string[];
    timeoutSec: number;
  };
  memory: {
    nudgeEvery: number;
    recall: boolean;
  };
  delegation: {
    timeoutSec: number;
    concurrency: number;
  };
  user: {
    onboarded: boolean;
  };
  obsidian: {
    vaultPath: string | null;
  };
  heartbeat: {
    enabled: boolean;
    intervalMin: number;
    agent: string;
    prompt: string;
  };
  web: {
    enabled: boolean;
    port: number;
    publicUrl: string | null;
    trustProxy: boolean;
    sessionTtlMinutes: number;
    capabilities: {
      chat: boolean;
      files: boolean;
      memory: boolean;
      settings: boolean;
    };
  };
  mcp: {
    servers: Record<string, { command: string; args?: string[]; env?: Record<string, string> } | { url: string }>;
  };
  scheduler: {
    enabled: boolean;
    timezone: string;
  };
  display: {
    language: string;
    showTokenUsage: boolean;
    showToolCalls: boolean;
    maxHistoryMessages: number;
  };
  groupChat: {
    maxRounds: number;
    convergenceThreshold: number;
    enableSessionFile: boolean;
  };
  agents: Record<string, AgentConfig>;
}

// Valida a config carregada do disco. Espelha AppConfig; campos extras sao
// tolerados (validacao apenas), mas valores com tipo errado rejeitam o load.
const AGENT_SCHEMA = z.object({
  name: z.string(),
  description: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  enabled: z.boolean(),
  role: z.enum(['principal', 'manager', 'worker']),
  parent: z.string().nullable(),
  team: z.string().nullable(),
  temporary: z.boolean().optional(),
  thinking: z.boolean().optional(),
  profile: z.string().nullable().optional(),
  profileRevision: z.string().nullable().optional(),
});

export const CONFIG_SCHEMA = z.object({
  version: z.number().int().positive(),
  ai: z.object({
    provider: z.enum(['deepseek', 'zai', 'openai', 'anthropic', 'google', 'nvidia']),
    model: z.string(),
    maxOutputTokens: z.number().int().positive(),
    temperature: z.number().min(0).max(2),
  }),
  defaultAgent: z.string(),
  search: z.object({
    maxResults: z.number().int().positive(),
    braveSearch: z.object({ enabled: z.boolean() }),
  }),
  fileOps: z.object({
    allowedPaths: z.array(z.string()),
    blockedExtensions: z.array(z.string()),
    maxFileSizeKB: z.number().positive(),
    confirmDestructive: z.boolean(),
  }),
  shell: z.object({
    mode: z.enum(['confirm', 'auto', 'off']),
    allowlist: z.array(z.string()),
    timeoutSec: z.number().positive(),
  }),
  memory: z.object({
    nudgeEvery: z.number().int().positive(),
    recall: z.boolean(),
  }),
  delegation: z.object({
    timeoutSec: z.number().positive(),
    concurrency: z.number().int().positive(),
  }),
  user: z.object({ onboarded: z.boolean() }),
  obsidian: z.object({ vaultPath: z.string().nullable() }),
  heartbeat: z.object({
    enabled: z.boolean(),
    intervalMin: z.number().positive(),
    agent: z.string(),
    prompt: z.string(),
  }),
  web: z.object({
    enabled: z.boolean(),
    port: z.number().int().min(1).max(65535),
    publicUrl: z.string().url().startsWith('https://').nullable(),
    trustProxy: z.boolean(),
    sessionTtlMinutes: z.number().positive().max(10080),
    capabilities: z.object({
      chat: z.boolean(),
      files: z.boolean(),
      memory: z.boolean(),
      settings: z.boolean(),
    }),
  }),
  mcp: z.object({
    servers: z.record(
      z.string(),
      z.union([
        z.object({
          command: z.string(),
          args: z.array(z.string()).optional(),
          env: z.record(z.string(), z.string()).optional(),
        }),
        z.object({ url: z.string() }),
      ]),
    ),
  }),
  scheduler: z.object({
    enabled: z.boolean(),
    timezone: z.string(),
  }),
  display: z.object({
    language: z.string(),
    showTokenUsage: z.boolean(),
    showToolCalls: z.boolean(),
    maxHistoryMessages: z.number().int().positive(),
  }),
  groupChat: z.object({
    maxRounds: z.number().int().positive(),
    convergenceThreshold: z.number(),
    enableSessionFile: z.boolean(),
  }),
  agents: z.record(z.string(), AGENT_SCHEMA),
});

export const DEFAULT_CONFIG: AppConfig = {
  version: 1,
  ai: {
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    maxOutputTokens: 8192,
    temperature: 0.7,
  },
  defaultAgent: 'aria',
  search: {
    maxResults: 5,
    braveSearch: {
      enabled: true,
    },
  },
  fileOps: {
    allowedPaths: ['./workspace'],
    blockedExtensions: ['.exe', '.bat', '.cmd', '.ps1', '.sh', '.dll'],
    maxFileSizeKB: 512,
    confirmDestructive: true,
  },
  shell: {
    mode: 'confirm',
    allowlist: [
      'dir',
      'ls',
      'git status',
      'git log',
      'git diff',
      'node -v',
      'npm -v',
      'npm test',
      'npm run',
    ],
    timeoutSec: 60,
  },
  memory: {
    nudgeEvery: 15,
    recall: true,
  },
  delegation: {
    timeoutSec: 300,
    concurrency: 3,
  },
  user: {
    onboarded: false,
  },
  obsidian: {
    vaultPath: null,
  },
  heartbeat: {
    enabled: false,
    intervalMin: 30,
    agent: 'aria',
    prompt: 'Revise as tarefas abertas do board e as mensagens nao lidas entre agentes. Conclua ou encaminhe o que der. Delete agentes temporarios ociosos cujo trabalho ja terminou.',
  },
  web: {
    enabled: true,
    port: 3131,
    publicUrl: null,
    trustProxy: false,
    sessionTtlMinutes: 480,
    capabilities: {
      chat: true,
      files: true,
      memory: true,
      settings: true,
    },
  },
  mcp: {
    servers: {},
  },
  scheduler: {
    enabled: true,
    timezone: 'America/Sao_Paulo',
  },
  display: {
    language: 'pt-BR',
    showTokenUsage: true,
    showToolCalls: false,
    maxHistoryMessages: 30,
  },
  groupChat: {
    maxRounds: 3,
    convergenceThreshold: 80,
    enableSessionFile: true,
  },
  agents: {
    aria: {
      name: 'Aria',
      description: 'Agente principal — sua assistente e a mae/configuradora dos demais agentes',
      provider: null,
      model: null,
      enabled: true,
      role: 'principal',
      parent: null,
      team: null,
    },
  },
};
