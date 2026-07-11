/**
 * Agent Roles Icons Library
 * Ícones customizados para os diferentes papéis de Agentes.
 *
 * Estilo: traço Lucide (stroke herdado via CSS) + camadas "duotone" com
 * fill="currentColor" e opacidade baixa para dar profundidade.
 * A Aria tem um emblema próprio com gradiente (defs inline; os ids são
 * reescritos por instância em createIcons para evitar colisão).
 */

window.AgentVectors = {
  // Aria (principal) — emblema: hexágono + núcleo estrela com gradiente e faíscas
  aria: `
    <defs>
      <linearGradient id="ariaGrad" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#6366f1"/>
        <stop offset="0.55" stop-color="#8b5cf6"/>
        <stop offset="1" stop-color="#d946ef"/>
      </linearGradient>
    </defs>
    <path d="M12 2.4l8.31 4.8v9.6L12 21.6l-8.31-4.8V7.2z" stroke="url(#ariaGrad)"/>
    <path d="M12 7.2l1.3 3.5 3.5 1.3-3.5 1.3-1.3 3.5-1.3-3.5-3.5-1.3 3.5-1.3z" fill="url(#ariaGrad)" stroke="none"/>
    <circle cx="16.9" cy="6.2" r="0.9" fill="url(#ariaGrad)" stroke="none"/>
    <circle cx="7.1" cy="17.8" r="0.7" fill="url(#ariaGrad)" stroke="none"/>`,

  // Generic (fallback) — orbe amigável com antena de faísca; para agentes sem ramo definido
  generic: `
    <circle cx="12" cy="13.5" r="6.5" fill="currentColor" opacity="0.1" stroke="none"/>
    <circle cx="12" cy="13.5" r="6.5"/>
    <path d="M9.6 13.2h.01"/>
    <path d="M14.4 13.2h.01"/>
    <path d="M9.7 15.9c.6.7 1.4 1.05 2.3 1.05s1.7-.35 2.3-1.05"/>
    <path d="M12 7v-1"/>
    <path d="M12 2.2l.55 1.25L13.8 4l-1.25.55L12 5.8l-.55-1.25L10.2 4l1.25-.55z" fill="currentColor" stroke="none"/>`,

  // Assistant - Rosto de robô amigável simplificado
  assistant: '<rect x="4" y="6" width="16" height="12" rx="2" fill="currentColor" opacity="0.08" stroke="none"/><rect x="4" y="6" width="16" height="12" rx="2"/><path d="M8 10h.01"/><path d="M16 10h.01"/><path d="M8 14h8"/><path d="M12 2v4"/><path d="M8 2h8"/>',

  // Investigator - Lupa sobre um documento
  investigator: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><circle cx="11.5" cy="14.5" r="2.5" fill="currentColor" opacity="0.15"/><circle cx="11.5" cy="14.5" r="2.5"/><path d="M13.27 16.27L16 19"/>',

  // Historian - Ampulheta
  historian: '<path d="M18 2H6"/><path d="M6 22h12"/><path d="M18 2l-6 8.5L6 2"/><path d="M6 22l6-8.5 6 8.5"/><path d="M12 10.5v3"/><path d="M6 22l6-8.5 6 8.5z" fill="currentColor" opacity="0.12" stroke="none"/>',

  // Critic - Círculo com X
  critic: '<circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.08" stroke="none"/><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/>',

  // Coder - Brackets com prompt
  coder: '<path d="M8 6L2 12l6 6"/><path d="M16 6l6 6-6 6"/><path d="M10 18h4"/><path d="M13.5 5l-3 14" opacity="0.45"/>',

  // Reviewer - Prancheta com olho
  reviewer: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M15 2H9v4h6V2z"/><path d="M12 15c-2.5 0-4.5-1.5-6-3 1.5-1.5 3.5-3 6-3s4.5 1.5 6 3c-1.5 1.5-3.5 3-6 3z" fill="currentColor" opacity="0.12"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',

  // Planner - Blocos conectados (um bloco preenchido)
  planner: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1" fill="currentColor" opacity="0.25" stroke="none"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="9" y="15" width="6" height="6" rx="1"/><path d="M6 9v3h6v3"/><path d="M18 9v3h-6"/>',

  // Executor - Raio / Energia
  executor: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor" opacity="0.15"/><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',

  // Creative - Lâmpada (com brilho preenchido)
  creative: '<path d="M12 2c-3.31 0-6 2.69-6 6 0 2.05 1.05 3.84 2.63 4.96C9.64 13.68 10 14.54 10 15v2h4v-2c0-.46.36-1.32 1.37-2.04C16.95 11.84 18 10.05 18 8c0-3.31-2.69-6-6-6z" fill="currentColor" opacity="0.12"/><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2c-3.31 0-6 2.69-6 6 0 2.05 1.05 3.84 2.63 4.96C9.64 13.68 10 14.54 10 15v2h4v-2c0-.46.36-1.32 1.37-2.04C16.95 11.84 18 10.05 18 8c0-3.31-2.69-6-6-6z"/><path d="M12 6v2"/><path d="M9 8h6"/>',

  // Writer - Pena (Feather)
  writer: '<path d="M20.24 3.76a6 6 0 0 0-8.49 0L3 12.5V21h8.5l8.74-8.74a6 6 0 0 0 0-8.5z" fill="currentColor" opacity="0.1"/><path d="M20.24 3.76a6 6 0 0 0-8.49 0L3 12.5V21h8.5l8.74-8.74a6 6 0 0 0 0-8.5z"/><path d="M16 8l-4 4"/><path d="M12 12l-4 4"/>',

  // Translator - Globo
  translator: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" fill="currentColor" opacity="0.1"/>',

  // Analyst - Gráfico de linha com lupa
  analyst: '<path d="M3 3v18h18"/><path d="M7 14l4-4 4 4"/><circle cx="17" cy="8" r="2" fill="currentColor" opacity="0.2"/><circle cx="17" cy="8" r="2"/><path d="M18.5 9.5L21 12"/>',

  // DevOps - Loop infinito
  devops: '<path d="M8 8a4 4 0 1 0 0 8 4 4 0 0 0 4-4 4 4 0 0 1 4-4 4 4 0 1 1 0 8 4 4 0 0 1-4-4"/><circle cx="8" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="1" fill="currentColor" stroke="none"/>',

  // Security - Escudo com check
  security: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="currentColor" opacity="0.1"/><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',

  // Tester - Inseto (Bug)
  tester: '<path d="M12 20a6 6 0 0 1-6-6V9a6 6 0 0 1 12 0v5a6 6 0 0 1-6 6z" fill="currentColor" opacity="0.1"/><path d="M8 9h8"/><path d="M9 13h6"/><path d="M12 20a6 6 0 0 1-6-6V9a6 6 0 0 1 12 0v5a6 6 0 0 1-6 6z"/><path d="M12 4v1"/><path d="M15 2v2"/><path d="M9 2v2"/><path d="M4 10l2 1"/><path d="M18 11l2-1"/><path d="M5 16l1-1"/><path d="M18 15l1 1"/>',

  // Summarizer - Linhas comprimindo
  summarizer: '<path d="M4 6h16"/><path d="M6 12h12"/><path d="M8 18h8"/><path d="M12 6v12"/><path d="M9 15l3 3 3-3"/>',

  // Debugger - Chave de boca
  debugger: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" fill="currentColor" opacity="0.1"/><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',

  // Architect - Esquadro/Compasso
  architect: '<path d="M12 3l-9 18h18z" fill="currentColor" opacity="0.08"/><path d="M12 3l-9 18h18z"/><path d="M9 12h6"/><path d="M12 6v6"/>',

  // SEO - Alvo
  seo: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>',

  // Math - Símbolo Pi e operações
  math: '<path d="M4 7h16"/><path d="M7 7v11"/><path d="M17 7v8a3 3 0 0 0 3 3"/><path d="M4 14l4-4"/><path d="M8 14l-4-4"/>',

  // Legal - Balança da justiça
  legal: '<path d="M12 2v20"/><path d="M4 6h16"/><path d="M4 6l-2 6c0 1.1.9 2 2 2s2-.9 2-2l-2-6z" fill="currentColor" opacity="0.12"/><path d="M4 6l-2 6c0 1.1.9 2 2 2s2-.9 2-2l-2-6z"/><path d="M20 6l-2 6c0 1.1.9 2 2 2s2-.9 2-2l-2-6z" fill="currentColor" opacity="0.12"/><path d="M20 6l-2 6c0 1.1.9 2 2 2s2-.9 2-2l-2-6z"/><path d="M8 22h8"/>',

  // HR - Pessoas
  hr: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4" fill="currentColor" opacity="0.12"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',

  // Sales - Gráfico de barras subindo
  sales: '<path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/><path d="M2 22h20"/><circle cx="18" cy="4" r="2" fill="currentColor" stroke="none"/>',

  // Marketing - Megafone
  marketing: '<path d="M3 11l18-5v12L3 14v-3z" fill="currentColor" opacity="0.1"/><path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',

  // Finance - Cifrão em círculo
  finance: '<circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.08" stroke="none"/><circle cx="12" cy="12" r="9"/><path d="M12 6.8v10.4"/><path d="M14.8 9.2c-.5-1-1.6-1.6-2.8-1.6-1.7 0-3 .9-3 2.2 0 3 5.8 1.4 5.8 4.4 0 1.3-1.3 2.2-3 2.2-1.4 0-2.5-.6-3-1.7"/>',

  // Support - Headset
  support: '<path d="M3 16V11a9 9 0 0 1 18 0v5"/><path d="M19 16v3a2 2 0 0 1-2 2h-1"/><rect x="19" y="14" width="4" height="6" rx="2" fill="currentColor" opacity="0.2"/><rect x="19" y="14" width="4" height="6" rx="2"/><rect x="1" y="14" width="4" height="6" rx="2" fill="currentColor" opacity="0.2"/><rect x="1" y="14" width="4" height="6" rx="2"/>',

  // Mentor - Chapéu de graduação
  mentor: '<path d="M12 14l9-5-9-5-9 5 9 5z" fill="currentColor" opacity="0.12"/><path d="M22 10v6"/><path d="M12 14l9-5-9-5-9 5 9 5z"/><path d="M6 10.6V16a6 6 0 0 0 12 0v-5.4"/>',

  // Ethical - Coração com check
  ethical: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" fill="currentColor" opacity="0.1"/><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/><path d="M9 12l2 2 4-4"/>',

  // Formatter - Alinhamento de texto
  formatter: '<path d="M3 6h18"/><path d="M3 12h12"/><path d="M3 18h15"/>',

  // Scraper - Teia
  scraper: '<circle cx="12" cy="12" r="10"/><path d="M12 2v20"/><path d="M2 12h20"/><path d="M5 5l14 14"/><path d="M19 5L5 19"/><circle cx="12" cy="12" r="6" fill="currentColor" opacity="0.08"/><circle cx="12" cy="12" r="6"/>',

  // Database - Pilha de discos
  database: '<ellipse cx="12" cy="5" rx="9" ry="3" fill="currentColor" opacity="0.15"/><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4.03 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/>'
};

