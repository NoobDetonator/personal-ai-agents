/* Painel do Personal AI Agents — vanilla JS, sem dependencias.
   Visual: design system neumórfico (tokens/foundations/components/motion). */

let state = null;

const $ = (sel) => document.querySelector(sel);
const closestFromEvent = (event, selector) => event.target instanceof Element ? event.target.closest(selector) : null;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts) {
  const res = await fetch(path, opts);
  return res.json();
}

function fmtTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n ?? 0);
}

function fmtCost(n) {
  return window.dsCharts ? dsCharts.fmtCost(n) : '$' + Number(n ?? 0).toFixed(4);
}

function fmtPct(fraction) {
  return Math.round((fraction ?? 0) * 100) + '%';
}

/** Re-executa os renderizadores de icone apos qualquer innerHTML novo. */
function refreshIcons() {
  if (window.lucide) lucide.createIcons();
  if (window.dsAgent) dsAgent.createIcons();
}

const ROLE_BADGE = { principal: 'violet', manager: 'brand', worker: 'info' };
function roleBadge(role) {
  return `<span class="ds-badge ds-badge--${ROLE_BADGE[role] || 'brand'}">${esc(role)}</span>`;
}

const PROFILE_STATUS = {
  manual: {
    label: 'Soul manual',
    shortLabel: 'soul manual',
    variant: 'info',
    icon: 'pen-line',
    description: 'Soul definida manualmente; não há vínculo com a biblioteca de perfis.',
  },
  current: {
    label: 'Perfil sincronizado',
    shortLabel: 'perfil',
    variant: 'success',
    icon: 'badge-check',
    description: 'A revisão aplicada coincide com o perfil atual da biblioteca.',
  },
  outdated: {
    label: 'Perfil desatualizado',
    shortLabel: 'perfil desatualizado',
    variant: 'warning',
    icon: 'refresh-cw',
    description: 'O perfil da biblioteca mudou depois da composição desta soul.',
  },
  missing: {
    label: 'Perfil ausente',
    shortLabel: 'perfil ausente',
    variant: 'danger',
    icon: 'file-question',
    description: 'O perfil registrado não existe mais na biblioteca.',
  },
  untracked: {
    label: 'Revisão não registrada',
    shortLabel: 'perfil sem revisão',
    variant: 'info',
    icon: 'fingerprint',
    description: 'O perfil está registrado, mas a revisão aplicada não foi salva.',
  },
};

function profileStatusMeta(provenance) {
  return PROFILE_STATUS[provenance?.status] || PROFILE_STATUS.manual;
}

function profileBadge(provenance) {
  const meta = profileStatusMeta(provenance);
  const name = provenance?.profileTitle || provenance?.profileId;
  const text = name ? `${meta.shortLabel}: ${name}` : meta.shortLabel;
  return `<span class="ds-badge ds-badge--${meta.variant}" data-profile-status="${esc(provenance?.status || 'manual')}" title="${esc(meta.description)}">${esc(text)}</span>`;
}

function profileProvenanceCard(provenance) {
  const p = provenance || { source: 'manual', status: 'manual' };
  const meta = profileStatusMeta(p);
  const source = p.source === 'library' ? 'Biblioteca de perfis' : 'Definição manual';
  const profile = p.profileTitle
    ? `${p.profileTitle} (${p.profileId})`
    : p.profileId || 'Nenhum';
  const applied = p.appliedRevision || '&mdash;';
  const current = p.currentRevision || '&mdash;';
  const file = p.profileFile
    ? `<div class="profile-origin-item profile-origin-item--wide"><span>Arquivo de origem</span><code class="ds-code">${esc(p.profileFile)}</code></div>`
    : '';

  return `
    <div class="ds-card profile-origin-card" style="margin-bottom:16px;" data-profile-status="${esc(p.status)}">
      <div class="ds-card__header">
        <h3 class="ds-card__title">Proveniência da soul</h3>
        ${profileBadge(p)}
      </div>
      <div class="ds-card__body">
        <div class="profile-origin-summary profile-origin--${esc(p.status)}">
          <i data-lucide="${meta.icon}" class="ds-icon ds-icon--md"></i>
          <div>
            <b>${esc(meta.label)}</b>
            <p class="ds-caption">${esc(meta.description)}</p>
          </div>
        </div>
        <div class="profile-origin-grid">
          <div class="profile-origin-item"><span>Origem</span><b>${esc(source)}</b></div>
          <div class="profile-origin-item"><span>Perfil</span><b>${esc(profile)}</b></div>
          <div class="profile-origin-item"><span>Revisão aplicada</span><code class="ds-code">${applied === '&mdash;' ? applied : esc(applied)}</code></div>
          <div class="profile-origin-item"><span>Revisão atual</span><code class="ds-code">${current === '&mdash;' ? current : esc(current)}</code></div>
          ${file}
        </div>
      </div>
    </div>`;
}

/** Mapeia um agente para um icone de ramo, olhando id, nome e descricao (PT/EN).
    Ordem importa: termos mais especificos vem antes dos genericos. */
const AGENT_ICON_TABLE = [
  [['aria'], 'aria'],
  [['secur', 'seguran', 'pentest'], 'security'],
  [['devops', 'infra', 'deploy', 'sre'], 'devops'],
  [['debug'], 'debugger'],
  [['test', ' qa', 'qualidade'], 'tester'],
  [['review', 'revis'], 'reviewer'],
  [['critic', 'crític'], 'critic'],
  [['database', 'banco de dados', 'sql'], 'database'],
  [['coder', 'código', 'codigo', 'program', 'frontend', 'backend', 'fullstack', ' dev', 'engenheiro', 'software'], 'coder'],
  [['arquitet', 'architect'], 'architect'],
  [['research', 'pesquis', 'investig'], 'investigator'],
  [['histor'], 'historian'],
  [['analis', 'analy', 'anális', 'dados', 'data '], 'analyst'],
  [['scrap', 'crawl'], 'scraper'],
  [['seo'], 'seo'],
  [['market', 'divulg', 'publicid', 'social media'], 'marketing'],
  [['financ', 'contab', 'econom', 'invest'], 'finance'],
  [['sales', 'vend', 'comercial'], 'sales'],
  [['legal', 'juríd', 'jurid', 'advog'], 'legal'],
  [['recrut', 'people', ' rh ', 'hr '], 'hr'],
  [['suporte', 'support', 'atendimento', 'helpdesk'], 'support'],
  [['mentor', 'professor', 'ensin', 'tutor', 'coach', 'educa'], 'mentor'],
  [['translat', 'tradu', 'idioma'], 'translator'],
  [['narrad', 'writer', 'escrit', 'redat', 'roteir', 'copywrit', 'conteúdo', 'conteudo', 'blog'], 'writer'],
  [['creativ', 'criativ', 'design', 'arte', ' ux', ' ui'], 'creative'],
  [['resum', 'summar'], 'summarizer'],
  [['format'], 'formatter'],
  [['matemát', 'matemat', 'math', 'cálcul', 'calcul'], 'math'],
  [['ético', 'etico', 'ethic'], 'ethical'],
  [['planej', 'planner', 'plano', 'gerente', 'manager', 'coorden', 'projeto', 'project'], 'planner'],
];

function agentIconFor(agent) {
  if (agent.role === 'principal' || (agent.id || '').toLowerCase() === 'aria') return 'aria';
  const hay = ` ${agent.id || ''} ${agent.name || ''} ${agent.description || ''} `.toLowerCase();
  for (const [needles, icon] of AGENT_ICON_TABLE) {
    if (needles.some(n => hay.includes(n))) return icon;
  }
  // Sem ramo identificado: gestores viram planner, o resto usa o icone geral
  return agent.role === 'manager' ? 'planner' : 'generic';
}

/** Avatar do agente: fundo com a cor de acento do ramo + icone. */
function agentAvatar(agent, size = 'md') {
  const icon = agentIconFor(agent);
  return `<div class="ds-avatar ds-avatar--${esc(size)} agent-avatar agent-avatar--${icon}">
    <i data-agent-icon="${icon}" class="ds-agent-icon ds-agent-icon--${size}"></i>
  </div>`;
}

function aiBadge(provider, model) {
  return `<span class="ds-ai-badge ds-ai-badge--${esc(provider)}" title="${esc(provider)}">${esc(model)}</span>`;
}

// ---------- Navegacao ----------

const views = ['projects', 'project-detail', 'chat', 'overview', 'live', 'agents', 'agent-detail', 'board', 'skills', 'settings'];

function show(view) {
  for (const v of views) {
    $('#view-' + v).classList.toggle('hidden', v !== view);
  }
  // Detalhes mantêm o item de lista da seção-mãe destacado.
  const navView = view === 'project-detail' ? 'projects' : view === 'agent-detail' ? 'agents' : view;
  document.querySelectorAll('.ds-sidebar__item').forEach(item => {
    item.classList.toggle('is-active', item.dataset.view === navView);
  });
}

async function router() {
  const hash = location.hash || '#/projects';
  const [, route, param] = hash.split('/');

  if (route === 'agent' && param) {
    await renderAgentDetail(param);
    show('agent-detail');
    return;
  }

  if (route === 'project' && param) {
    show('project-detail');
    await renderProjectDetail(param);
    return;
  }

  if (route === 'chat') {
    show('chat');
    await renderChat(param || null);
    return;
  }

  const view = views.includes(route) ? route : 'projects';
  show(view);

  if (view === 'projects') await renderProjects();
  if (view === 'overview') await renderOverview();
  if (view === 'agents') await renderAgents();
  if (view === 'board') await renderBoard();
  if (view === 'skills') await renderSkills();
  if (view === 'settings') await renderSettings();
}

window.addEventListener('hashchange', router);

document.querySelectorAll('.ds-sidebar__item[data-view]').forEach(item => {
  item.addEventListener('click', () => { location.hash = '#/' + item.dataset.view; });
});

function openAgentTarget(target) {
  location.hash = '#/agent/' + encodeURIComponent(target.dataset.agentId);
}

document.addEventListener('click', event => {
  const target = closestFromEvent(event, '[data-agent-id]');
  if (target) openAgentTarget(target);
});

