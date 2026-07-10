/**
 * AI Models Library
 * Banco de dados (Single Source of Truth) para os modelos suportados pelo sistema.
 */

window.AI_MODELS = [
  // Google Models
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "google",
    icon: "google",
    tier: "Advanced",
    context: "2M Tokens",
    description: "Alta performance, raciocínio avançado, multimodelo nativo. Ideal para tarefas complexas de lógica e código.",
    badgeClass: "ds-ai-badge--google"
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "google",
    icon: "google",
    tier: "Fast",
    context: "1M Tokens",
    description: "Versão otimizada para velocidade e custo-benefício. Perfeito para agentes de rotina e uso intenso.",
    badgeClass: "ds-ai-badge--google"
  },
  
  // OpenAI Models
  {
    id: "gpt-4o",
    name: "GPT-4 Omni",
    provider: "openai",
    icon: "openai",
    tier: "Advanced",
    context: "128k Tokens",
    description: "Modelo multimodal unificado da OpenAI. Extremamente versátil e rápido em todas as tarefas criativas.",
    badgeClass: "ds-ai-badge--openai"
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    icon: "openai",
    tier: "Fast",
    context: "128k Tokens",
    description: "Inteligência do GPT-4o em uma versão mais leve, rápida e barata.",
    badgeClass: "ds-ai-badge--openai"
  },

  // Anthropic Models
  {
    id: "claude-3-5-sonnet",
    name: "Claude 3.5 Sonnet",
    provider: "anthropic",
    icon: "anthropic",
    tier: "Advanced",
    context: "200k Tokens",
    description: "Velocidade impressionante com capacidade de codificação e raciocínio superior, ideal para programação complexa.",
    badgeClass: "ds-ai-badge--anthropic"
  },
  {
    id: "claude-3-opus",
    name: "Claude 3 Opus",
    provider: "anthropic",
    icon: "anthropic",
    tier: "Premium",
    context: "200k Tokens",
    description: "O modelo mais potente da Anthropic para análises profundas e tarefas prolongadas.",
    badgeClass: "ds-ai-badge--anthropic"
  },

  // Meta Models
  {
    id: "llama-3-70b",
    name: "Llama 3 (70B)",
    provider: "meta",
    icon: "meta",
    tier: "Open",
    context: "8k Tokens",
    description: "Modelo open-weights de alta capacidade da Meta, rodando localmente ou via provedores cloud.",
    badgeClass: "ds-ai-badge--meta"
  },

  // Mistral
  {
    id: "mistral-large",
    name: "Mistral Large",
    provider: "mistral",
    icon: "mistral",
    tier: "Advanced",
    context: "32k Tokens",
    description: "Modelo flagship da Mistral, excelente para raciocínio lógico em múltiplos idiomas.",
    badgeClass: "ds-ai-badge--mistral"
  },

  // Generic/Custom Bot
  {
    id: "custom-agent-1",
    name: "Local Bot (Fine-Tuned)",
    provider: "local",
    icon: "generic",
    tier: "Custom",
    context: "Varia",
    description: "Seu próprio modelo treinado ou rodando localmente na sua máquina.",
    badgeClass: "ds-ai-badge--generic"
  }
];

window.dsAI_Renderer = {
  /**
   * Gera o HTML de um badge de modelo
   */
  renderBadge(modelId) {
    const model = window.AI_MODELS.find(m => m.id === modelId) || window.AI_MODELS[window.AI_MODELS.length - 1];
    return `
      <span class="ds-ai-badge ${model.badgeClass}" title="${model.name}">
        <i data-ai-icon="${model.icon}" class="ds-ai-icon"></i>
        ${model.name}
      </span>
    `;
  },

  /**
   * Renderiza a grade de cards no Showroom
   */
  renderShowroomGrid(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let html = '';
    window.AI_MODELS.forEach(model => {
      html += `
        <div class="ds-card ds-card--interactive">
          <div class="ds-card__header" style="margin-bottom:8px;">
            <div class="ds-inline ds-inline-md">
              <div class="ds-avatar ds-avatar--sm" style="background:var(--ai-${model.icon === 'generic' ? 'generic' : model.provider}-bg); color:var(--ai-${model.icon === 'generic' ? 'generic' : model.provider}-color);">
                <i data-ai-icon="${model.icon}" class="ds-ai-icon" style="width:20px;height:20px;"></i>
              </div>
              <h4 class="ds-heading-md">${model.name}</h4>
            </div>
          </div>
          <div class="ds-card__body">
            <p class="ds-caption ds-text-muted" style="margin-bottom:16px;">${model.description}</p>
            <div class="ds-inline ds-cluster ds-cluster-sm">
              <span class="ds-badge ds-badge--brand">${model.tier}</span>
              <span class="ds-badge"><i data-lucide="layers" style="width:12px;height:12px;margin-right:4px;"></i> ${model.context}</span>
            </div>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }
};
