/**
 * AI Icons Library
 * SVGs estilizados para provedores de Inteligência Artificial.
 * Desenhados para combinar com a estética da Lucide Icons.
 */

const AIVectors = {
  // OpenAI (ChatGPT) - Estilizado como um símbolo circular espiral/floral
  openai: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 12a10.06 10.06 1 0 0-2-6 10 10 0 0 0-14 0 10.06 10.06 1 0 0-2 6 10 10 0 0 0 2 6 10.06 10.06 1 0 0 14 0A10 10 0 0 0 22 12Z"/>
      <path d="M12 2v20"/>
      <path d="M4.3 6.3l15.4 11.4"/>
      <path d="M19.7 6.3L4.3 17.7"/>
      <circle cx="12" cy="12" r="4"/>
    </svg>
  `,

  // Google (Gemini) - Estrela de 4 pontas
  google: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2C12 7.523 16.477 12 22 12C16.477 12 12 16.477 12 22C12 16.477 7.523 12 2 12C7.523 12 12 7.523 12 2Z"/>
      <path d="M20 3C20 4.657 21.343 6 23 6C21.343 6 20 7.343 20 9C20 7.343 18.657 6 17 6C18.657 6 20 4.657 20 3Z"/>
      <path d="M5 19C5 19.552 5.448 20 6 20C6.552 20 7 19.552 7 19C7 18.448 6.552 18 6 18C5.448 18 5 18.448 5 19Z"/>
    </svg>
  `,

  // Anthropic (Claude) - Estrela / Asterisco serifado ou A estilizado (Asterisco elegante)
  anthropic: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3v18"/>
      <path d="M4.2 7.5l15.6 9"/>
      <path d="M19.8 7.5l-15.6 9"/>
      <circle cx="12" cy="12" r="3" fill="currentColor"/>
    </svg>
  `,

  // Meta (Llama) - Loop do infinito estilizado
  meta: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <path d="M15 10c0-1.657-1.343-3-3-3s-3 1.343-3 3c0 3 6 3 6 6 0 1.657-1.343 3-3 3s-3-1.343-3-3"/>
      <path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 9 9 9 9 0 0 1-9 9 9 9 0 0 1-9-9z"/>
    </svg>
  `,
  
  // Llama (específico) - Um rosto de lhama abstrato
  llama: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7 3v8c0 2 2 3 5 3s5-1 5-3V3"/>
      <path d="M5 8h14"/>
      <path d="M9 14v7"/>
      <path d="M15 14v7"/>
      <circle cx="9" cy="7" r="1" fill="currentColor"/>
      <circle cx="15" cy="7" r="1" fill="currentColor"/>
    </svg>
  `,

  // Mistral - M com pico de montanha / vento
  mistral: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 21V7l6-4 3 4 3-4 6 4v14"/>
      <path d="M3 14l9-6 9 6"/>
      <path d="M12 8v13"/>
    </svg>
  `,

  // Generic / Custom Bot - Rosto robótico / Cérebro
  generic: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2a2 2 0 0 1 2 2v2a8 8 0 0 1 8 8v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a8 8 0 0 1 8-8V4a2 2 0 0 1 2-2z"/>
      <path d="M8 12h.01"/>
      <path d="M16 12h.01"/>
      <path d="M8 16h8"/>
    </svg>
  `,

  // DeepSeek - Baleia estilizada (mascote da marca), traço minimal
  deepseek: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 13c0-3 2.5-6 7-6 3 0 4 1 6 1 2.5 0 4.5-1.5 5-3-1 4-3 5-3 5s2 1 3 3c-2-1-3-.5-4 .5-1.5 1.5-4 2.5-7 2.5-4 0-7-1-7-3z"/>
      <circle cx="8" cy="11" r="0.8" fill="currentColor" stroke="none"/>
      <path d="M6 16c1 1 3 2 6 2"/>
    </svg>
  `,

  // Z.AI - "Z" geometrico com faisca (GLM)
  zai: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 5h14l-14 14h14"/>
      <path d="M15 2l1.5 3L20 6.5 16.5 8 15 11l-1.5-3L10 6.5 13.5 5z"/>
    </svg>
  `,

  // NVIDIA - Olho estilizado (referencia ao logo "eye")
  nvidia: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/>
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>
    </svg>
  `
};

window.dsAI = {
  /**
   * Substitui os elementos com o atributo `data-ai-icon` pelo SVG correspondente.
   * @param {Object} options 
   */
  createIcons(options = {}) {
    const selector = options.selector || '[data-ai-icon]';
    const elements = document.querySelectorAll(selector);

    elements.forEach(element => {
      const provider = element.getAttribute('data-ai-icon');
      const svgString = AIVectors[provider] || AIVectors.generic;
      
      // Cria um container temporário para transformar a string em DOM Node
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = svgString.trim();
      const svgNode = tempDiv.firstChild;

      // Copia classes originais do elemento
      const classes = Array.from(element.classList);
      svgNode.classList.add(...classes);
      
      // Remove a classe `ds-ai-icon` original pois a adicionaremos num wrapper se necessário,
      // mas neste caso, o elemento <i> é o que vira o próprio <svg>. Vamos manter a classe no svg.
      
      // Se não tem a classe padrão, adiciona
      if (!svgNode.classList.contains('ds-ai-icon')) {
        svgNode.classList.add('ds-ai-icon');
        svgNode.classList.add(`ds-ai-icon--${provider}`);
      }

      // Copia atributos (exceto os que não devem ser copiados)
      Array.from(element.attributes).forEach(attr => {
        if (!['data-ai-icon', 'class', 'style'].includes(attr.name)) {
          svgNode.setAttribute(attr.name, attr.value);
        }
      });
      
      // Copia estilos inline
      if (element.getAttribute('style')) {
         svgNode.setAttribute('style', element.getAttribute('style'));
      }

      // Substitui no DOM
      element.parentNode.replaceChild(svgNode, element);
    });
  }
};
