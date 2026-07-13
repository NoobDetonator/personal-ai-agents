// ---------- Memórias e dados ----------

let memoryViewTab = 'vault';
let memorySearchQuery = '';
let memoryStatusFilter = '';
let memoryGraphLayer = 'all';
const MEMORY_KIND = { main: 'Memória principal', daily: 'Nota diária', deep: 'Memória profunda' };

function memoryCardsHtml(memories) {
  if (!memories.length) return `<div class="ds-empty-state"><i data-lucide="brain" class="ds-empty-state__icon"></i><h3 class="ds-empty-state__title">Nenhuma memória neste projeto</h3><p class="ds-empty-state__description">As memórias criadas pela Aria e pelos agentes aparecerão aqui.</p></div>`;
  return `<div class="memory-grid">${memories.map(memory => `
    <article class="memory-card">
      <div class="memory-card__icon"><i data-lucide="${memory.kind === 'main' ? 'brain-circuit' : memory.kind === 'daily' ? 'calendar-days' : 'book-marked'}" class="ds-icon ds-icon--md"></i></div>
      <div class="memory-card__content">
        <div class="memory-card__head"><span class="ds-badge ds-badge--info">${esc(MEMORY_KIND[memory.kind] || memory.kind)}</span><span class="ds-caption">${fmtBytes(memory.size)}</span></div>
        <h3>${esc(memory.name)}</h3>
        <p>${esc(memory.description)}</p>
        <small>Agente: ${esc(memory.agentId)} · ${fmtDate(memory.modifiedAt)}</small>
        <p class="memory-card__preview">${esc(memory.preview || 'Sem conteúdo.')}</p>
      </div>
      <div class="memory-card__actions">
        <button class="ds-btn ds-btn--outline ds-btn--sm" data-memory-open="${esc(memory.id)}"><i data-lucide="eye" class="ds-icon ds-icon--xs"></i> Abrir</button>
        <button class="ds-btn ds-btn--ghost ds-btn--icon ds-btn--sm project-danger" data-memory-delete="${esc(memory.id)}" data-memory-name="${esc(memory.name)}" title="Apagar"><i data-lucide="trash-2" class="ds-icon ds-icon--xs"></i></button>
      </div>
    </article>`).join('')}</div>`;
}
const VAULT_STATUS = {
  active: { label: 'Ativa', variant: 'success' },
  tentative: { label: 'Tentativa', variant: 'warning' },
  contested: { label: 'Contestada', variant: 'danger' },
  superseded: { label: 'Substituida', variant: 'info' },
  stale: { label: 'Obsoleta', variant: 'warning' },
  needs_review: { label: 'Revisar', variant: 'danger' },
};