document.addEventListener('keydown', event => {
  const target = closestFromEvent(event, '[data-agent-id]');
  if (!target || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  openAgentTarget(target);
});

// ---------- Projetos ----------

let projectsCache = [];
let modelsCache = null;
let activeProjectId = localStorage.getItem('paa.activeProject') || null;

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return esc(s);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function getModels() {
  if (!modelsCache) modelsCache = await api('/api/models');
  return modelsCache;
}

async function loadProjects() {
  projectsCache = await api('/api/projects') || [];
  if (activeProjectId && !projectsCache.some(p => p.id === activeProjectId)) activeProjectId = null;
  populateSwitcher();
  return projectsCache;
}

function populateSwitcher() {
  const sel = $('#project-switcher');
  if (!sel) return;
  const actives = projectsCache.filter(p => p.status === 'active');
  const list = actives.length ? actives : projectsCache;
  sel.innerHTML = list.map(p =>
    `<option value="${esc(p.id)}"${p.id === activeProjectId ? ' selected' : ''}>${esc(p.name)}${p.status === 'archived' ? ' (arquivado)' : ''}</option>`
  ).join('') || '<option value="">Nenhum projeto</option>';
  if (!activeProjectId && list[0]) { activeProjectId = list[0].id; sel.value = activeProjectId; }
}

function setActiveProject(id) {
  activeProjectId = id;
  localStorage.setItem('paa.activeProject', id);
  const sel = $('#project-switcher');
  if (sel) sel.value = id;
}

// --- Modal utilitário ---

function escCloseModal(e) { if (e.key === 'Escape') closeModal(); }

function openModal(html, size = 'sm') {
  const root = $('#modal-root');
  root.innerHTML = `<div class="ds-modal-overlay" id="active-modal"><div class="ds-modal ds-modal--${size}">${html}</div></div>`;
  const overlay = $('#active-modal');
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  overlay.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', closeModal));
  document.addEventListener('keydown', escCloseModal);
  refreshIcons();
}

function closeModal() {
  const overlay = $('#active-modal');
  if (!overlay) return;
  overlay.classList.remove('is-open');
  document.removeEventListener('keydown', escCloseModal);
  setTimeout(() => { const r = $('#modal-root'); if (r) r.innerHTML = ''; }, 200);
}

// --- Hub de projetos ---

async function renderProjects() {
  const list = await loadProjects();
  const active = list.filter(p => p.status === 'active');
  const archived = list.filter(p => p.status === 'archived');

  const grid = (items) => `<div class="ds-grid ds-grid-auto-md ds-stagger">${items.map(projectCard).join('')}</div>`;

  const archivedSection = archived.length ? `
    <h3 class="ds-heading-md project-section-title"><i data-lucide="archive" class="ds-icon ds-icon--sm"></i> Arquivados (${archived.length})</h3>
    ${grid(archived)}` : '';

  $('#view-projects').innerHTML = `
    <div class="ov-header">
      <h2 class="ds-heading-2xl">Projetos</h2>
      <button class="ds-btn ds-btn--primary" id="new-project-hub"><i data-lucide="folder-plus" class="ds-icon ds-icon--sm"></i> Novo projeto</button>
    </div>
    ${active.length ? grid(active) : `
      <div class="ds-empty-state">
        <i data-lucide="folder-git-2" class="ds-empty-state__icon"></i>
        <h3 class="ds-empty-state__title">Nenhum projeto ativo</h3>
        <p class="ds-empty-state__description">Crie um projeto para isolar conversas, agentes e arquivos.</p>
      </div>`}
    ${archivedSection}
  `;
  $('#new-project-hub').addEventListener('click', openCreateProjectModal);
  refreshIcons();
}

function projectCard(p) {
  const isLegacy = p.id === 'legacy';
  const archived = p.status === 'archived';
  const actions = archived
    ? `<button class="ds-btn ds-btn--outline ds-btn--sm" data-project-restore="${esc(p.id)}"><i data-lucide="archive-restore" class="ds-icon ds-icon--xs"></i> Restaurar</button>`
    : `<button class="ds-btn ds-btn--ghost ds-btn--sm" data-project-archive="${esc(p.id)}" title="Arquivar"><i data-lucide="archive" class="ds-icon ds-icon--xs"></i></button>`;
  const del = isLegacy ? '' :
    `<button class="ds-btn ds-btn--ghost ds-btn--sm project-danger" data-project-delete="${esc(p.id)}" data-project-name="${esc(p.name)}" title="Excluir"><i data-lucide="trash-2" class="ds-icon ds-icon--xs"></i></button>`;
  return `
    <div class="ds-card ds-card--interactive project-card" role="link" tabindex="0" data-project-open="${esc(p.id)}">
      <div class="ds-card__header">
        <div class="ds-inline ds-inline-md">
          <div class="project-avatar${isLegacy ? ' project-avatar--legacy' : ''}"><i data-lucide="${isLegacy ? 'archive' : 'folder-git-2'}" class="ds-icon ds-icon--md"></i></div>
          <div>
            <div class="ds-heading-md">${esc(p.name)}</div>
            <div class="ds-caption">${esc(p.slug)}</div>
          </div>
        </div>
        ${archived ? '<span class="ds-badge ds-badge--warning">arquivado</span>' : ''}
      </div>
      <div class="ds-card__body">
        <p class="ds-body-sm project-card__desc">${esc(p.description || 'Sem descrição.')}</p>
        <div class="ds-inline ds-cluster ds-cluster-sm project-card__meta">
          <span class="ds-chip"><i data-lucide="clock" class="ds-icon ds-icon--xs"></i> ${p.last_opened_at ? 'aberto ' + fmtDate(p.last_opened_at) : 'criado ' + fmtDate(p.created_at)}</span>
        </div>
      </div>
      <div class="project-card__actions">${actions}${del}</div>
    </div>`;
}

// --- Detalhe do projeto ---

async function renderProjectDetail(id) {
  const data = await api('/api/projects/' + id);
  if (!data || data.error) {
    $('#view-project-detail').innerHTML = `
      <a class="ds-btn ds-btn--ghost" href="#/projects"><i data-lucide="arrow-left" class="ds-icon ds-icon--sm"></i> projetos</a>
      <p class="ds-body-md" style="margin-top:12px;">Projeto não encontrado.</p>`;
    refreshIcons();
    return;
  }
  const p = data.project;
  setActiveProject(p.id);
  const s = data.settings || {};
  const convs = (data.conversations || []);

  const settingsChips = [
    s.default_model ? `<span class="ds-chip"><i data-lucide="cpu" class="ds-icon ds-icon--xs"></i> ${esc(s.default_model)}</span>` : '',
    `<span class="ds-chip"><i data-lucide="terminal" class="ds-icon ds-icon--xs"></i> shell: ${esc(s.shell_mode || 'herda global')}</span>`,
    `<span class="ds-chip"><i data-lucide="folder" class="ds-icon ds-icon--xs"></i> ${esc(p.root_path)}</span>`,
  ].join('');

  const convItems = convs.length ? convs.map(c => `
    <div class="ds-list__item conversation-link" role="button" tabindex="0" data-conversation-id="${esc(c.id)}">
      <i data-lucide="${c.pinned ? 'pin' : 'message-circle'}" class="ds-list__icon"></i>
      <span style="flex:1;">${esc(c.title || c.id.slice(0, 8))}</span>
      ${c.archived ? '<span class="ds-badge ds-badge--warning">arquivada</span>' : ''}
      ${c.last_run_status ? `<span class="ds-badge ds-badge--${runStatusVariant(c.last_run_status)}">${esc(c.last_run_status)}</span>` : ''}
      <span class="ds-caption">${c.message_count} msgs</span>
    </div>`).join('')
    : `<div class="ds-empty-state" style="padding:20px;"><p class="ds-body-sm ds-text-muted">Nenhuma conversa ainda.</p></div>`;

  const isLegacy = p.id === 'legacy';
  $('#view-project-detail').innerHTML = `
    <a class="ds-btn ds-btn--ghost" href="#/projects"><i data-lucide="arrow-left" class="ds-icon ds-icon--sm"></i> projetos</a>
    <div class="agent-detail-header">
      <div class="project-avatar project-avatar--lg${isLegacy ? ' project-avatar--legacy' : ''}"><i data-lucide="${isLegacy ? 'archive' : 'folder-git-2'}" class="ds-icon ds-icon--lg"></i></div>
      <h2 class="ds-heading-2xl">${esc(p.name)} ${p.status === 'archived' ? '<span class="ds-badge ds-badge--warning">arquivado</span>' : ''}</h2>
      <div class="project-detail-actions">
        ${isLegacy ? '' : `<button class="ds-btn ds-btn--outline ds-btn--sm" id="pd-edit"><i data-lucide="pencil" class="ds-icon ds-icon--xs"></i> Editar</button>`}
        ${isLegacy ? '' : (p.status === 'archived'
          ? `<button class="ds-btn ds-btn--outline ds-btn--sm" data-project-restore="${esc(p.id)}"><i data-lucide="archive-restore" class="ds-icon ds-icon--xs"></i> Restaurar</button>`
          : `<button class="ds-btn ds-btn--outline ds-btn--sm" data-project-archive="${esc(p.id)}"><i data-lucide="archive" class="ds-icon ds-icon--xs"></i> Arquivar</button>`)}
      </div>
    </div>

    <div class="ds-card" style="margin-bottom:16px;">
      <div class="ds-card__body">
        <p class="ds-body-sm">${esc(p.description || 'Sem descrição.')}</p>
        <div class="ds-inline ds-cluster ds-cluster-sm" style="margin-top:10px;">${settingsChips}</div>
      </div>
    </div>

    <div class="ds-card">
      <div class="ds-card__header">
        <h3 class="ds-card__title">Conversas (${convs.length})</h3>
        <button class="ds-btn ds-btn--primary ds-btn--sm" id="pd-new-conv"><i data-lucide="message-square-plus" class="ds-icon ds-icon--xs"></i> Nova conversa</button>
      </div>
      <div class="ds-list ds-list--interactive">${convItems}</div>
    </div>

  `;

  $('#pd-new-conv')?.addEventListener('click', () => createConversation(p.id));
  $('#pd-edit')?.addEventListener('click', () => openEditProjectModal(p));
  document.querySelectorAll('#view-project-detail [data-conversation-id]').forEach(item => {
    const title = item.querySelector('span')?.textContent || 'Conversa';
    const open = () => openChatConversation(item.dataset.conversationId, title);
    item.addEventListener('click', open);
    item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
  refreshIcons();
}

const RUN_STATUS_VARIANT = { done: 'success', failed: 'danger', cancelled: '', timed_out: 'danger', running: 'warning', queued: 'info', waiting_confirmation: 'warning' };
function runStatusVariant(status) { return RUN_STATUS_VARIANT[status] || 'info'; }

// --- Modais criar / editar ---

async function openCreateProjectModal() {
  const models = await getModels();
  openModal(`
    <div class="ds-modal__header">
      <h3 class="ds-modal__title">Novo projeto</h3>
      <button class="ds-modal__close" data-modal-close><i data-lucide="x" class="ds-icon ds-icon--sm"></i></button>
    </div>
    <div class="ds-modal__body">
      <div class="ds-field">
        <label class="ds-field__label ds-field__label--required">Nome</label>
        <input class="ds-input" id="np-name" maxlength="120" placeholder="Ex.: Site institucional" autocomplete="off">
      </div>
      <div class="ds-field" style="margin-top:14px;">
        <label class="ds-field__label">Descrição</label>
        <textarea class="ds-textarea" id="np-desc" rows="3" placeholder="Opcional"></textarea>
      </div>
      <div class="ds-field" style="margin-top:14px;">
        <label class="ds-field__label">Modelo padrão</label>
        <select class="ds-select" id="np-model">
          <option value="">Herdar do global</option>
          ${models.map(m => `<option value="${esc(m.id)}">${esc(m.name)} (${esc(m.provider)})</option>`).join('')}
        </select>
      </div>
      <label class="ds-checkbox" style="margin-top:14px;">
        <input type="checkbox" id="np-conv" checked>
        <span class="ds-body-sm">Criar conversa inicial com a Aria</span>
      </label>
      <div class="ds-field__error hidden" id="np-error" style="margin-top:12px;"><i data-lucide="alert-circle" class="ds-icon ds-icon--xs"></i> <span></span></div>
    </div>
    <div class="ds-modal__footer">
      <button class="ds-btn ds-btn--ghost" data-modal-close>Cancelar</button>
      <button class="ds-btn ds-btn--primary" id="np-submit">Criar projeto</button>
    </div>
  `);
  const submit = $('#np-submit');
  const nameInput = $('#np-name');
  nameInput.focus();
  const doSubmit = async () => {
    const name = nameInput.value.trim();
    const errBox = $('#np-error');
    if (!name) { showModalError(errBox, 'Informe um nome para o projeto.'); return; }
    submit.disabled = true;
    const models2 = await getModels();
    const modelId = $('#np-model').value;
    const model = models2.find(m => m.id === modelId);
    const res = await api('/api/projects', jsonPost({
      name,
      description: $('#np-desc').value.trim() || null,
      defaultModel: modelId || null,
      defaultProvider: model ? model.provider : null,
      createInitialConversation: $('#np-conv').checked,
    }));
    if (res.error || !res.project) {
      submit.disabled = false;
      showModalError(errBox, res.error || 'Não foi possível criar o projeto.');
      return;
    }
    setActiveProject(res.project.id);
    closeModal();
    await loadProjects();
    location.hash = '#/project/' + res.project.id;
  };
  submit.addEventListener('click', doSubmit);
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSubmit(); });
}

function openEditProjectModal(p) {
  openModal(`
    <div class="ds-modal__header">
      <h3 class="ds-modal__title">Editar projeto</h3>
      <button class="ds-modal__close" data-modal-close><i data-lucide="x" class="ds-icon ds-icon--sm"></i></button>
    </div>
    <div class="ds-modal__body">
      <div class="ds-field">
        <label class="ds-field__label ds-field__label--required">Nome</label>
        <input class="ds-input" id="ep-name" maxlength="120" value="${esc(p.name)}">
      </div>
      <div class="ds-field" style="margin-top:14px;">
        <label class="ds-field__label">Descrição</label>
        <textarea class="ds-textarea" id="ep-desc" rows="3">${esc(p.description || '')}</textarea>
      </div>
      <div class="ds-field__error hidden" id="ep-error" style="margin-top:12px;"><i data-lucide="alert-circle" class="ds-icon ds-icon--xs"></i> <span></span></div>
    </div>
    <div class="ds-modal__footer">
      <button class="ds-btn ds-btn--ghost" data-modal-close>Cancelar</button>
      <button class="ds-btn ds-btn--primary" id="ep-submit">Salvar</button>
    </div>
  `);
  $('#ep-submit').addEventListener('click', async () => {
    const name = $('#ep-name').value.trim();
    if (!name) { showModalError($('#ep-error'), 'O nome não pode ficar vazio.'); return; }
    await api('/api/projects/' + p.id, jsonPatch({ name, description: $('#ep-desc').value.trim() || null }));
    closeModal();
    await renderProjectDetail(p.id);
  });
}

function openDeleteProjectModal(id, name) {
  openModal(`
    <div class="ds-modal__header">
      <h3 class="ds-modal__title">Excluir projeto</h3>
      <button class="ds-modal__close" data-modal-close><i data-lucide="x" class="ds-icon ds-icon--sm"></i></button>
    </div>
    <div class="ds-modal__body">
      <p class="ds-body-sm">Esta ação remove o projeto <b>${esc(name)}</b> e seus arquivos. Não pode ser desfeita. Prefira arquivar se tiver dúvida.</p>
      <div class="ds-field" style="margin-top:14px;">
        <label class="ds-field__label">Digite <b>${esc(name)}</b> para confirmar</label>
        <input class="ds-input" id="dp-confirm" autocomplete="off">
      </div>
      <div class="ds-field__error hidden" id="dp-error" style="margin-top:12px;"><i data-lucide="alert-circle" class="ds-icon ds-icon--xs"></i> <span></span></div>
    </div>
    <div class="ds-modal__footer">
      <button class="ds-btn ds-btn--ghost" data-modal-close>Cancelar</button>
      <button class="ds-btn ds-btn--danger" id="dp-submit">Excluir definitivamente</button>
    </div>
  `);
  $('#dp-submit').addEventListener('click', async () => {
    const res = await api('/api/projects/' + id, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmName: $('#dp-confirm').value }) });
    if (res.error) { showModalError($('#dp-error'), res.error); return; }
    if (activeProjectId === id) { activeProjectId = null; localStorage.removeItem('paa.activeProject'); }
    closeModal();
    location.hash = '#/projects';
    await renderProjects();
  });
}

