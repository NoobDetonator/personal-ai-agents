// ---------- Estado global / topbar ----------

async function refreshState() {
  state = await api('/api/state' + (activeProjectId ? `?project=${encodeURIComponent(activeProjectId)}` : ''));
  $('#top-model').innerHTML = `<i data-lucide="cpu" class="ds-icon ds-icon--xs"></i> <b>${esc(state.config.model)}</b>&nbsp;(${esc(state.config.provider)})`;
  const mode = state.config.shellMode;
  const shellColor = mode === 'auto' ? 'var(--ds-feedback-warning)' : 'var(--ds-feedback-success)';
  $('#top-shell').innerHTML = `<i data-lucide="terminal" class="ds-icon ds-icon--xs"></i> shell: <b style="color:${shellColor}">${esc(mode)}</b>`;
  const su = state.sessionUsage || { calls: 0, inputTokens: 0, outputTokens: 0, cacheHitRate: 0, cachedInputTokens: 0, costUsd: null, minimumCostUsd: 0, unmeteredCalls: 0 };
  const cacheStr = su.cachedInputTokens > 0 ? ` (${Math.round(su.cacheHitRate * 100)}% cache)` : '';
  const costStr = su.costUsd != null ? ` · <b>$${su.costUsd.toFixed(4)}</b>` : su.minimumCostUsd > 0 ? ` · <b>≥ $${su.minimumCostUsd.toFixed(4)}</b>` : '';
  const partialStr = su.unmeteredCalls ? ` · <b>${su.unmeteredCalls}</b> parcial(is)` : '';
  $('#top-tokens').innerHTML = `<i data-lucide="coins" class="ds-icon ds-icon--xs"></i> hoje: <b>${fmtTokens(state.tokensToday.input)}</b>↓ <b>${fmtTokens(state.tokensToday.output)}</b>↑ · sessão: <b>${su.calls}</b>x, <b>${fmtTokens(su.inputTokens)}</b>↓${cacheStr} <b>${fmtTokens(su.outputTokens)}</b>↑${costStr}${partialStr}`;
  renderConfirmBanner(state.pendingConfirmations);
  refreshIcons();
}

// ---------- Visao geral ----------