function vaultCardsHtml(documents) {
  if (!documents.length) {
    return `<div class="ds-empty-state"><i data-lucide="book-dashed" class="ds-empty-state__icon"></i><h3 class="ds-empty-state__title">Nada encontrado no Vault</h3><p class="ds-empty-state__description">Ajuste a busca ou deixe a Aria registrar uma memoria profunda.</p></div>`;
  }
  return `<div class="vault-grid">${documents.map(document => {
    const status = VAULT_STATUS[document.status] || { label: document.status, variant: 'info' };
    const confidence = Math.round(Number(document.confidence || 0) * 100);
    return `
      <article class="vault-card" data-vault-status="${esc(document.status)}">
        <div class="vault-card__top">
          <span class="vault-card__type"><i data-lucide="${document.noteType === 'decision' ? 'git-pull-request-draft' : document.noteType === 'lesson' ? 'graduation-cap' : 'notebook-tabs'}" class="ds-icon ds-icon--sm"></i>${esc(document.noteType)}</span>
          <span class="ds-badge ds-badge--${status.variant}">${esc(status.label)}</span>
        </div>
        <h3>${esc(document.title)}</h3>
        <p>${esc(document.description || document.preview || 'Sem descricao.')}</p>
        <div class="vault-card__tags">${(document.tags || []).slice(0, 5).map(tag => `<span>#${esc(tag)}</span>`).join('')}</div>
        <div class="vault-card__meta">
          <span><i data-lucide="bot" class="ds-icon ds-icon--xs"></i>${esc(document.agentId)}</span>
          <span title="Confianca declarada"><i data-lucide="gauge" class="ds-icon ds-icon--xs"></i>${confidence}%</span>
          <span title="Origem"><i data-lucide="fingerprint" class="ds-icon ds-icon--xs"></i>${esc(document.sourceType)}</span>
        </div>
        <div class="vault-card__actions">
          <button class="ds-btn ds-btn--outline ds-btn--sm" data-memory-open="${esc(document.sourceRef)}"><i data-lucide="eye" class="ds-icon ds-icon--xs"></i> Abrir</button>
          <button class="ds-btn ds-btn--ghost ds-btn--sm" data-vault-feedback="useful" data-vault-document="${esc(document.id)}" data-vault-title="${esc(document.title)}"><i data-lucide="thumbs-up" class="ds-icon ds-icon--xs"></i> Util</button>
          <button class="ds-btn ds-btn--ghost ds-btn--sm project-danger" data-vault-feedback="corrected" data-vault-document="${esc(document.id)}" data-vault-title="${esc(document.title)}"><i data-lucide="message-square-warning" class="ds-icon ds-icon--xs"></i> Contestar</button>
        </div>
      </article>`;
  }).join('')}</div>`;
}

function vaultOverviewHtml(overview) {
  const feedback = overview.feedback || {};
  return `
    <div class="vault-stats">
      <div><i data-lucide="notebook-tabs"></i><span><b>${overview.total || 0}</b><small>documentos</small></span></div>
      <div><i data-lucide="share-2"></i><span><b>${overview.nodes || 0}</b><small>nos</small></span></div>
      <div><i data-lucide="git-merge"></i><span><b>${overview.edges || 0}</b><small>relacoes</small></span></div>
      <div><i data-lucide="badge-check"></i><span><b>${feedback.useful || 0}</b><small>resultados uteis</small></span></div>
    </div>`;
}

function vaultReviewHtml(overview) {
  const views = overview.views || [];
  return `
    <div class="vault-review-layout">
      <section>
        <p class="ds-eyebrow">Bases salvas</p>
        <h3 class="ds-heading-xl">Filas de curadoria</h3>
        <div class="vault-view-grid">${views.map(view => `
          <button class="vault-view-card" data-vault-view="${esc(view.id)}">
            <span>${esc(view.label)}</span><b>${view.count}</b>
            <small>${esc(view.description)}</small>
          </button>`).join('')}</div>
      </section>
      <aside class="vault-review-panel">
        <i data-lucide="shield-check" class="ds-icon ds-icon--lg"></i>
        <h3>Reflexao controlada</h3>
        <p>Resultados sao consolidados em um documento derivado e tentativo. Nada e promovido automaticamente para a memoria canonica.</p>
        <div class="vault-review-actions">
          <button class="ds-btn ds-btn--primary" id="vault-reflect"><i data-lucide="sparkles" class="ds-icon ds-icon--sm"></i> Gerar reflexao</button>
          <button class="ds-btn ds-btn--outline" id="vault-reindex"><i data-lucide="refresh-cw" class="ds-icon ds-icon--sm"></i> Reindexar tudo</button>
        </div>
      </aside>
    </div>`;
}

function graphPosition(node, index, total, width, height) {
  const memory = node.layer === 'memory';
  const centerX = memory ? width * .29 : width * .71;
  const centerY = height * .5;
  const radius = Math.min(width * .21, height * .39);
  const angle = ((index / Math.max(total, 1)) * Math.PI * 2) - Math.PI / 2;
  const drift = 0.62 + ((index * 37) % 31) / 100;
  return { x: centerX + Math.cos(angle) * radius * drift, y: centerY + Math.sin(angle) * radius * drift };
}