function showModalError(box, msg) {
  if (!box) return;
  box.classList.remove('hidden');
  const span = box.querySelector('span');
  if (span) span.textContent = msg;
  refreshIcons();
}

async function createConversation(projectId) {
  const res = await api('/api/projects/' + projectId + '/conversations', jsonPost({ title: 'Nova conversa' }));
  if (res && res.conversationId) openChatConversation(res.conversationId, 'Nova conversa');
}

function jsonPost(body) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
function jsonPatch(body) {
  return { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

// --- Ações de projeto (delegação de clique) ---

document.addEventListener('click', event => {
  const openEl = closestFromEvent(event, '[data-project-open]');
  if (openEl && !closestFromEvent(event, '[data-project-archive],[data-project-restore],[data-project-delete]')) {
    location.hash = '#/project/' + encodeURIComponent(openEl.dataset.projectOpen);
    return;
  }
  const archiveEl = closestFromEvent(event, '[data-project-archive]');
  if (archiveEl) {
    event.stopPropagation();
    void projectAction(() => api('/api/projects/' + archiveEl.dataset.projectArchive + '/archive', jsonPost({})));
    return;
  }
  const restoreEl = closestFromEvent(event, '[data-project-restore]');
  if (restoreEl) {
    event.stopPropagation();
    void projectAction(() => api('/api/projects/' + restoreEl.dataset.projectRestore, jsonPatch({ status: 'active' })));
    return;
  }
  const deleteEl = closestFromEvent(event, '[data-project-delete]');
  if (deleteEl) {
    event.stopPropagation();
    openDeleteProjectModal(deleteEl.dataset.projectDelete, deleteEl.dataset.projectName);
  }
});

async function projectAction(fn) {
  await fn();
  await loadProjects();
  const hash = location.hash;
  if (hash.startsWith('#/project/')) await renderProjectDetail(hash.split('/')[2]);
  else await renderProjects();
}

// ---------- Chat (conversas por projeto) ----------

let chatTabs = loadChatTabs();
let chatSession = { convId: null, runId: null, lastSeq: 0, streaming: false };

function loadChatTabs() {
  try { const t = JSON.parse(localStorage.getItem('paa.chatTabs') || '[]'); return Array.isArray(t) ? t : []; }
  catch { return []; }
}
function saveChatTabs() { localStorage.setItem('paa.chatTabs', JSON.stringify(chatTabs)); }

function openChatConversation(convId, title) {
  if (!chatTabs.some(t => t.id === convId)) { chatTabs.push({ id: convId, title: title || 'Conversa' }); saveChatTabs(); }
  location.hash = '#/chat/' + convId;
}

function closeChatTab(convId) {
  const wasActive = chatSession.convId === convId;
  chatTabs = chatTabs.filter(t => t.id !== convId);
  saveChatTabs();
  if (wasActive) { chatSession = { convId: null, runId: null, lastSeq: 0, streaming: false }; }
  const next = chatTabs[chatTabs.length - 1];
  location.hash = next ? '#/chat/' + next.id : '#/chat';
  if (!$('#view-chat').classList.contains('hidden')) renderChat(next ? next.id : null);
}

function scrollChatTimeline() {
  const t = $('#chat-timeline');
  if (t) t.scrollTop = t.scrollHeight;
}

function historicalToolsHtml(events) {
  const pending = new Map();
  const cards = [];
  for (const event of events || []) {
    let payload = {};
    try { payload = event.payload_json ? JSON.parse(event.payload_json) : {}; } catch { payload = {}; }
    if (event.type === 'tool_start') {
      const card = { tool: payload.tool || 'ferramenta', result: null };
      cards.push(card);
      const queue = pending.get(card.tool) || [];
      queue.push(card);
      pending.set(card.tool, queue);
    } else if (event.type === 'tool_result') {
      const queue = pending.get(payload.tool) || [];
      const card = queue.shift();
      if (card) card.result = payload.result;
    }
  }
  if (!cards.length) return '';
  return '<div class="chat-tools">' + cards.map(card => {
    const raw = card.result == null ? 'Resultado nao registrado.' :
      (typeof card.result === 'string' ? card.result : JSON.stringify(card.result, null, 2));
    return `<div class="tool-card tool-card--done">
      <button class="tool-card__head" type="button"><i data-lucide="wrench" class="ds-icon ds-icon--xs"></i> <b>${esc(card.tool)}</b> <i data-lucide="chevron-down" class="ds-icon ds-icon--xs tool-card__chev"></i></button>
      <div class="tool-card__body ds-caption"><pre class="ds-code">${esc(raw.slice(0, 4000))}</pre></div>
    </div>`;
  }).join('') + '</div>';
}

function chatMsgHtml(role, who, content, toolEvents) {
  return `<div class="chat-msg chat-msg--${role}"><div class="chat-msg__who">${esc(who)}</div>${historicalToolsHtml(toolEvents)}<div class="chat-msg__body">${esc(content)}</div></div>`;
}

async function renderChat(convId) {
  if (!convId) convId = chatTabs.length ? chatTabs[chatTabs.length - 1].id : null;
  const view = $('#view-chat');

  if (!convId) {
    view.innerHTML = `
      <h2 class="ds-heading-2xl" style="margin-bottom:16px;">Chat</h2>
      <div class="ds-empty-state">
        <i data-lucide="message-square" class="ds-empty-state__icon"></i>
        <h3 class="ds-empty-state__title">Nenhuma conversa aberta</h3>
        <p class="ds-empty-state__description">Abra uma conversa a partir de um projeto para começar.</p>
        <a class="ds-btn ds-btn--primary" href="#/projects" style="margin-top:12px;"><i data-lucide="folder-git-2" class="ds-icon ds-icon--sm"></i> Ir para projetos</a>
      </div>`;
    refreshIcons();
    return;
  }

  if (!chatTabs.some(t => t.id === convId)) { chatTabs.push({ id: convId, title: 'Conversa' }); saveChatTabs(); }

  const data = await api('/api/conversations/' + convId);
  const meta = data.meta || {};
  const title = meta.title || (chatTabs.find(t => t.id === convId)?.title) || 'Conversa';
  // Mantém o título da aba em sincronia
  const tab = chatTabs.find(t => t.id === convId);
  if (tab && meta.title) { tab.title = meta.title; saveChatTabs(); }

  const messagesHtml = (data.messages || []).map(m =>
    chatMsgHtml(m.role, m.role === 'user' ? 'Você' : (m.agent_id || 'Aria'), m.content)
  ).join('') || `<div class="chat-empty ds-text-muted ds-body-sm">Envie a primeira mensagem para começar.</div>`;

  view.innerHTML = `
    <div class="chat-tabs" id="chat-tabs">${chatTabsHtml(convId)}</div>
    <div class="chat-panel">
      <div class="chat-header">
        <input class="chat-title-input" id="chat-title" value="${esc(title)}" aria-label="Título da conversa">
        <div class="chat-actions">
          <button class="ds-btn ds-btn--ghost ds-btn--sm" id="chat-pin" title="${meta.pinned ? 'Desafixar' : 'Fixar'}"><i data-lucide="pin" class="ds-icon ds-icon--xs" style="${meta.pinned ? 'color:var(--ds-action-primary)' : ''}"></i></button>
          <button class="ds-btn ds-btn--ghost ds-btn--sm" id="chat-fork" title="Duplicar"><i data-lucide="copy" class="ds-icon ds-icon--xs"></i></button>
          <button class="ds-btn ds-btn--ghost ds-btn--sm" id="chat-archive" title="${meta.archived ? 'Desarquivar' : 'Arquivar'}"><i data-lucide="archive" class="ds-icon ds-icon--xs"></i></button>
          <button class="ds-btn ds-btn--ghost ds-btn--sm project-danger" id="chat-delete" title="Apagar"><i data-lucide="trash-2" class="ds-icon ds-icon--xs"></i></button>
        </div>
      </div>
      <div class="chat-timeline" id="chat-timeline">${messagesHtml}</div>
      <div class="chat-composer">
        <textarea class="ds-textarea chat-input" id="chat-input" rows="1" placeholder="Envie uma mensagem..."></textarea>
        <button class="ds-btn ds-btn--danger hidden" id="chat-cancel"><i data-lucide="square" class="ds-icon ds-icon--xs"></i> Cancelar</button>
        <button class="ds-btn ds-btn--primary" id="chat-send" title="Enviar"><i data-lucide="send" class="ds-icon ds-icon--sm"></i></button>
      </div>
    </div>`;

  // Estado do run em andamento (retomada após refresh)
  if (data.activeRun) {
    chatSession = { convId, runId: data.activeRun.id, lastSeq: 0, streaming: true };
    ensureLiveBubble(data.activeRun.agentId);
    applyRunEventList(data.activeRun.events);
    setChatComposerState(true);
  } else {
    chatSession = { convId, runId: null, lastSeq: 0, streaming: false };
    setChatComposerState(false);
  }

  wireChatControls(convId, meta);
  scrollChatTimeline();
  refreshIcons();
}

function chatTabsHtml(activeId) {
  if (!chatTabs.length) return '';
  return chatTabs.map(t => `
    <div class="chat-tab${t.id === activeId ? ' is-active' : ''}" data-chat-tab="${esc(t.id)}" role="tab" tabindex="0">
      <span class="chat-tab__label">${esc(t.title)}</span>
      <button class="chat-tab__close" data-chat-close="${esc(t.id)}" title="Fechar" aria-label="Fechar aba"><i data-lucide="x" class="ds-icon ds-icon--xs"></i></button>
    </div>`).join('');
}

function wireChatControls(convId, meta) {
  const input = $('#chat-input');
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(convId); }
  });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; });
  $('#chat-send').addEventListener('click', () => sendChatMessage(convId));
  $('#chat-cancel').addEventListener('click', cancelChatRun);

  const titleInput = $('#chat-title');
  const commitTitle = async () => {
    const t = titleInput.value.trim();
    if (!t || t === meta.title) return;
    await api('/api/conversations/' + convId, jsonPatch({ title: t }));
    const tab = chatTabs.find(x => x.id === convId);
    if (tab) { tab.title = t; saveChatTabs(); $('#chat-tabs').innerHTML = chatTabsHtml(convId); refreshIcons(); }
  };
  titleInput.addEventListener('blur', commitTitle);
  titleInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); titleInput.blur(); } });

  $('#chat-pin').addEventListener('click', async () => {
    await api('/api/conversations/' + convId, jsonPatch({ pinned: !meta.pinned }));
    renderChat(convId);
  });
  $('#chat-archive').addEventListener('click', async () => {
    await api('/api/conversations/' + convId, jsonPatch({ archived: !meta.archived }));
    if (!meta.archived) closeChatTab(convId); else renderChat(convId);
  });
  $('#chat-fork').addEventListener('click', async () => {
    const res = await api('/api/conversations/' + convId + '/fork', jsonPost({}));
    if (res && res.conversationId) openChatConversation(res.conversationId, (meta.title || 'Conversa') + ' (cópia)');
  });
  $('#chat-delete').addEventListener('click', () => openDeleteConversationModal(convId, meta.title || 'esta conversa'));
}