let overviewFilters = { range: '7d', team: '', agent: '', projects: [] };
try {
  const saved = JSON.parse(localStorage.getItem('paa.overviewFilters') || '{}');
  if (['24h', '7d', '30d'].includes(saved.range)) overviewFilters.range = saved.range;
  if (typeof saved.team === 'string') overviewFilters.team = saved.team;
  if (typeof saved.agent === 'string') overviewFilters.agent = saved.agent;
  if (Array.isArray(saved.projects)) overviewFilters.projects = saved.projects.filter(id => typeof id === 'string');
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
  const knownProjectIds = new Set(projectsCache.map(project => project.id));
  overviewFilters.projects = overviewFilters.projects.filter(id => knownProjectIds.has(id));

  const qs = new URLSearchParams({ range: overviewFilters.range });
  if (overviewFilters.team) qs.set('team', overviewFilters.team);
  if (overviewFilters.agent) qs.set('agent', overviewFilters.agent);
  for (const projectId of overviewFilters.projects) qs.append('project', projectId);
  const an = await api('/api/analytics?' + qs.toString());
  const k = an.kpis;
  const op = an.operational;

  // --- Barra de filtros ---
  const agentOptions = state.agents.filter(a => !overviewFilters.team || a.team === overviewFilters.team);
  const rangeBtn = (key) =>
    `<button class="ov-seg__btn${overviewFilters.range === key ? ' is-active' : ''}" data-range="${key}">${RANGE_LABEL[key].replace('últimas ', '').replace('últimos ', '')}</button>`;
  const selectedProjectSet = new Set(overviewFilters.projects);
  const projectScopeLabel = !overviewFilters.projects.length
    ? 'Todos os projetos'
    : overviewFilters.projects.length === 1
      ? (projectsCache.find(project => project.id === overviewFilters.projects[0])?.name || '1 projeto')
      : `${overviewFilters.projects.length} projetos`;
  const projectFilter = `
    <details class="ov-project-filter" id="ov-project-filter">
      <summary><i data-lucide="layers-3" class="ds-icon ds-icon--xs"></i><span>${esc(projectScopeLabel)}</span><i data-lucide="chevron-down" class="ds-icon ds-icon--xs"></i></summary>
      <div class="ov-project-menu">
        <div class="ov-project-menu__head"><b>Escopo dos dados</b><span class="ds-caption">Seleção múltipla</span></div>
        <div class="ov-project-menu__actions">
          <button type="button" id="ov-project-all">Todos</button>
          ${activeProjectId ? '<button type="button" id="ov-project-active">Projeto ativo</button>' : ''}
        </div>
        <div class="ov-project-options">
          ${projectsCache.map(project => `
            <label class="ov-project-option">
              <input type="checkbox" data-ov-project="${esc(project.id)}"${selectedProjectSet.has(project.id) ? ' checked' : ''}>
              <span><b>${esc(project.name)}</b><small>${project.status === 'archived' ? 'Arquivado' : 'Ativo'}</small></span>
            </label>`).join('')}
        </div>
      </div>
    </details>`;

  const filterBar = `
    <div class="ov-filters">
      ${projectFilter}
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
      ${kpiCard('Runs', op.runs.current,
        op.avgRunMs != null ? `média ${(op.avgRunMs / 1000).toFixed(1)}s · ${op.runsDone} concluídos` : 'sem execuções registradas',
        trendChip(op.runs))}
      ${kpiCard('Tool calling', fmtPct(op.toolCallRate.current),
        `${op.toolCalls.current} chamadas � ${op.toolResults || 0} resultados � ${fmtPct(op.toolSuccessRate || 0)} sucesso � ${op.skillActivations || 0} skills`, trendChip(op.toolCallRate, { mode: 'pp' }))}
      ${kpiCard('Timeouts', op.runsTimedOut,
        `${op.runsFailed} falhas · ${op.runsCancelled} cancelados`,
        op.runsTimedOut ? '<span class="ds-stat-card__trend ds-stat-card__trend--down">requer atenção</span>' : '<span class="ds-stat-card__trend ds-stat-card__trend--up">sem timeouts</span>')}
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

  const runItems = [
    { label: 'Concluídos', value: op.runsDone || 0, color: 'var(--ds-feedback-success)' },
    { label: 'Em execução', value: (an.runStatus.running || 0) + (an.runStatus.waiting_confirmation || 0), color: 'var(--ds-feedback-warning)' },
    { label: 'Falharam', value: op.runsFailed || 0, color: 'var(--ds-feedback-danger)' },
    { label: 'Timeout', value: op.runsTimedOut || 0, color: 'var(--ds-feedback-violet)' },
    { label: 'Cancelados', value: op.runsCancelled || 0, color: 'var(--ds-text-disabled)' },
  ];
  const projectRows = (an.projectBreakdown || []).map(project => {
    const totalTokens = project.inputTokens + project.outputTokens;
    return `
      <div class="project-analytics-row" data-project-analytics="${esc(project.projectId)}">
        <span class="project-analytics-row__name"><i data-lucide="${project.projectId === 'legacy' ? 'archive' : 'folder-git-2'}" class="ds-icon ds-icon--sm"></i><span><b>${esc(project.name)}</b><small>${esc(project.status)}</small></span></span>
        <span><b>${fmtTokens(totalTokens)}</b><small>tokens</small></span>
        <span><b>${project.costKnown ? '' : '≥ '}${fmtCost(project.cost)}</b><small>custo</small></span>
        <span><b>${project.runs}</b><small>runs</small></span>
        <span><b>${project.toolCalls}</b><small>tools</small></span>
        <span class="${project.timeouts ? 'project-analytics-row__danger' : ''}"><b>${project.timeouts}</b><small>timeouts</small></span>
      </div>`;
  }).join('');
  const operationalRow = `
    <div class="ov-charts ov-charts--operations">
      <div class="ds-card">
        <div class="ds-card__header"><h3 class="ds-card__title">Saúde das execuções</h3><span class="ds-caption">${fmtPct(op.successRate.current)} de sucesso</span></div>
        <div class="chart-surface chart-surface--center">${dsCharts.donut(runItems, { centerLabel: 'runs', ariaLabel: 'Status das execuções' })}</div>
      </div>
      <div class="ds-card project-analytics-card">
        <div class="ds-card__header"><h3 class="ds-card__title">Atividade por projeto</h3><span class="ds-caption">totais do escopo selecionado</span></div>
        <div class="project-analytics-list">${projectRows || '<div class="file-empty file-empty--compact"><p>Sem atividade no período.</p></div>'}</div>
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
        <span class="ds-caption load-row__meta">${fmtTokens(total)} tokens · ${a.messages} msgs · ${a.runs} runs · ${a.toolCalls} tools</span>
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
    ${operationalRow}
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
  document.querySelectorAll('[data-ov-project]').forEach(input => {
    input.addEventListener('change', () => {
      const selected = Array.from(document.querySelectorAll('[data-ov-project]:checked')).map(item => item.dataset.ovProject);
      overviewFilters.projects = selected.length === projectsCache.length ? [] : selected;
      saveOverviewFilters();
      renderOverview();
    });
  });
  $('#ov-project-all')?.addEventListener('click', () => {
    overviewFilters.projects = [];
    saveOverviewFilters();
    renderOverview();
  });
  $('#ov-project-active')?.addEventListener('click', () => {
    overviewFilters.projects = activeProjectId ? [activeProjectId] : [];
    saveOverviewFilters();
    renderOverview();
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
