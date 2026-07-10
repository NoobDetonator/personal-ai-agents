/* Painel do Personal AI Agents — vanilla JS, sem dependencias.
   Visual: design system neumórfico (tokens/foundations/components/motion). */

let state = null;

const $ = (sel) => document.querySelector(sel);
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

/** Re-executa os renderizadores de icone apos qualquer innerHTML novo. */
function refreshIcons() {
  if (window.lucide) lucide.createIcons();
  if (window.dsAI) dsAI.createIcons();
  if (window.dsAgent) dsAgent.createIcons();
}

const ROLE_BADGE = { principal: 'violet', manager: 'brand', worker: 'info' };
function roleBadge(role) {
  return `<span class="ds-badge ds-badge--${ROLE_BADGE[role] || 'brand'}">${esc(role)}</span>`;
}

/** Mapeia um agente para um dos 30 icones de papel do design system. */
function agentIconFor(agent) {
  const id = (agent.id || '').toLowerCase();
  const table = [
    ['aria', 'aria'], ['critic', 'critic'], ['critico', 'critic'],
    ['creativ', 'creative'], ['design', 'creative'],
    ['narrad', 'writer'], ['writer', 'writer'], ['escrito', 'writer'], ['redator', 'writer'], ['roteirista', 'writer'],
    ['coder', 'coder'], ['dev', 'coder'], ['frontend', 'coder'], ['code', 'coder'],
    ['planej', 'planner'], ['planner', 'planner'], ['project', 'planner'],
    ['test', 'tester'], ['review', 'reviewer'], ['debug', 'debugger'],
    ['analy', 'analyst'], ['secur', 'security'], ['support', 'support'],
    ['sales', 'sales'], ['hr', 'hr'], ['legal', 'legal'], ['seo', 'seo'],
    ['translat', 'translator'], ['mentor', 'mentor'], ['database', 'database'],
  ];
  for (const [needle, icon] of table) {
    if (id.includes(needle)) return icon;
  }
  return agent.role === 'principal' ? 'aria' : agent.role === 'manager' ? 'planner' : 'assistant';
}

function aiBadge(provider, model) {
  return `<span class="ds-ai-badge ds-ai-badge--${esc(provider)}" title="${esc(model)}"><i data-ai-icon="${esc(provider)}" class="ds-ai-icon"></i>${esc(model)}</span>`;
}

// ---------- Navegacao ----------

const views = ['overview', 'live', 'agents', 'agent-detail', 'board', 'skills', 'settings'];

function show(view) {
  for (const v of views) {
    $('#view-' + v).classList.toggle('hidden', v !== view);
  }
  document.querySelectorAll('.ds-sidebar__item').forEach(item => {
    item.classList.toggle('is-active', item.dataset.view === view);
  });
}