function openDeleteConversationModal(convId, title) {
  openModal(`
    <div class="ds-modal__header">
      <h3 class="ds-modal__title">Apagar conversa</h3>
      <button class="ds-modal__close" data-modal-close><i data-lucide="x" class="ds-icon ds-icon--sm"></i></button>
    </div>
    <div class="ds-modal__body">
      <p class="ds-body-sm">Apagar <b>${esc(title)}</b> e todas as suas mensagens? Esta ação não pode ser desfeita.</p>
    </div>
    <div class="ds-modal__footer">
      <button class="ds-btn ds-btn--ghost" data-modal-close>Cancelar</button>
      <button class="ds-btn ds-btn--danger" id="dc-submit">Apagar</button>
    </div>
  `);
  $('#dc-submit').addEventListener('click', async () => {
    await api('/api/conversations/' + convId, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    closeModal();
    closeChatTab(convId);
  });
}

// --- Envio / streaming ---

function setChatComposerState(streaming) {
  const send = $('#chat-send');
  const cancel = $('#chat-cancel');
  const input = $('#chat-input');
  if (send) send.disabled = streaming;
  if (cancel) cancel.classList.toggle('hidden', !streaming);
  if (input) input.disabled = streaming;
}

function appendChatBubble(role, who, content) {
  const t = $('#chat-timeline');
  if (!t) return;
  $('#chat-timeline .chat-empty')?.remove();
  const div = document.createElement('div');
  div.className = `chat-msg chat-msg--${role} ds-anim-enter-slide-up`;
  div.innerHTML = `<div class="chat-msg__who">${esc(who)}</div><div class="chat-msg__body">${esc(content)}</div>`;
  t.appendChild(div);
  scrollChatTimeline();
}

function ensureLiveBubble(agentName) {
  let b = $('#chat-live-bubble');
  if (!b) {
    const t = $('#chat-timeline');
    $('#chat-timeline .chat-empty')?.remove();
    b = document.createElement('div');
    b.className = 'chat-msg chat-msg--assistant';
    b.id = 'chat-live-bubble';
    b.innerHTML = `<div class="chat-msg__who">${esc(agentName || 'Aria')}</div><div class="chat-tools" id="chat-live-tools"></div><div class="chat-msg__body"><span class="text"></span><span class="cursor ds-anim-blink"></span></div>`;
    t.appendChild(b);
    scrollChatTimeline();
  }
  return b;
}

function appendLiveDelta(text) {
  const b = ensureLiveBubble();
  b.querySelector('.text').textContent += text;
  scrollChatTimeline();
}

function addLiveToolCard(tool) {
  const c = $('#chat-live-tools') || ensureLiveBubble().querySelector('.chat-tools');
  if (!c) return;
  const card = document.createElement('div');
  card.className = 'tool-card';
  card.dataset.tool = tool || '';
  card.innerHTML = `
    <button class="tool-card__head" type="button"><i data-lucide="wrench" class="ds-icon ds-icon--xs"></i> <b>${esc(tool)}</b> <i data-lucide="chevron-down" class="ds-icon ds-icon--xs tool-card__chev"></i></button>
    <div class="tool-card__body ds-caption">Executando <code class="ds-code">${esc(tool)}</code>...</div>`;
  c.appendChild(card);
  refreshIcons();
}

function completeLiveToolCard(tool, result) {
  const cards = Array.from(document.querySelectorAll('#chat-live-tools .tool-card:not(.tool-card--done)'));
  const card = cards.reverse().find(item => item.dataset.tool === (tool || ''));
  if (!card) return;
  card.classList.add('tool-card--done');
  const body = card.querySelector('.tool-card__body');
  if (body) {
    const value = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    body.innerHTML = `<div>Concluida</div><pre class="ds-code">${esc((value || '').slice(0, 4000))}</pre>`;
  }
}

function resetLiveBubble() {
  const bubble = ensureLiveBubble();
  const text = bubble.querySelector('.text');
  if (text) text.textContent = '';
  const tools = bubble.querySelector('.chat-tools');
  if (tools) tools.innerHTML = '';
}

function finalizeLiveBubble() {
  const b = $('#chat-live-bubble');
  if (!b) return;
  b.querySelector('.cursor')?.remove();
  b.removeAttribute('id');
  b.querySelector('#chat-live-tools')?.removeAttribute('id');
}

/** Aplica uma lista de run_events (retomada/reconciliação) à bolha ativa, com dedup por sequence. */
function applyRunEventList(events) {
  for (const ev of events || []) {
    if (ev.sequence <= chatSession.lastSeq) continue;
    chatSession.lastSeq = ev.sequence;
    let pl = {};
    try { pl = ev.payload_json ? JSON.parse(ev.payload_json) : {}; } catch { pl = {}; }
    if (ev.type === 'text_delta') appendLiveDelta(pl.text || '');
    else if (ev.type === 'tool_start') addLiveToolCard(pl.tool);
    else if (ev.type === 'tool_result') completeLiveToolCard(pl.tool, pl.result);
    else if (ev.type === 'status' && pl.status === 'retrying' && pl.reason === 'fabrication') resetLiveBubble();
  }
}

/**
 * Reconcilia os eventos já persistidos de um run com o que o cliente tem. Fecha
 * a janela entre o run começar a emitir (antes do cliente saber o runId) e o
 * streaming SSE. O SSE continua dali em diante (dedup por sequence).
 */
async function syncRunEvents(runId) {
  const data = await api('/api/runs/' + runId + '/events?after=' + chatSession.lastSeq);
  if (!data || !data.run) return;
  applyRunEventList(data.events);
  if (['done', 'failed', 'cancelled', 'timed_out'].includes(data.run.status)) {
    finalizeLiveBubble();
    chatSession.streaming = false;
    setChatComposerState(false);
  }
}

async function sendChatMessage(convId) {
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text || chatSession.streaming) return;
  input.value = '';
  input.style.height = 'auto';
  appendChatBubble('user', 'Você', text);
  const res = await api('/api/conversations/' + convId + '/messages', jsonPost({ text }));
  if (res.error || !res.runId) { appendChatBubble('error', 'Sistema', res.error || 'Falha ao enviar mensagem.'); return; }
  chatSession = { convId, runId: res.runId, lastSeq: 0, streaming: true };
  setChatComposerState(true);
  ensureLiveBubble('Aria');
  // Recupera eventos já emitidos antes de o cliente conhecer o runId.
  await syncRunEvents(res.runId);
}