function knowledgeGraphHtml(graph) {
  const width = 1040, height = 560;
  const nodes = (graph.nodes || []).slice(0, 140);
  if (!nodes.length) return `<div class="ds-empty-state"><i data-lucide="orbit" class="ds-empty-state__icon"></i><h3 class="ds-empty-state__title">Grafo ainda vazio</h3><p class="ds-empty-state__description">Use Reindexar tudo para mapear as memorias e os arquivos do projeto.</p></div>`;
  const byLayer = { memory: nodes.filter(node => node.layer === 'memory'), code: nodes.filter(node => node.layer === 'code') };
  const positions = new Map();
  for (const layer of ['memory', 'code']) byLayer[layer].forEach((node, index) => positions.set(node.id, graphPosition(node, index, byLayer[layer].length, width, height)));
  const edges = (graph.edges || []).filter(edge => positions.has(edge.source_id) && positions.has(edge.target_id)).slice(0, 300);
  return `
    <div class="vault-graph-shell">
      <div class="vault-graph-legend">
        <span><i class="vault-dot vault-dot--memory"></i>Memoria</span>
        <span><i class="vault-dot vault-dot--code"></i>Codigo</span>
        <span><i class="vault-line vault-line--bridge"></i>Ponte confirmada</span>
        <span class="ds-caption">${nodes.length} nos &middot; ${edges.length} relacoes${graph.truncated ? ' &middot; visualizacao limitada' : ''}</span>
      </div>
      <div class="vault-graph-scroll">
        <svg class="vault-graph" viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafo de conhecimento do projeto">
          <g class="vault-graph__zones"><text x="28" y="34">MEMORIA</text><text x="${width - 118}" y="34">CODIGO</text></g>
          <g class="vault-graph__edges">${edges.map(edge => {
            const a = positions.get(edge.source_id), b = positions.get(edge.target_id);
            return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" class="vault-edge vault-edge--${esc(edge.layer)}"><title>${esc(edge.relation)} &middot; ${esc(edge.origin)} &middot; ${Math.round(Number(edge.confidence) * 100)}%</title></line>`;
          }).join('')}</g>
          <g class="vault-graph__nodes">${nodes.map(node => {
            const p = positions.get(node.id);
            const radius = node.kind === 'concept' || node.kind === 'tag' ? 7 : 11;
            return `<g class="vault-node vault-node--${esc(node.layer)}" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})"><circle r="${radius}"><title>${esc(node.label)} &middot; ${esc(node.kind)} &middot; ${esc(node.status)}</title></circle><text x="${radius + 5}" y="4">${esc(String(node.label).slice(0, 24))}</text></g>`;
          }).join('')}</g>
        </svg>
      </div>
    </div>`;
}

async function submitVaultFeedback(projectId, documentId, title, outcome) {
  const labels = { useful: 'Marcar como util', corrected: 'Contestar memoria' };
  openModal(`
    <div class="ds-modal__header"><h3 class="ds-modal__title">${labels[outcome]}</h3><button class="ds-modal__close" data-modal-close><i data-lucide="x" class="ds-icon ds-icon--sm"></i></button></div>
    <div class="ds-modal__body"><p>Registro para <b>${esc(title)}</b>. Esta avaliacao altera apenas o indice derivado.</p><label class="ds-label" for="vault-feedback-notes">Observacao</label><textarea class="ds-textarea" id="vault-feedback-notes" rows="4" placeholder="Por que este conhecimento foi util ou precisa de correcao?"></textarea></div>
    <div class="ds-modal__footer"><button class="ds-btn ds-btn--ghost" data-modal-close>Cancelar</button><button class="ds-btn ds-btn--primary" id="vault-feedback-submit">Registrar</button></div>`);
  $('#vault-feedback-submit')?.addEventListener('click', async () => {
    await api(`/api/projects/${encodeURIComponent(projectId)}/vault/feedback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memoryId: documentId, question: 'Revisao manual da dashboard', outcome, notes: $('#vault-feedback-notes').value }),
    });
    closeModal();
    await renderMemory();
  });
  refreshIcons();
}