window.dsAgent = {
  _seq: 0,

  createIcons(options = {}) {
    const selector = options.selector || '[data-agent-icon]';
    const elements = document.querySelectorAll(selector);

    elements.forEach(element => {
      const role = element.getAttribute('data-agent-icon');
      const innerPath = window.AgentVectors[role] || window.AgentVectors.generic;

      let svgString = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${innerPath}</svg>`;

      // Ids de defs (gradientes) precisam ser únicos por instância no documento
      if (svgString.includes('id="')) {
        const suffix = '-i' + (++this._seq);
        svgString = svgString.replace(/\b(id="|url\(#)([A-Za-z][\w-]*)/g, (m, pre, name) => pre + name + suffix);
      }

      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = svgString.trim();
      const svgNode = tempDiv.firstChild;

      const classes = Array.from(element.classList);
      svgNode.classList.add(...classes);

      if (!svgNode.classList.contains('ds-agent-icon')) {
        svgNode.classList.add('ds-agent-icon');
      }
      svgNode.classList.add(`ds-agent-icon--${role}`);

      Array.from(element.attributes).forEach(attr => {
        if (!['data-agent-icon', 'class'].includes(attr.name)) {
          svgNode.setAttribute(attr.name, attr.value);
        }
      });

      element.parentNode.replaceChild(svgNode, element);
    });
  }
};