function cancelChatRun() {
  if (!chatSession.runId) return;
  $('#chat-cancel')?.setAttribute('disabled', 'true');
  void api('/api/runs/' + chatSession.runId + '/cancel', jsonPost({}));
}

/** Roteia eventos SSE para a conversa ativa do chat. Não consome (o feed global também os recebe). */
function handleChatEvent(evt) {
  if ($('#view-chat').classList.contains('hidden')) return;
  const p = evt.payload || {};
  if (!chatSession.convId || p.conversationId !== chatSession.convId) return;
  switch (evt.type) {
    case 'stream_delta':
      if (p.runId && p.runId === chatSession.runId) {
        if (p.seq && p.seq <= chatSession.lastSeq) return;
        if (p.seq) chatSession.lastSeq = p.seq;
        appendLiveDelta(p.text || '');
      }
      break;
    case 'tool_call':
      if (p.runId === chatSession.runId) {
        if (p.seq) chatSession.lastSeq = Math.max(chatSession.lastSeq, p.seq);
        addLiveToolCard(p.toolName);
      }
      break;
    case 'tool_result':
      if (p.runId === chatSession.runId) {
        if (p.seq) chatSession.lastSeq = Math.max(chatSession.lastSeq, p.seq);
        completeLiveToolCard(p.toolName, p.result);
      }
      break;
    case 'stream_reset':
      if (p.runId === chatSession.runId) {
        if (p.seq) chatSession.lastSeq = Math.max(chatSession.lastSeq, p.seq);
        resetLiveBubble();
      }
      break;
    case 'stream_end':
      if (p.runId === chatSession.runId) {
        finalizeLiveBubble();
        chatSession.streaming = false;
        setChatComposerState(false);
      }
      break;
    case 'error':
      if (p.runId === chatSession.runId) {
        finalizeLiveBubble();
        appendChatBubble('error', 'Sistema', p.text || 'Erro na execução.');
        chatSession.streaming = false;
        setChatComposerState(false);
      }
      break;
  }
}

// Delegação de clique para abas e tool cards (sobrevive a re-renders)
document.addEventListener('click', event => {
  const closeEl = closestFromEvent(event, '[data-chat-close]');
  if (closeEl) { event.stopPropagation(); closeChatTab(closeEl.dataset.chatClose); return; }
  const tabEl = closestFromEvent(event, '[data-chat-tab]');
  if (tabEl) { location.hash = '#/chat/' + tabEl.dataset.chatTab; return; }
  const toolHead = closestFromEvent(event, '.tool-card__head');
  if (toolHead) { toolHead.closest('.tool-card')?.classList.toggle('is-open'); }
});

// ---------- Estado global / topbar ----------

async function refreshState() {
  state = await api('/api/state');
  $('#top-model').innerHTML = `<i data-lucide="cpu" class="ds-icon ds-icon--xs"></i> <b>${esc(state.config.model)}</b>&nbsp;(${esc(state.config.provider)})`;
  const mode = state.config.shellMode;
  const shellColor = mode === 'auto' ? 'var(--ds-feedback-warning)' : 'var(--ds-feedback-success)';
  $('#top-shell').innerHTML = `<i data-lucide="terminal" class="ds-icon ds-icon--xs"></i> shell: <b style="color:${shellColor}">${esc(mode)}</b>`;
  const su = state.sessionUsage || { calls: 0, inputTokens: 0, outputTokens: 0, cacheHitRate: 0, cachedInputTokens: 0, costUsd: null };
  const cacheStr = su.cachedInputTokens > 0 ? ` (${Math.round(su.cacheHitRate * 100)}% cache)` : '';
  const costStr = su.costUsd != null ? ` · <b>$${su.costUsd.toFixed(4)}</b>` : '';
  $('#top-tokens').innerHTML = `<i data-lucide="coins" class="ds-icon ds-icon--xs"></i> hoje: <b>${fmtTokens(state.tokensToday.input)}</b>↓ <b>${fmtTokens(state.tokensToday.output)}</b>↑ · sessão: <b>${su.calls}</b>x, <b>${fmtTokens(su.inputTokens)}</b>↓${cacheStr} <b>${fmtTokens(su.outputTokens)}</b>↑${costStr}`;
  renderConfirmBanner(state.pendingConfirmations);
  refreshIcons();
}

// ---------- Visao geral ----------

let overviewFilters = { range: '7d', team: '', agent: '' };
try {
  const saved = JSON.parse(localStorage.getItem('paa.overviewFilters') || '{}');
  if (['24h', '7d', '30d'].includes(saved.range)) overviewFilters.range = saved.range;
  if (typeof saved.team === 'string') overviewFilters.team = saved.team;
  if (typeof saved.agent === 'string') overviewFilters.agent = saved.agent;
} catch { /* usa padrao */ }

function saveOverviewFilters() {
  localStorage.setItem('paa.overviewFilters', JSON.stringify(overviewFilters));
}

const RANGE_LABEL = { '24h': 'últimas 24h', '7d': 'últimos 7 dias', '30d': 'últimos 30 dias' };

/** Chip de tendência vs período anterior. mode 'pct' compara proporção; 'pp' diferença em pontos. */
function trendChip(pair, { goodWhenUp = true, mode = 'pct' } = {}) {
  const cur = pair?.current ?? 0;
  const prev = pair?.previous ?? 0;
  if (cur === 0 && prev === 0) {
    return `<span class="ds-stat-card__trend ds-stat-card__trend--flat">&mdash;</span>`;
  }
  if (prev === 0) {
    return `<span class="ds-stat-card__trend ds-stat-card__trend--flat">novo no período</span>`;
  }
  const diff = mode === 'pp' ? Math.round((cur - prev) * 100) : Math.round(((cur - prev) / prev) * 100);
  if (diff === 0) {
    return `<span class="ds-stat-card__trend ds-stat-card__trend--flat">estável vs anterior</span>`;
  }
  const arrow = diff > 0 ? '↑' : '↓';
  const good = (diff > 0) === goodWhenUp;
  const unit = mode === 'pp' ? 'pp' : '%';
  return `<span class="ds-stat-card__trend ds-stat-card__trend--${good ? 'up' : 'down'}">${arrow} ${Math.abs(diff)}${unit} vs anterior</span>`;
}

function kpiCard(label, value, sub, trend) {
  return `
    <div class="ds-stat-card">
      <span class="ds-stat-card__label">${label}</span>
      <span class="ds-stat-card__value">${value}</span>
      ${sub ? `<span class="ds-caption">${sub}</span>` : ''}
      ${trend || ''}
    </div>`;
}