function dataConversationsHtml(conversations) {
  if (!conversations.length) return `<div class="ds-empty-state"><i data-lucide="messages-square" class="ds-empty-state__icon"></i><h3 class="ds-empty-state__title">Nenhuma conversa</h3></div>`;
  return `<div class="data-list">${conversations.map(conversation => `
    <div class="data-list-row">
      <span class="data-list-row__icon"><i data-lucide="${conversation.pinned ? 'pin' : 'message-square'}" class="ds-icon ds-icon--sm"></i></span>
      <span class="data-list-row__main"><b>${esc(conversation.title || 'Conversa sem título')}</b><small>${conversation.message_count} mensagens · ${fmtDate(conversation.updated_at)}</small></span>
      ${conversation.archived ? '<span class="ds-badge ds-badge--warning">arquivada</span>' : ''}
      <button class="ds-btn ds-btn--outline ds-btn--sm" data-data-conversation-open="${esc(conversation.id)}" data-data-conversation-title="${esc(conversation.title || 'Conversa')}"><i data-lucide="external-link" class="ds-icon ds-icon--xs"></i> Abrir</button>
      <button class="ds-btn ds-btn--ghost ds-btn--icon ds-btn--sm project-danger" data-data-conversation-delete="${esc(conversation.id)}" data-data-conversation-title="${esc(conversation.title || 'Conversa')}" title="Apagar"><i data-lucide="trash-2" class="ds-icon ds-icon--xs"></i></button>
    </div>`).join('')}</div>`;
}
function auditHtml(events) {
  if (!events.length) return `<div class="ds-empty-state"><i data-lucide="scroll-text" class="ds-empty-state__icon"></i><h3 class="ds-empty-state__title">Nenhum evento auditado</h3></div>`;
  const label = { 'memory.delete': 'Memória apagada', 'memory.clear': 'Memórias limpas', 'conversation.delete': 'Conversa apagada', 'project.export': 'Dados exportados', 'settings.update': 'Configurações alteradas' };
  return `<div class="data-list">${events.map(event => `
    <div class="data-list-row audit-row">
      <span class="data-list-row__icon"><i data-lucide="shield-check" class="ds-icon ds-icon--sm"></i></span>
      <span class="data-list-row__main"><b>${esc(label[event.action] || event.action)}</b><small>${esc(event.target_type)} · ${esc(event.target_id || 'projeto')}</small></span>
      <span class="ds-caption">${fmtDate(event.created_at)}</span>
    </div>`).join('')}</div>`;
}

