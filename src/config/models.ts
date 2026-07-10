export interface ModelInfo {
  id: string;
  name: string;
  provider: 'deepseek' | 'zai' | 'openai' | 'anthropic' | 'google' | 'nvidia';
  description: string;
}

export const MODEL_CATALOG: ModelInfo[] = [
  // DeepSeek (deepseek-chat/deepseek-reasoner serao descontinuados em
  // 2026-07-24; ambos ja equivaliam a modos do V4 Flash)
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'deepseek', description: 'Modelo principal, pensa antes de responder por padrao, contexto de 1M tokens' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'deepseek', description: 'O mais capaz da DeepSeek, ideal para tarefas complexas' },

  // Z.AI (GLM)
  { id: 'glm-5.2', name: 'GLM-5.2', provider: 'zai', description: 'Modelo topo de linha da Z.AI' },
  { id: 'glm-5.1', name: 'GLM-5.1', provider: 'zai', description: 'Muito capaz, bom equilibrio custo/qualidade' },
  { id: 'glm-4.6', name: 'GLM-4.6', provider: 'zai', description: 'Otimo em codigo e agentes, contexto de 200K' },
  { id: 'glm-4.5-air', name: 'GLM-4.5 Air', provider: 'zai', description: 'Leve e barato, bom para tarefas simples' },
  { id: 'glm-4.5-flash', name: 'GLM-4.5 Flash', provider: 'zai', description: 'Gratuito, rapido para uso geral' },

  // Anthropic
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', provider: 'anthropic', description: 'O mais inteligente da Anthropic' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', provider: 'anthropic', description: 'Muito inteligente, bom equilibrio custo/qualidade' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'anthropic', description: 'Rapido e barato, bom para tarefas simples' },

  // OpenAI
  { id: 'gpt-5.1', name: 'GPT-5.1', provider: 'openai', description: 'Modelo topo de linha da OpenAI' },
  { id: 'gpt-5-mini', name: 'GPT-5 Mini', provider: 'openai', description: 'Rapido e economico' },
  { id: 'gpt-5-nano', name: 'GPT-5 Nano', provider: 'openai', description: 'Ultra-leve, o mais barato da OpenAI' },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', description: 'Geracao anterior, ainda muito capaz' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', description: 'Geracao anterior, barato' },

  // Google
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', provider: 'google', description: 'O mais inteligente do Google' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google', description: 'Muito capaz, contexto enorme' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google', description: 'Rapido e eficiente' },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', provider: 'google', description: 'O mais economico do Google' },

  // NVIDIA
  { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', provider: 'nvidia', description: 'Muito capaz, bom para tarefas complexas' },
  { id: 'nvidia/llama-3.3-nemotron-super-49b-v1', name: 'Nemotron Super 49B', provider: 'nvidia', description: 'Equilibrio eficiencia e precisao' },
  { id: 'nvidia/nemotron-3-nano-30b-a3b', name: 'Nemotron 3 Nano (30B)', provider: 'nvidia', description: 'MoE eficiente para codigo e raciocinio' },
  { id: 'nvidia/nemotron-3-super-120b-a12b', name: 'Nemotron 3 Super (120B)', provider: 'nvidia', description: 'MoE hibrido com contexto de 1M' },
];

export const PROVIDER_ENV_KEYS: Record<ModelInfo['provider'], string> = {
  deepseek: 'DEEPSEEK_API_KEY',
  zai: 'ZAI_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
};

export function getAvailableModels(): ModelInfo[] {
  return MODEL_CATALOG.filter(m => !!process.env[PROVIDER_ENV_KEYS[m.provider]]);
}

export function findModel(idOrNumber: string, available: ModelInfo[]): ModelInfo | undefined {
  const num = parseInt(idOrNumber, 10);
  if (!isNaN(num) && num >= 1 && num <= available.length) {
    return available[num - 1];
  }
  return available.find(m => m.id === idOrNumber || m.name.toLowerCase() === idOrNumber.toLowerCase());
}

export function getProviderLabel(provider: string): string {
  switch (provider) {
    case 'deepseek': return 'DeepSeek';
    case 'zai': return 'Z.AI';
    case 'openai': return 'OpenAI';
    case 'anthropic': return 'Anthropic';
    case 'google': return 'Google';
    case 'nvidia': return 'NVIDIA';
    default: return provider;
  }
}