async function renderOverview() {
  await refreshState();

  // Filtro pode apontar para agente/equipe que ja nao existe
  if (overviewFilters.agent && !state.agents.some(a => a.id === overviewFilters.agent)) overviewFilters.agent = '';
  const teams = [...new Set(state.agents.map(a => a.team).filter(Boolean))].sort();
  if (overviewFilters.team && !teams.includes(overviewFilters.team)) overviewFilters.team = '';

  const qs = new URLSearchParams({ range: overviewFilters.range });
  if (overviewFilters.team) qs.set('team', overviewFilters.team);
  if (overviewFilters.agent) qs.set('agent', overviewFilters.agent);
  const an = await api('/api/analytics?' + qs.toString());
  const k = an.kpis;

  // --- Barra de filtros ---
  const agentOptions = state.agents.filter(a => !overviewFilters.team || a.team === overviewFilters.team);
  const rangeBtn = (key) =>
    `<button class="ov-seg__btn${overviewFilters.range === key ? ' is-active' : ''}" data-range="${key}">${RANGE_LABEL[key].replace('últimas ', '').replace('últimos ', '')}</button>`;
  const filterBar = `
    <div class="ov-filters">
      <div class="ov-seg">${rangeBtn('24h')}${rangeBtn('7d')}${rangeBtn('30d')}</div>
      <select class="ds-select ov-select" id="ov-team" title="Filtrar por equipe">
        <option value="">Todas as equipes</option>
        ${teams.map(t => `<option value="${esc(t)}"${overviewFilters.team === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}
      </select>
      <select class="ds-select ov-select" id="ov-agent" title="Filtrar por agente">
        <option value="">Todos os agentes</option>
        ${agentOptions.map(a => `<option value="${esc(a.id)}"${overviewFilters.agent === a.id ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}
      </select>
    </div>`;

  // --- KPIs com comparacao ---
  const delegations = state.activeDelegations || [];
  const successValue = (k.tasksDone.current + k.tasksFailed.current) > 0 ? fmtPct(k.successRate.current) : '—';
  const stats = `
    <div class="ds-grid ds-grid-3 ds-stagger ov-kpis">
      ${kpiCard('Agentes ativos', k.activeAgents.current,
        `de ${overviewFilters.agent ? 1 : agentOptions.length} ${overviewFilters.team || overviewFilters.agent ? 'no filtro' : 'cadastrados'}`,
        trendChip(k.activeAgents))}
      ${kpiCard('Tarefas em execução', k.tasksInProgress,
        `${k.tasksPending} pendentes · ${delegations.length} delegações ativas`, '')}
      ${kpiCard('Taxa de sucesso', successValue,
        `${k.tasksDone.current} concluídas · ${k.tasksFailed.current} falhas`, trendChip(k.successRate, { mode: 'pp' }))}
      ${kpiCard('Tokens', fmtTokens(k.tokens.current),
        `${fmtTokens(k.inputTokens)}↓ entrada · ${fmtTokens(k.outputTokens)}↑ saída`, trendChip(k.tokens, { goodWhenUp: false }))}
      ${kpiCard('Custo', (k.cost.known ? '' : '≥ ') + fmtCost(k.cost.current),
        k.avgCallMs != null ? `média ${(k.avgCallMs / 1000).toFixed(1)}s por chamada` : 'sem chamadas registradas',
        trendChip(k.cost, { goodWhenUp: false }))}
      ${kpiCard('Cache aproveitado', fmtPct(k.cacheRate.current),
        'do input reutilizado', trendChip(k.cacheRate, { mode: 'pp' }))}
    </div>`;

  // --- Graficos ---
  const ts = an.taskStatus || {};
  const donutItems = [
    { label: 'Concluídas', value: ts.done || 0, color: 'var(--ds-feedback-success)' },
    { label: 'Em execução', value: ts.in_progress || 0, color: 'var(--ds-feedback-warning)' },
    { label: 'Pendentes', value: ts.pending || 0, color: 'var(--ds-feedback-info)' },
    { label: 'Falharam', value: ts.failed || 0, color: 'var(--ds-feedback-danger)' },
    { label: 'Canceladas', value: ts.cancelled || 0, color: 'var(--ds-text-disabled)' },
  ];
  const seriesLegend = `
    <div class="chart-legend chart-legend--row">
      <div class="chart-legend__item"><span class="chart-legend__dot" style="background:var(--ds-action-primary);"></span>entrada</div>
      <div class="chart-legend__item"><span class="chart-legend__dot" style="background:var(--ds-feedback-violet);"></span>saída</div>
      <div class="chart-legend__item"><span class="chart-legend__dot chart-legend__dot--dash" style="background:var(--ds-feedback-warning);"></span>custo</div>
    </div>`;
  const chartsRow = `
    <div class="ov-charts">
      <div class="ds-card">
        <div class="ds-card__header">
          <h3 class="ds-card__title">Tokens e custo · ${RANGE_LABEL[overviewFilters.range]}</h3>
          ${seriesLegend}
        </div>
        <div class="chart-surface">${dsCharts.timeSeries(an.series)}</div>
      </div>
      <div class="ds-card">
        <div class="ds-card__header"><h3 class="ds-card__title">Status das tarefas</h3></div>
        <div class="chart-surface chart-surface--center">${dsCharts.donut(donutItems, { centerLabel: 'tarefas', ariaLabel: 'Status das tarefas' })}</div>
      </div>
    </div>`;

  // --- Carga por agente ---
  const maxLoad = Math.max(...(an.agentLoad || []).map(a => a.inputTokens + a.outputTokens), 1);
  const loadRows = (an.agentLoad || []).map(a => {
    const total = a.inputTokens + a.outputTokens;
    const taskChips = [
      a.tasksActive ? `<span class="ds-badge ds-badge--warning">${a.tasksActive} ativa${a.tasksActive > 1 ? 's' : ''}</span>` : '',
      a.tasksDone ? `<span class="ds-badge ds-badge--success">${a.tasksDone} ok</span>` : '',
      a.tasksFailed ? `<span class="ds-badge ds-badge--danger">${a.tasksFailed} falha${a.tasksFailed > 1 ? 's' : ''}</span>` : '',
    ].join('');
    return `
      <div class="load-row" role="link" tabindex="0" data-agent-id="${esc(a.agentId)}">
        <span class="load-row__name"><i data-agent-icon="${agentIconFor(state.agents.find(ag => ag.id === a.agentId) || { id: a.agentId, name: a.name })}" class="ds-agent-icon ds-agent-icon--sm"></i><b>${esc(a.name)}</b>${a.team ? ` <span class="ds-caption">${esc(a.team)}</span>` : ''}</span>
        <div class="load-row__bar" title="${fmtTokens(a.inputTokens)}↓ entrada · ${fmtTokens(a.outputTokens)}↑ saída">
          <span style="width:${((a.inputTokens / maxLoad) * 100).toFixed(1)}%;background:var(--ds-action-primary);"></span>
          <span style="width:${((a.outputTokens / maxLoad) * 100).toFixed(1)}%;background:var(--ds-feedback-violet);"></span>
        </div>
        <span class="ds-caption load-row__meta">${fmtTokens(total)} tokens · ${a.messages} msgs</span>
        <span class="load-row__tasks">${taskChips}</span>
      </div>`;
  }).join('');
  const loadCard = `
    <div class="ds-card" style="margin-bottom:16px;">
      <div class="ds-card__header"><h3 class="ds-card__title">Carga por agente · ${RANGE_LABEL[overviewFilters.range]}</h3></div>
      ${loadRows || `<div class="ds-empty-state" style="padding:20px;"><p class="ds-body-sm ds-text-muted">Nenhuma atividade de agentes no período.</p></div>`}
    </div>`;

  // --- Hierarquia com estado ao vivo ---
  const busy = new Map();
  for (const d of delegations) {
    busy.set(d.to, 'executando');
    if (!busy.has(d.from)) busy.set(d.from, 'delegou');
  }
  const byParent = {};
  for (const a of state.agents) {
    const p = a.parent ?? '__root__';
    (byParent[p] = byParent[p] || []).push(a);
  }
  const roots = state.agents.filter(a => !a.parent);
  const lines = [];
  const walk = (agent, depth) => {
    const indent = depth === 0 ? '' : '<span class="tree-indent">' + '│&nbsp;&nbsp;'.repeat(depth - 1) + '├─&nbsp;</span>';
    const activity = busy.get(agent.id);
    const badges = [
      activity === 'executando' ? `<span class="ds-badge ds-badge--warning ds-anim-thinking"> executando</span>` : '',
      activity === 'delegou' ? `<span class="ds-badge ds-badge--info"> delegou</span>` : '',
      roleBadge(agent.role),
      agent.team ? `<span class="ds-badge ds-badge--success">${esc(agent.team)}</span>` : '',
      agent.temporary ? `<span class="ds-badge ds-badge--warning">temp</span>` : '',
      agent.fast ? `<span class="ds-badge">fast</span>` : '',
      profileBadge(agent.profileProvenance),
    ].join(' ');
    lines.push(`
      <div class="tree-node" role="link" tabindex="0" data-agent-id="${esc(agent.id)}">
        ${indent}<i data-agent-icon="${agentIconFor(agent)}" class="ds-agent-icon ds-icon--sm"></i>
        <b>${esc(agent.name)}</b> ${badges}
        <span class="ds-caption">${fmtTokens(agent.tokens.input + agent.tokens.output)} tokens</span>
      </div>`);
    for (const child of byParent[agent.id] || []) walk(child, depth + 1);
  };
  for (const r of roots) walk(r, 0);

  const teamGroups = {};
  for (const a of state.agents) {
    if (a.team) (teamGroups[a.team] = teamGroups[a.team] || []).push(a.name);
  }
  const teamHtml = Object.keys(teamGroups).length
    ? Object.entries(teamGroups).map(([t, members]) => `
        <div class="team-row">
          <i data-lucide="folder-kanban" class="ds-icon ds-icon--sm ds-text-muted"></i>
          <b>${esc(t)}</b>
          <span class="ds-caption">${esc(members.join(', '))} · workspace/${esc(t)}/</span>
        </div>`).join('')
    : `<div class="ds-empty-state" style="padding:24px;">
         <i data-lucide="users" class="ds-empty-state__icon" style="width:40px;height:40px;margin-bottom:8px;"></i>
         <p class="ds-body-sm ds-text-muted">Nenhuma equipe ainda — peça para a Aria criar uma.</p>
       </div>`;

  // Preserva o feed ao re-renderizar (eventos SSE chegam entre renders)
  const prevFeed = $('#overview-feed')?.innerHTML || '';

  $('#view-overview').innerHTML = `
    <div class="ov-header">
      <h2 class="ds-heading-2xl">Visão geral</h2>
      ${filterBar}
    </div>
    ${stats}
    ${chartsRow}
    ${loadCard}
    <div class="ds-card" style="margin-bottom:16px;">
      <div class="ds-card__header"><h3 class="ds-card__title">Hierarquia dos agentes</h3></div>
      <div class="tree">${lines.join('')}</div>
    </div>
    <div class="ds-card" style="margin-bottom:16px;">
      <div class="ds-card__header"><h3 class="ds-card__title">Equipes</h3></div>
      ${teamHtml}
    </div>
    <div class="ds-card">
      <div class="ds-card__header"><h3 class="ds-card__title">Atividade recente</h3></div>
      <div id="overview-feed" class="live-feed" style="max-height:320px;overflow-y:auto;"></div>
    </div>
  `;
  $('#overview-feed').innerHTML = prevFeed;

  document.querySelectorAll('.ov-seg__btn').forEach(btn => {
    btn.addEventListener('click', () => {
      overviewFilters.range = btn.dataset.range;
      saveOverviewFilters();
      renderOverview();
    });
  });
  $('#ov-team').onchange = e => {
    overviewFilters.team = e.target.value;
    overviewFilters.agent = '';
    saveOverviewFilters();
    renderOverview();
  };
  $('#ov-agent').onchange = e => {
    overviewFilters.agent = e.target.value;
    saveOverviewFilters();
    renderOverview();
  };
  refreshIcons();
}

// Re-renderiza a visao geral (com debounce) quando algo operacional muda
let overviewRefreshTimer = null;
function scheduleOverviewRefresh() {
  if ($('#view-overview').classList.contains('hidden')) return;
  clearTimeout(overviewRefreshTimer);
  overviewRefreshTimer = setTimeout(() => {
    if (!$('#view-overview').classList.contains('hidden')) renderOverview();
  }, 600);
}

// ---------- Agentes ----------

async function renderAgents() {
  await refreshState();
  const cards = state.agents.map(a => `
    <div class="ds-card ds-card--interactive" role="link" tabindex="0" data-agent-id="${esc(a.id)}">
      <div class="ds-card__header">
        <div class="ds-inline ds-inline-md">
          ${agentAvatar(a, 'md')}
          <div>
            <div class="ds-heading-md">${esc(a.name)}</div>
            <div class="ds-caption">${esc(a.description)}</div>
          </div>
        </div>
      </div>
      <div class="ds-card__body">
        <div class="ds-inline ds-cluster ds-cluster-sm">
          ${roleBadge(a.role)}
          ${a.team ? `<span class="ds-badge ds-badge--success">${esc(a.team)}</span>` : ''}
          ${a.temporary ? `<span class="ds-badge ds-badge--warning">temp</span>` : ''}
          ${a.fast ? `<span class="ds-badge">fast</span>` : ''}
          ${profileBadge(a.profileProvenance)}
        </div>
        <div class="ds-inline ds-cluster ds-cluster-sm" style="margin-top:10px;">
          ${aiBadge(a.provider, a.model)}
          <span class="ds-chip">${fmtTokens(a.tokens.input)}↓ ${fmtTokens(a.tokens.output)}↑</span>
        </div>
      </div>
    </div>
  `).join('');
  $('#view-agents').innerHTML = `<h2 class="ds-heading-2xl" style="margin-bottom:16px;">Agentes (${state.agents.length})</h2><div class="ds-grid ds-grid-auto-md ds-stagger">${cards}</div>`;
  refreshIcons();
}

async function renderAgentDetail(id) {
  const a = await api('/api/agents/' + id);
  if (a.error) {
    $('#view-agent-detail').innerHTML = `
      <a class="ds-btn ds-btn--ghost" href="#/agents"><i data-lucide="arrow-left" class="ds-icon ds-icon--sm"></i> voltar</a>
      <p class="ds-body-md" style="margin-top:12px;">${esc(a.error)}</p>`;
    refreshIcons();
    return;
  }

  const convs = (a.conversations || []).map(c => `
    <div class="ds-list__item conversation-link" role="button" tabindex="0" data-conversation-id="${esc(c.id)}">
      <i data-lucide="${c.type === 'group' ? 'users' : 'message-circle'}" class="ds-list__icon"></i>
      <span style="flex:1;">${esc(c.title || c.id)}</span>
      <span class="ds-caption">${c.message_count} msgs · ${esc(c.updated_at)}</span>
    </div>`
  ).join('') || `<div class="ds-empty-state" style="padding:20px;"><p class="ds-body-sm ds-text-muted">Nenhuma conversa.</p></div>`;

  const cmds = (a.commands || []).map(c => `
    <tr>
      <td>${c.exit_code === 0 ? '<span class="ds-badge ds-badge--success">ok</span>' : c.exit_code == null ? '<span class="ds-badge ds-badge--warning"></span>' : '<span class="ds-badge ds-badge--danger">' + c.exit_code + '</span>'}</td>
      <td class="ds-code">${esc(c.command)}</td>
      <td class="ds-caption">${esc(c.created_at)}</td>
    </tr>`
  ).join('');

  $('#view-agent-detail').innerHTML = `
    <a class="ds-btn ds-btn--ghost" href="#/agents"><i data-lucide="arrow-left" class="ds-icon ds-icon--sm"></i> agentes</a>
    <div class="agent-detail-header">
      ${agentAvatar(a, 'lg')}
      <h2 class="ds-heading-2xl">
        ${esc(a.name)} ${roleBadge(a.role)} ${a.team ? `<span class="ds-badge ds-badge--success">${esc(a.team)}</span>` : ''} ${profileBadge(a.profileProvenance)}
      </h2>
    </div>

    <div class="ds-card" style="margin-bottom:16px;">
      <div class="ds-card__body">
        <p class="ds-body-sm">${esc(a.description)}</p>
        <div class="ds-inline ds-cluster ds-cluster-sm" style="margin-top:10px;">
          <span class="ds-chip">superior: ${esc(a.parent ?? '—')}</span>
          ${aiBadge(a.provider ?? state.config.provider, a.model ?? state.config.model)}
          <span class="ds-chip">${a.stats.messages} mensagens</span>
          <span class="ds-chip">${fmtTokens(a.stats.inputTokens)}↓ ${fmtTokens(a.stats.outputTokens)}↑</span>
        </div>
      </div>
    </div>

    ${profileProvenanceCard(a.profileProvenance)}

    <div class="ds-card" style="margin-bottom:16px;">
      <div class="ds-card__header"><h3 class="ds-card__title">Soul (personalidade)</h3></div>
      <pre class="app-doc">${esc(a.soul || '(vazio)')}</pre>
    </div>
    <div class="ds-card" style="margin-bottom:16px;">
      <div class="ds-card__header"><h3 class="ds-card__title">Memória</h3></div>
      <pre class="app-doc">${esc(a.memory || '(vazia)')}</pre>
    </div>
    <div class="ds-card" style="margin-bottom:16px;">
      <div class="ds-card__header"><h3 class="ds-card__title">Nota diária de hoje</h3></div>
      <pre class="app-doc">${esc(a.dailyNote || '(sem registros hoje)')}</pre>
    </div>
    <div class="ds-card" style="margin-bottom:16px;">
      <div class="ds-card__header"><h3 class="ds-card__title">Comandos executados</h3></div>
      ${cmds ? `<div class="ds-table-wrapper"><table class="ds-table ds-table--hoverable"><tbody>${cmds}</tbody></table></div>` : `<p class="ds-body-sm ds-text-muted">Nenhum comando.</p>`}
    </div>
    <div class="ds-card">
      <div class="ds-card__header"><h3 class="ds-card__title">Conversas</h3></div>
      <div class="ds-list ds-list--interactive">${convs}</div>
    </div>
    <div class="ds-card hidden" id="conv-card" style="margin-top:16px;">
      <div class="ds-card__header"><h3 class="ds-card__title" id="conv-title">Conversa</h3></div>
      <div id="conv-messages"></div>
    </div>
  `;
  document.querySelectorAll('[data-conversation-id]').forEach(item => {
    const open = () => loadConversation(item.dataset.conversationId, a.name);
    item.addEventListener('click', open);
    item.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      open();
    });
  });
  refreshIcons();
}