async function _renderMemoryLegacy() {
  if (!activeProjectId) await loadProjects();
  const view = $('#view-memory');
  const project = projectsCache.find(item => item.id === activeProjectId);
  if (!project) {
    view.innerHTML = '<div class="ds-empty-state"><h3>Selecione um projeto</h3></div>';
    return;
  }
  view.innerHTML = '<div class="file-loading"><span class="ds-spinner"></span> Carregando dados...</div>';
  const [memories, conversations, audit] = await Promise.all([
    api(`/api/projects/${encodeURIComponent(project.id)}/memories`),
    api(`/api/projects/${encodeURIComponent(project.id)}/conversations`),
    api(`/api/projects/${encodeURIComponent(project.id)}/audit`),
  ]);
  const contents = {
    memories: memoryCardsHtml(Array.isArray(memories) ? memories : []),
    conversations: dataConversationsHtml(Array.isArray(conversations) ? conversations : []),
    audit: auditHtml(Array.isArray(audit) ? audit : []),
  };
  view.innerHTML = `
    <div class="data-header">
      <div><p class="ds-eyebrow">Privacidade e controle</p><h2 class="ds-heading-2xl">Dados de ${esc(project.name)}</h2><p class="ds-body-sm ds-text-muted">Revise, exporte e remova memórias e conversas sem acessar o servidor por SSH.</p></div>
      <div class="data-header__actions">
        <a class="ds-btn ds-btn--outline" href="/api/projects/${encodeURIComponent(project.id)}/export" download><i data-lucide="download" class="ds-icon ds-icon--sm"></i> Exportar JSON</a>
        <button class="ds-btn ds-btn--danger" id="memory-clear-all"><i data-lucide="eraser" class="ds-icon ds-icon--sm"></i> Limpar memórias</button>
      </div>
    </div>
    <div class="data-tabs ov-seg" role="tablist">
      <button class="ov-seg__btn${memoryViewTab === 'memories' ? ' is-active' : ''}" data-memory-tab="memories">Memórias <span>${Array.isArray(memories) ? memories.length : 0}</span></button>
      <button class="ov-seg__btn${memoryViewTab === 'conversations' ? ' is-active' : ''}" data-memory-tab="conversations">Conversas <span>${Array.isArray(conversations) ? conversations.length : 0}</span></button>
      <button class="ov-seg__btn${memoryViewTab === 'audit' ? ' is-active' : ''}" data-memory-tab="audit">Auditoria <span>${Array.isArray(audit) ? audit.length : 0}</span></button>
    </div>
    <section class="data-content">${contents[memoryViewTab]}</section>`;

  view.querySelectorAll('[data-memory-tab]').forEach(button => button.addEventListener('click', () => { memoryViewTab = button.dataset.memoryTab; renderMemory(); }));
  view.querySelectorAll('[data-memory-open]').forEach(button => button.addEventListener('click', () => openMemoryDetail(project.id, button.dataset.memoryOpen)));
  view.querySelectorAll('[data-memory-delete]').forEach(button => button.addEventListener('click', () => openDeleteMemoryModal(project.id, button.dataset.memoryDelete, button.dataset.memoryName)));
  view.querySelectorAll('[data-data-conversation-open]').forEach(button => button.addEventListener('click', () => openChatConversation(button.dataset.dataConversationOpen, button.dataset.dataConversationTitle)));
  view.querySelectorAll('[data-data-conversation-delete]').forEach(button => button.addEventListener('click', () => openDeleteConversationModal(button.dataset.dataConversationDelete, button.dataset.dataConversationTitle, renderMemory)));
  $('#memory-clear-all')?.addEventListener('click', () => openClearMemoriesModal(project));
  refreshIcons();
}

