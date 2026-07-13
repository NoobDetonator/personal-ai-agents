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
          ${a.modelSource === 'last_usage' ? '<span class="ds-caption">ultimo uso</span>' : a.modelSource === 'project' ? '<span class="ds-caption">modelo do projeto · sem uso contabilizado</span>' : ''}
          <span class="ds-chip">${fmtTokens(a.tokens.input)}↓ ${fmtTokens(a.tokens.output)}↑</span>
        </div>
      </div>
    </div>
  `).join('');
  $('#view-agents').innerHTML = `<h2 class="ds-heading-2xl" style="margin-bottom:16px;">Agentes (${state.agents.length})</h2><div class="ds-grid ds-grid-auto-md ds-stagger">${cards}</div>`;
  refreshIcons();
}

async function renderAgentDetail(id) {
  const a = await api('/api/agents/' + id + (activeProjectId ? `?project=${encodeURIComponent(activeProjectId)}` : ''));
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
          ${a.modelSource === 'last_usage' ? '<span class="ds-caption">ultimo uso real</span>' : ''}
          <span class="ds-chip">${a.stats.messages} mensagens</span>
          <span class="ds-chip">${a.stats.calls ?? 0} chamadas de IA</span>
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