async function loadConversationInto(convId, agentName, ids) {
  const data = await api('/api/conversations/' + convId);
  const html = (data.messages || []).map(m => `
    <div class="conv-msg">
      <div class="ds-caption">${m.role === 'user' ? 'Usuário' : esc(m.agent_id || agentName)} · ${esc(m.created_at)}</div>
      <div class="ds-body-sm">${esc(m.content)}</div>
    </div>
  `).join('');
  const card = $('#' + ids.card);
  card.classList.remove('hidden');
  $('#' + ids.title).textContent = 'Conversa ' + convId.slice(0, 8);
  $('#' + ids.messages).innerHTML = html || '(vazia)';
  card.scrollIntoView({ behavior: 'smooth' });
}

function loadConversation(convId, agentName) {
  return loadConversationInto(convId, agentName, { card: 'conv-card', title: 'conv-title', messages: 'conv-messages' });
}

// ---------- Board ----------

async function renderBoard() {
  const tasks = await api('/api/tasks');
  const icons = { pending: 'circle', in_progress: 'circle-dot', done: 'check-circle-2', failed: 'x-circle', cancelled: 'ban' };
  const badgeVariant = { pending: '', in_progress: 'warning', done: 'success', failed: 'danger', cancelled: '' };
  const byTeam = {};
  for (const t of tasks) {
    const key = t.team || '(geral)';
    (byTeam[key] = byTeam[key] || []).push(t);
  }
  const sections = Object.entries(byTeam).map(([team, list]) => `
    <div class="ds-card" style="margin-bottom:16px;">
      <div class="ds-card__header"><h3 class="ds-card__title"><i data-lucide="folder-kanban" class="ds-icon ds-icon--sm"></i> ${esc(team)}</h3></div>
      <div class="ds-list">
        ${list.map(t => `
          <div class="ds-list__item" title="${esc(t.result || '')}">
            <i data-lucide="${icons[t.status] || 'circle'}" class="ds-list__icon ${badgeVariant[t.status] ? 'ds-text-' + badgeVariant[t.status] : ''}"></i>
            <span style="flex:1;">${esc(t.title)}</span>
            ${t.assignee ? `<span class="ds-badge ds-badge--brand">@${esc(t.assignee)}</span>` : ''}
            <span class="ds-caption">${t.id}</span>
          </div>`).join('')}
      </div>
    </div>
  `).join('');
  $('#view-board').innerHTML = `<h2 class="ds-heading-2xl" style="margin-bottom:16px;">Board de tarefas</h2>${sections || `
    <div class="ds-empty-state">
      <i data-lucide="kanban-square" class="ds-empty-state__icon"></i>
      <h3 class="ds-empty-state__title">Board vazio</h3>
      <p class="ds-empty-state__description">Delegações criam tarefas aqui automaticamente.</p>
    </div>`}`;
  refreshIcons();
}

// ---------- Skills ----------

async function renderSkills() {
  const skills = await api('/api/skills');
  const html = skills.map(s => `
    <div class="ds-card">
      <div class="ds-inline ds-inline-md" style="margin-bottom:8px;">
        <i data-lucide="sparkles" class="ds-icon ds-icon--md" style="color:var(--ds-feedback-violet);"></i>
        <b class="ds-heading-md">${esc(s.id)}</b>
      </div>
      <p class="ds-caption">${esc(s.description)}</p>
    </div>
  `).join('');
  $('#view-skills').innerHTML = `<h2 class="ds-heading-2xl" style="margin-bottom:16px;">Skills (${skills.length})</h2><div class="ds-grid ds-grid-auto-md ds-stagger">${html}</div>`;
  refreshIcons();
}

// ---------- Configuracoes ----------

function settingRow(label, help, controlHtml) {
  return `
    <div class="setting-row">
      <div class="label"><b>${label}</b><span class="ds-caption">${help}</span></div>
      ${controlHtml}
    </div>`;
}