async function renderMemory() {
  if (!activeProjectId) await loadProjects();
  const view = $('#view-memory');
  const project = projectsCache.find(item => item.id === activeProjectId);
  if (!project) {
    view.innerHTML = '<div class="ds-empty-state"><h3>Selecione um projeto</h3></div>';
    return;
  }

  view.innerHTML = '<div class="file-loading"><span class="ds-spinner"></span> Carregando Aria Vault...</div>';
  const query = new URLSearchParams({ limit: '120' });
  if (memorySearchQuery) query.set('q', memorySearchQuery);
  const savedView = {
    __review__: 'review',
    __unlinked__: 'unlinked',
    __feedback__: 'feedback',
  }[memoryStatusFilter];
  if (savedView) query.set('view', savedView);
  else if (memoryStatusFilter) query.set('status', memoryStatusFilter);

  const [vaultResult, overviewResult, conversations, audit, graphResult] = await Promise.all([
    api(`/api/projects/${encodeURIComponent(project.id)}/vault?${query}`),
    api(`/api/projects/${encodeURIComponent(project.id)}/vault/overview`),
    api(`/api/projects/${encodeURIComponent(project.id)}/conversations`),
    api(`/api/projects/${encodeURIComponent(project.id)}/audit`),
    memoryViewTab === 'graph'
      ? api(`/api/projects/${encodeURIComponent(project.id)}/vault/graph?layer=${encodeURIComponent(memoryGraphLayer)}`)
      : Promise.resolve({ nodes: [], edges: [] }),
  ]);

  let documents = Array.isArray(vaultResult) ? vaultResult : [];
  const overview = overviewResult && !overviewResult.error
    ? overviewResult
    : { total: documents.length, nodes: 0, edges: 0, feedback: {}, views: [] };
  const graph = graphResult && !graphResult.error ? graphResult : { nodes: [], edges: [] };

  const vaultContent = `
    ${vaultOverviewHtml(overview)}
    <form class="vault-toolbar" id="vault-search-form">
      <label class="vault-search"><i data-lucide="search" class="ds-icon ds-icon--sm"></i><input id="vault-search-input" value="${esc(memorySearchQuery)}" placeholder="Buscar decisoes, pessoas, projetos ou aprendizados..."></label>
      <select class="ds-select" id="vault-status-filter" aria-label="Filtrar por estado">
        <option value="">Todos os estados</option>
        <option value="active" ${memoryStatusFilter === 'active' ? 'selected' : ''}>Ativas</option>
        <option value="tentative" ${memoryStatusFilter === 'tentative' ? 'selected' : ''}>Tentativas</option>
        <option value="__review__" ${memoryStatusFilter === '__review__' ? 'selected' : ''}>Precisam de revisao</option>
        <option value="superseded" ${memoryStatusFilter === 'superseded' ? 'selected' : ''}>Substituidas</option>
      </select>
      <button class="ds-btn ds-btn--primary" type="submit">Buscar</button>
      ${memorySearchQuery || memoryStatusFilter ? '<button class="ds-btn ds-btn--ghost" type="button" id="vault-clear-filter">Limpar</button>' : ''}
    </form>
    ${savedView ? `<div class="vault-filter-note"><i data-lucide="list-filter" class="ds-icon ds-icon--sm"></i>View ativa: <b>${savedView === 'review' ? 'Precisa de revisao' : savedView === 'unlinked' ? 'Sem conexoes' : 'Licoes dos agentes'}</b></div>` : ''}
    ${vaultCardsHtml(documents)}`;

  const graphContent = `
    <div class="vault-graph-header">
      <div><p class="ds-eyebrow">Constelacao do projeto</p><h3 class="ds-heading-xl">Memoria e estrutura tecnica</h3><p class="ds-caption">Passe sobre um no ou relacao para ver origem, estado e confianca.</p></div>
      <div class="ov-seg vault-layer-picker">
        ${['all', 'memory', 'code'].map(layer => `<button class="ov-seg__btn${memoryGraphLayer === layer ? ' is-active' : ''}" data-vault-layer="${layer}">${layer === 'all' ? 'Tudo' : layer === 'memory' ? 'Memoria' : 'Codigo'}</button>`).join('')}
      </div>
    </div>
    ${knowledgeGraphHtml(graph)}`;

  const contents = {
    vault: vaultContent,
    graph: graphContent,
    review: vaultReviewHtml(overview),
    conversations: dataConversationsHtml(Array.isArray(conversations) ? conversations : []),
    audit: auditHtml(Array.isArray(audit) ? audit : []),
  };

  view.innerHTML = `
    <div class="data-header">
      <div><p class="ds-eyebrow">Conhecimento local e auditavel</p><h2 class="ds-heading-2xl">Aria Vault &middot; ${esc(project.name)}</h2><p class="ds-body-sm ds-text-muted">Markdown e a fonte da verdade; indices, reflexoes e grafos podem ser reconstruidos.</p></div>
      <div class="data-header__actions">
        <a class="ds-btn ds-btn--outline" href="/api/projects/${encodeURIComponent(project.id)}/export" download><i data-lucide="download" class="ds-icon ds-icon--sm"></i> Exportar</a>
        <button class="ds-btn ds-btn--danger" id="memory-clear-all"><i data-lucide="eraser" class="ds-icon ds-icon--sm"></i> Limpar memorias</button>
      </div>
    </div>
    <div class="data-tabs ov-seg" role="tablist">
      <button class="ov-seg__btn${memoryViewTab === 'vault' ? ' is-active' : ''}" data-memory-tab="vault">Vault <span>${overview.total || 0}</span></button>
      <button class="ov-seg__btn${memoryViewTab === 'graph' ? ' is-active' : ''}" data-memory-tab="graph">Grafo <span>${overview.nodes || 0}</span></button>
      <button class="ov-seg__btn${memoryViewTab === 'review' ? ' is-active' : ''}" data-memory-tab="review">Revisao <span>${overview.views?.[0]?.count || 0}</span></button>
      <button class="ov-seg__btn${memoryViewTab === 'conversations' ? ' is-active' : ''}" data-memory-tab="conversations">Conversas <span>${Array.isArray(conversations) ? conversations.length : 0}</span></button>
      <button class="ov-seg__btn${memoryViewTab === 'audit' ? ' is-active' : ''}" data-memory-tab="audit">Auditoria <span>${Array.isArray(audit) ? audit.length : 0}</span></button>
    </div>
    <section class="data-content">${contents[memoryViewTab] || contents.vault}</section>`;

  view.querySelectorAll('[data-memory-tab]').forEach(button => button.addEventListener('click', () => {
    memoryViewTab = button.dataset.memoryTab;
    renderMemory();
  }));
  view.querySelectorAll('[data-memory-open]').forEach(button => button.addEventListener('click', () => openMemoryDetail(project.id, button.dataset.memoryOpen)));
  view.querySelectorAll('[data-vault-feedback]').forEach(button => button.addEventListener('click', () =>
    submitVaultFeedback(project.id, button.dataset.vaultDocument, button.dataset.vaultTitle, button.dataset.vaultFeedback)));
  view.querySelectorAll('[data-data-conversation-open]').forEach(button => button.addEventListener('click', () => openChatConversation(button.dataset.dataConversationOpen, button.dataset.dataConversationTitle)));
  view.querySelectorAll('[data-data-conversation-delete]').forEach(button => button.addEventListener('click', () => openDeleteConversationModal(button.dataset.dataConversationDelete, button.dataset.dataConversationTitle, renderMemory)));
  view.querySelectorAll('[data-vault-layer]').forEach(button => button.addEventListener('click', () => {
    memoryGraphLayer = button.dataset.vaultLayer;
    renderMemory();
  }));
  view.querySelectorAll('[data-vault-view]').forEach(button => button.addEventListener('click', () => {
    const selected = button.dataset.vaultView;
    memoryViewTab = 'vault';
    memoryStatusFilter = selected === 'needs-review' ? '__review__'
      : selected === 'tentative' ? 'tentative'
        : selected === 'unlinked' ? '__unlinked__'
          : selected === 'agent-lessons' ? '__feedback__'
            : '';
    renderMemory();
  }));
  $('#vault-search-form')?.addEventListener('submit', event => {
    event.preventDefault();
    memorySearchQuery = $('#vault-search-input').value.trim();
    memoryStatusFilter = $('#vault-status-filter').value;
    renderMemory();
  });
  $('#vault-status-filter')?.addEventListener('change', event => {
    memoryStatusFilter = event.target.value;
  });
  $('#vault-clear-filter')?.addEventListener('click', () => {
    memorySearchQuery = '';
    memoryStatusFilter = '';
    renderMemory();
  });
  $('#vault-reindex')?.addEventListener('click', async () => {
    const button = $('#vault-reindex');
    button.disabled = true;
    button.innerHTML = '<span class="ds-spinner"></span> Reindexando';
    const result = await api(`/api/projects/${encodeURIComponent(project.id)}/vault/reindex`, { method: 'POST' });
    if (!result.error) await renderMemory();
  });
  $('#vault-reflect')?.addEventListener('click', async () => {
    const result = await api(`/api/projects/${encodeURIComponent(project.id)}/vault/reflect`, { method: 'POST' });
    if (result.error) return;
    openModal(`<div class="ds-modal__header"><h3 class="ds-modal__title">Reflexao gerada</h3><button class="ds-modal__close" data-modal-close><i data-lucide="x"></i></button></div><div class="ds-modal__body"><p class="ds-caption">Documento derivado: ${esc(result.sourceRef)}</p><pre class="memory-document">${esc(result.content)}</pre></div><div class="ds-modal__footer"><button class="ds-btn ds-btn--primary" data-modal-close>Fechar</button></div>`, 'lg');
    refreshIcons();
  });
  $('#memory-clear-all')?.addEventListener('click', () => openClearMemoriesModal(project));
  refreshIcons();
}

