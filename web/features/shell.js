let state = null;

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

const views = ['projects', 'project-detail', 'chat', 'overview', 'live', 'agents', 'agent-detail', 'board', 'files', 'memory', 'skills', 'settings'];

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

  if (route === 'files') {
    show('files');
    let filePath = null;
    try { filePath = param ? decodeURIComponent(param) : null; } catch { filePath = null; }
    await renderFiles(filePath);
    return;
  }

  const view = views.includes(route) ? route : 'projects';
  show(view);

  if (view === 'projects') await renderProjects();
  if (view === 'overview') await renderOverview();
  if (view === 'agents') await renderAgents();
  if (view === 'board') await renderBoard();
  if (view === 'skills') await renderSkills();
  if (view === 'memory') await renderMemory();
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

