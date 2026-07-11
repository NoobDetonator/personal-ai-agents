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