async function openMemoryDetail(projectId, memoryId) {
  const memory = await api(`/api/projects/${encodeURIComponent(projectId)}/memory?id=${encodeURIComponent(memoryId)}`);
  openModal(`
    <div class="ds-modal__header"><div><span class="ds-badge ds-badge--info">${esc(MEMORY_KIND[memory.kind] || memory.kind)}</span><h3 class="ds-modal__title memory-modal-title">${esc(memory.name)}</h3></div><button class="ds-modal__close" data-modal-close><i data-lucide="x" class="ds-icon ds-icon--sm"></i></button></div>
    <div class="ds-modal__body"><p class="ds-caption">Agente ${esc(memory.agentId)} · ${fmtBytes(memory.size)}</p><pre class="memory-document">${esc(memory.content)}</pre></div>
    <div class="ds-modal__footer"><button class="ds-btn ds-btn--ghost" data-modal-close>Fechar</button><button class="ds-btn ds-btn--danger" id="memory-detail-delete"><i data-lucide="trash-2" class="ds-icon ds-icon--xs"></i> Apagar</button></div>`, 'lg');
  $('#memory-detail-delete')?.addEventListener('click', () => openDeleteMemoryModal(projectId, memoryId, memory.name));
  refreshIcons();
}

function openDeleteMemoryModal(projectId, memoryId, name) {
  openModal(`
    <div class="ds-modal__header"><h3 class="ds-modal__title">Apagar memória</h3><button class="ds-modal__close" data-modal-close><i data-lucide="x" class="ds-icon ds-icon--sm"></i></button></div>
    <div class="ds-modal__body"><div class="data-danger-note"><i data-lucide="triangle-alert" class="ds-icon ds-icon--sm"></i><p>A memória <b>${esc(name)}</b> será removida permanentemente. Exporte o projeto antes se quiser guardar uma cópia.</p></div></div>
    <div class="ds-modal__footer"><button class="ds-btn ds-btn--ghost" data-modal-close>Cancelar</button><button class="ds-btn ds-btn--danger" id="memory-delete-submit">Apagar definitivamente</button></div>`);
  $('#memory-delete-submit')?.addEventListener('click', async () => {
    const result = await api(`/api/projects/${encodeURIComponent(projectId)}/memory?id=${encodeURIComponent(memoryId)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmId: memoryId }) });
    if (result.error) return;
    closeModal();
    await renderMemory();
  });
  refreshIcons();
}

function openClearMemoriesModal(project) {
  openModal(`
    <div class="ds-modal__header"><h3 class="ds-modal__title">Limpar todas as memórias</h3><button class="ds-modal__close" data-modal-close><i data-lucide="x" class="ds-icon ds-icon--sm"></i></button></div>
    <div class="ds-modal__body"><div class="data-danger-note"><i data-lucide="shield-alert" class="ds-icon ds-icon--sm"></i><p>Isso apaga memórias principais, notas diárias e memórias profundas de todos os agentes deste projeto. Souls e arquivos do workspace serão preservados.</p></div><label class="ds-label" for="memory-clear-confirm">Digite <b>${esc(project.name)}</b> para confirmar</label><input class="ds-input" id="memory-clear-confirm" autocomplete="off"></div>
    <div class="ds-modal__footer"><button class="ds-btn ds-btn--ghost" data-modal-close>Cancelar</button><button class="ds-btn ds-btn--danger" id="memory-clear-submit" disabled>Limpar memórias</button></div>`);
  const input = $('#memory-clear-confirm'), submit = $('#memory-clear-submit');
  input.addEventListener('input', () => { submit.disabled = input.value !== project.name; });
  submit.addEventListener('click', async () => {
    const result = await api(`/api/projects/${encodeURIComponent(project.id)}/memories`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmName: input.value }) });
    if (result.error) return;
    closeModal();
    await renderMemory();
  });
  refreshIcons();
}