async function router() {
  const hash = location.hash || '#/overview';
  const [, route, param] = hash.split('/');

  if (route === 'agent' && param) {
    await renderAgentDetail(param);
    show('agent-detail');
    return;
  }

  const view = views.includes(route) ? route : 'overview';
  show(view);

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

async function renderOverview() {
  await refreshState();

  const openTasks = (await api('/api/tasks')).filter(t => t.status === 'pending' || t.status === 'in_progress').length;
  const su = state.sessionUsage || { inputTokens: 0, outputTokens: 0 };

  const stats = `
    <div class="ds-grid ds-grid-4 ds-stagger" style="margin-bottom:20px;">
      <div class="ds-stat-card">
        <span class="ds-stat-card__label">Agentes</span>
        <span class="ds-stat-card__value">${state.agents.length}</span>
      </div>
      <div class="ds-stat-card">
        <span class="ds-stat-card__label">Tarefas abertas</span>
        <span class="ds-stat-card__value">${openTasks}</span>
      </div>
      <div class="ds-stat-card">
        <span class="ds-stat-card__label">Tokens hoje</span>
        <span class="ds-stat-card__value">${fmtTokens(state.tokensToday.input + state.tokensToday.output)}</span>
      </div>
      <div class="ds-stat-card">
        <span class="ds-stat-card__label">Custo sessão</span>
        <span class="ds-stat-card__value">${state.sessionUsage?.costUsd != null ? '$' + state.sessionUsage.costUsd.toFixed(3) : '—'}</span>
      </div>
    </div>`;

  const byParent = {};
  for (const a of state.agents) {
    const p = a.parent ?? '__root__';
    (byParent[p] = byParent[p] || []).push(a);
  }

  const roots = state.agents.filter(a => !a.parent);
  const lines = [];
  const walk = (agent, depth) => {
    const indent = depth === 0 ? '' : '<span class="tree-indent">' + '│&nbsp;&nbsp;'.repeat(depth - 1) + '├─&nbsp;</span>';
    const badges = [
      roleBadge(agent.role),
      agent.team ? `<span class="ds-badge ds-badge--success">${esc(agent.team)}</span>` : '',
      agent.temporary ? `<span class="ds-badge ds-badge--warning">temp</span>` : '',
      agent.fast ? `<span class="ds-badge">⚡fast</span>` : '',
    ].join(' ');
    lines.push(`
      <div class="tree-node" onclick="location.hash='#/agent/${agent.id}'">
        ${indent}<i data-agent-icon="${agentIconFor(agent)}" class="ds-agent-icon ds-icon--sm"></i>
        <b>${esc(agent.name)}</b> ${badges}
        <span class="ds-caption">${fmtTokens(agent.tokens.input + agent.tokens.output)} tokens</span>
      </div>`);
    for (const child of byParent[agent.id] || []) walk(child, depth + 1);
  };
  for (const r of roots) walk(r, 0);

  const teams = {};
  for (const a of state.agents) {
    if (a.team) (teams[a.team] = teams[a.team] || []).push(a.name);
  }
  const teamHtml = Object.keys(teams).length
    ? Object.entries(teams).map(([t, members]) => `
        <div class="team-row">
          <i data-lucide="folder-kanban" class="ds-icon ds-icon--sm ds-text-muted"></i>
          <b>${esc(t)}</b>
          <span class="ds-caption">${esc(members.join(', '))} · workspace/${esc(t)}/</span>
        </div>`).join('')
    : `<div class="ds-empty-state" style="padding:24px;">
         <i data-lucide="users" class="ds-empty-state__icon" style="width:40px;height:40px;margin-bottom:8px;"></i>
         <p class="ds-body-sm ds-text-muted">Nenhuma equipe ainda — peça para a Aria criar uma.</p>
       </div>`;

  $('#view-overview').innerHTML = `
    <h2 class="ds-heading-2xl" style="margin-bottom:16px;">Visão geral</h2>
    ${stats}
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
  refreshIcons();
}

// ---------- Agentes ----------

async function renderAgents() {
  await refreshState();
  const cards = state.agents.map(a => `
    <div class="ds-card ds-card--interactive" onclick="location.hash='#/agent/${a.id}'">
      <div class="ds-card__header">
        <div class="ds-inline ds-inline-md">
          <div class="ds-avatar ds-avatar--md"><div class="ds-avatar__fallback"><i data-agent-icon="${agentIconFor(a)}" class="ds-agent-icon ds-icon--md"></i></div></div>
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
          ${a.fast ? `<span class="ds-badge">⚡fast</span>` : ''}
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
      <button class="ds-btn ds-btn--ghost" onclick="history.back()"><i data-lucide="arrow-left" class="ds-icon ds-icon--sm"></i> voltar</button>
      <p class="ds-body-md" style="margin-top:12px;">${esc(a.error)}</p>`;
    refreshIcons();
    return;
  }

  const convs = (a.conversations || []).map(c => `
    <div class="ds-list__item" style="cursor:pointer" onclick="loadConversation('${c.id}', '${esc(a.name)}')">
      <i data-lucide="${c.type === 'group' ? 'users' : 'message-circle'}" class="ds-list__icon"></i>
      <span style="flex:1;">${esc(c.title || c.id)}</span>
      <span class="ds-caption">${c.message_count} msgs · ${esc(c.updated_at)}</span>
    </div>`
  ).join('') || `<div class="ds-empty-state" style="padding:20px;"><p class="ds-body-sm ds-text-muted">Nenhuma conversa.</p></div>`;

  const cmds = (a.commands || []).map(c => `
    <tr>
      <td>${c.exit_code === 0 ? '<span class="ds-badge ds-badge--success">ok</span>' : c.exit_code == null ? '<span class="ds-badge ds-badge--warning">⏱</span>' : '<span class="ds-badge ds-badge--danger">' + c.exit_code + '</span>'}</td>
      <td class="ds-code">${esc(c.command)}</td>
      <td class="ds-caption">${esc(c.created_at)}</td>
    </tr>`
  ).join('');

  $('#view-agent-detail').innerHTML = `
    <button class="ds-btn ds-btn--ghost" onclick="location.hash='#/agents'"><i data-lucide="arrow-left" class="ds-icon ds-icon--sm"></i> agentes</button>
    <h2 class="ds-heading-2xl" style="margin:12px 0 16px;">
      ${esc(a.name)} ${roleBadge(a.role)} ${a.team ? `<span class="ds-badge ds-badge--success">${esc(a.team)}</span>` : ''}
    </h2>

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
  refreshIcons();
}

window.loadConversation = async (convId, agentName) => {
  const data = await api('/api/conversations/' + convId);
  const html = (data.messages || []).map(m => `
    <div class="conv-msg">
      <div class="ds-caption">${m.role === 'user' ? 'Usuário' : esc(m.agent_id || agentName)} · ${esc(m.created_at)}</div>
      <div class="ds-body-sm">${esc(m.content)}</div>
    </div>
  `).join('');
  $('#conv-card').classList.remove('hidden');
  $('#conv-title').textContent = 'Conversa ' + convId.slice(0, 8);
  $('#conv-messages').innerHTML = html || '(vazia)';
  $('#conv-card').scrollIntoView({ behavior: 'smooth' });
};

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
      ${settingRow('Mostrar tool calls', 'Indicadores ⚙ no terminal e no painel', `
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
    <div class="confirm-item" data-confirm-id="${p.id}">
      <code class="ds-code">${esc(p.command || p.message)}</code>
      <button class="ds-btn ds-btn--success ds-btn--sm" onclick="answerConfirm('${p.id}','s')">Permitir</button>
      <button class="ds-btn ds-btn--outline ds-btn--sm" onclick="answerConfirm('${p.id}','a')">Sempre permitir</button>
      <button class="ds-btn ds-btn--danger ds-btn--sm" onclick="answerConfirm('${p.id}','n')">Negar</button>
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

window.answerConfirm = async (id, answer) => {
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
};

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
          chip.textContent = '⚙ ' + p.toolName;
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

const delegationBubbles = new Map(); // delegation id -> [elements]

function handleDelegationEvent(p) {
  if (p.status === 'start') {
    const els = [];
    for (const feed of feedTargets()) {
      const div = document.createElement('div');
      div.className = 'bubble bubble-system ds-anim-enter-slide-up';
      div.innerHTML = `<i data-lucide="corner-down-right" class="ds-icon ds-icon--xs"></i> <b>${esc(p.agentName || p.to)}</b> trabalhando... <span class="deleg-status ds-caption"></span> <button class="ds-btn ds-btn--danger ds-btn--sm deleg-cancel">Cancelar</button>`;
      div.querySelector('.deleg-cancel').onclick = async () => {
        await api('/api/delegations/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: p.id }),
        });
      };
      feed.appendChild(div);
      feed.scrollTop = feed.scrollHeight;
      els.push(div);
    }
    delegationBubbles.set(p.id, els);
    refreshIcons();
    return;
  }

  const els = delegationBubbles.get(p.id) || [];
  for (const div of els) {
    const status = div.querySelector('.deleg-status');
    if (p.status === 'progress' && status) {
      status.textContent = '⚙ ' + p.toolName;
    } else if (p.status === 'done' || p.status === 'failed' || p.status === 'cancelled') {
      const icon = p.status === 'done' ? '✓ concluído' : p.status === 'cancelled' ? '⊘ cancelado' : '✗ falhou';
      if (status) status.textContent = icon;
      div.querySelector('.deleg-cancel')?.remove();
    }
  }
  if (p.status !== 'progress') {
    delegationBubbles.delete(p.id);
  }
}

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

initThemeToggle();
refreshIcons();
refreshState().then(router);
connectSse();
setInterval(refreshState, 15000);