async function renderSettings() {
  await refreshState();
  const models = await api('/api/models');
  const c = state.config;

  $('#view-settings').innerHTML = `
    <h2 class="ds-heading-2xl" style="margin-bottom:16px;">Configurações</h2>
    <div class="ds-card" style="margin-bottom:16px;">
      ${settingRow('Modo auto (shell)', 'Executa comandos dos agentes sem pedir confirmação', `
        <label class="ds-switch"><input type="checkbox" class="ds-switch__input" id="set-auto" ${c.shellMode === 'auto' ? 'checked' : ''}><span class="ds-switch__track"><span class="ds-switch__thumb"></span></span></label>`)}
      ${settingRow('Heartbeat', 'Agente acorda sozinho para revisar pendências', `
        <label class="ds-switch"><input type="checkbox" class="ds-switch__input" id="set-hb" ${c.heartbeatEnabled ? 'checked' : ''}><span class="ds-switch__track"><span class="ds-switch__thumb"></span></span></label>`)}
      ${settingRow('Intervalo do heartbeat (min)', 'Frequência do ciclo autônomo', `
        <input type="number" class="ds-input" id="set-hb-min" min="1" value="${c.heartbeatIntervalMin}" style="width:90px" />`)}
      ${settingRow('Mostrar tool calls', 'Indicadores  no terminal e no painel', `
        <label class="ds-switch"><input type="checkbox" class="ds-switch__input" id="set-tools" ${c.showToolCalls ? 'checked' : ''}><span class="ds-switch__track"><span class="ds-switch__thumb"></span></span></label>`)}
      ${settingRow('Nudge de memória', 'Lembrete de persistir memória a cada N mensagens (0 desativa)', `
        <input type="number" class="ds-input" id="set-nudge" min="0" value="${c.nudgeEvery}" style="width:90px" />`)}
      ${settingRow('Modelo global', 'Usado por agentes sem modelo próprio', `
        <select class="ds-select" id="set-model" style="width:260px">
          ${models.map(m => `<option value="${esc(m.id)}" ${m.id === c.model ? 'selected' : ''}>${esc(m.name)} (${esc(m.provider)})</option>`).join('')}
        </select>`)}
    </div>
    <div class="ds-card">
      <div class="ds-card__header"><h3 class="ds-card__title">Comandos aguardando aprovação</h3></div>
      <div id="settings-pending">${pendingHtml(state.pendingConfirmations)}</div>
    </div>
  `;

  $('#set-auto').onchange = e => saveSettings({ shellMode: e.target.checked ? 'auto' : 'confirm' });
  $('#set-hb').onchange = e => saveSettings({ heartbeatEnabled: e.target.checked });
  $('#set-hb-min').onchange = e => saveSettings({ heartbeatIntervalMin: Number(e.target.value) });
  $('#set-tools').onchange = e => saveSettings({ showToolCalls: e.target.checked });
  $('#set-nudge').onchange = e => saveSettings({ nudgeEvery: Number(e.target.value) });
  $('#set-model').onchange = e => saveSettings({ model: e.target.value });
  refreshIcons();
}

async function saveSettings(patch) {
  await api('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  await refreshState();
}

// ---------- Confirmacoes pendentes ----------

function pendingHtml(pending) {
  if (!pending || pending.length === 0) {
    return `<p class="ds-body-sm ds-text-muted" style="padding:8px 0;">Nenhum comando aguardando.</p>`;
  }
  return pending.map(p => `
    <div class="confirm-item" data-confirm-id="${esc(p.id)}">
      <code class="ds-code">${esc(p.command || p.message)}</code>
      <button class="ds-btn ds-btn--success ds-btn--sm" data-confirm-id="${esc(p.id)}" data-confirm-answer="s">Permitir</button>
      ${p.allowAlways ? '<button class="ds-btn ds-btn--outline ds-btn--sm" data-confirm-id="' + esc(p.id) + '" data-confirm-answer="a">Sempre permitir</button>' : ''}
      <button class="ds-btn ds-btn--danger ds-btn--sm" data-confirm-id="${esc(p.id)}" data-confirm-answer="n">Negar</button>
    </div>
  `).join('');
}

function renderConfirmBanner(pending) {
  const banner = $('#confirm-banner');
  if (!pending || pending.length === 0) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }
  banner.classList.remove('hidden');
  banner.innerHTML = `<i data-lucide="shield-alert" class="ds-icon ds-icon--sm" style="color:var(--ds-feedback-warning);"></i> <b>Aprovação necessária:</b> ` + pendingHtml(pending);
  const sp = $('#settings-pending');
  if (sp) sp.innerHTML = pendingHtml(pending);
  refreshIcons();
}

async function answerConfirm(id, answer) {
  // Feedback otimista: trava e esmaece o item na hora do clique, sem esperar o round-trip da rede.
  document.querySelectorAll(`[data-confirm-id="${id}"]`).forEach(el => {
    el.querySelectorAll('button').forEach(b => { b.disabled = true; });
    el.style.opacity = '0.5';
    el.style.pointerEvents = 'none';
  });
  try {
    await api('/api/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, answer }),
    });
  } finally {
    await refreshState();
  }
}

document.addEventListener('click', event => {
  const button = closestFromEvent(event, '[data-confirm-answer]');
  if (!button) return;
  void answerConfirm(button.dataset.confirmId, button.dataset.confirmAnswer);
});

// ---------- Feed ao vivo (SSE) ----------

function feedTargets() {
  return [$('#live-feed'), $('#overview-feed')].filter(Boolean);
}

function addBubble(html, cls = '') {
  for (const feed of feedTargets()) {
    const div = document.createElement('div');
    div.className = 'bubble ds-anim-enter-slide-up ' + cls;
    div.innerHTML = html;
    feed.appendChild(div);
    while (feed.children.length > 80) feed.removeChild(feed.firstChild);
    feed.scrollTop = feed.scrollHeight;
  }
}

function handleEvent(evt) {
  handleChatEvent(evt);
  const p = evt.payload;
  switch (evt.type) {
    case 'stream_start': {
      for (const feed of feedTargets()) {
        const div = document.createElement('div');
        div.className = 'bubble ds-anim-enter-slide-up';
        div.dataset.agent = p.agentId;
        div.innerHTML = `<div class="bubble-who">${esc(p.agentName)}</div><span class="thinking-label ds-anim-thinking">${esc(p.agentName)} está pensando...</span><span class="text"></span><span class="cursor ds-anim-blink"></span>`;
        feed.appendChild(div);
        feed.scrollTop = feed.scrollHeight;
      }
      break;
    }
    case 'stream_delta': {
      for (const feed of feedTargets()) {
        const bubble = feed.querySelector(`.bubble[data-agent="${p.agentId}"]:last-of-type`);
        if (bubble) {
          bubble.querySelector('.thinking-label')?.remove();
          const div = bubble.querySelector('.text');
          if (div) div.textContent += p.text;
          feed.scrollTop = feed.scrollHeight;
        }
      }
      break;
    }
    case 'stream_end': {
      for (const feed of feedTargets()) {
        const bubble = feed.querySelector(`.bubble[data-agent="${p.agentId}"]:last-of-type`);
        if (bubble) {
          bubble.querySelector('.thinking-label')?.remove();
          bubble.querySelector('.cursor')?.remove();
        }
      }
      refreshState();
      break;
    }
    case 'tool_call': {
      for (const feed of feedTargets()) {
        const div = feed.querySelector(`.bubble[data-agent="${p.agentId}"]:last-of-type`);
        if (div) {
          const label = div.querySelector('.thinking-label');
          if (label) label.textContent = `executando ${p.toolName}...`;
          const chip = document.createElement('span');
          chip.className = 'ds-chip bubble-toolchip';
          chip.textContent = ' ' + p.toolName;
          div.appendChild(chip);
        }
      }
      break;
    }
    case 'chat_message':
      addBubble(`<div class="bubble-who">${esc(p.agentName)}</div>${esc(p.text)}`);
      break;
    case 'system':
      addBubble(esc(p.text), 'bubble-system');
      break;
    case 'error':
      addBubble('Erro: ' + esc(p.text), 'bubble-error');
      break;
    case 'group_header':
      addBubble('👥 Grupo iniciado: ' + esc((p.participants || []).join(', ')), 'bubble-system');
      break;
    case 'confirmations':
      renderConfirmBanner(p.pending);
      break;
    case 'delegation':
      handleDelegationEvent(p);
      break;
    case 'board_changed':
      if (!$('#view-board').classList.contains('hidden')) renderBoard();
      scheduleOverviewRefresh();
      break;
    case 'conversation_changed': {
      const m = location.hash.match(/^#\/agent\/(.+)$/);
      if (m && !$('#view-agent-detail').classList.contains('hidden')) renderAgentDetail(m[1]);
      break;
    }
    case 'tokens':
      break;
  }
}

// --- Delegacoes ao vivo (com botao de cancelar) ---
// Bolhas sao rastreadas por data-deleg-id (nao por referencia de elemento):
// sobrevivem ao re-render da visao geral, que restaura o feed via innerHTML.

function handleDelegationEvent(p) {
  if (p.status === 'start') {
    for (const feed of feedTargets()) {
      const div = document.createElement('div');
      div.className = 'bubble bubble-system ds-anim-enter-slide-up';
      div.dataset.delegId = p.id;
      div.innerHTML = `<i data-lucide="corner-down-right" class="ds-icon ds-icon--xs"></i> <b>${esc(p.agentName || p.to)}</b> trabalhando... <span class="deleg-status ds-caption"></span> <button class="ds-btn ds-btn--danger ds-btn--sm deleg-cancel" data-deleg-cancel="${esc(p.id)}">Cancelar</button>`;
      feed.appendChild(div);
      feed.scrollTop = feed.scrollHeight;
    }
    refreshIcons();
    scheduleOverviewRefresh();
    return;
  }

  document.querySelectorAll(`.bubble[data-deleg-id="${CSS.escape(p.id)}"]`).forEach(div => {
    const status = div.querySelector('.deleg-status');
    if (p.status === 'progress' && status) {
      status.textContent = ' ' + p.toolName;
    } else if (p.status === 'done' || p.status === 'failed' || p.status === 'cancelled') {
      const icon = p.status === 'done' ? '✓ concluído' : p.status === 'cancelled' ? '⊘ cancelado' : '✗ falhou';
      if (status) status.textContent = icon;
      div.querySelector('.deleg-cancel')?.remove();
    }
  });
  if (p.status !== 'progress') scheduleOverviewRefresh();
}

document.addEventListener('click', event => {
  const button = closestFromEvent(event, '[data-deleg-cancel]');
  if (!button) return;
  button.disabled = true;
  void api('/api/delegations/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: button.dataset.delegCancel }),
  });
});

function connectSse() {
  const es = new EventSource('/api/events');
  es.onopen = () => {
    $('#conn-status').textContent = 'conectado';
    $('#conn-dot').classList.add('is-on');
  };
  es.onerror = () => {
    $('#conn-status').textContent = 'reconectando...';
    $('#conn-dot').classList.remove('is-on');
  };
  es.onmessage = (e) => {
    try {
      handleEvent(JSON.parse(e.data));
    } catch { /* ignore */ }
  };
}

// ---------- Tema ----------

function initThemeToggle() {
  const toggle = $('#themeToggle');
  if (!toggle) return;
  toggle.addEventListener('change', () => {
    document.documentElement.setAttribute('data-theme', toggle.checked ? 'light' : 'dark');
  });
}

// ---------- Init ----------

function initProjectControls() {
  $('#new-project-top')?.addEventListener('click', openCreateProjectModal);
  const sel = $('#project-switcher');
  sel?.addEventListener('change', () => {
    if (sel.value) { setActiveProject(sel.value); location.hash = '#/project/' + sel.value; }
  });
}

initThemeToggle();
initProjectControls();
refreshIcons();
loadProjects().then(() => refreshState()).then(router);
connectSse();
setInterval(refreshState, 15000);
