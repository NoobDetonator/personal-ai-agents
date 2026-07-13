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
  const projectData = activeProjectId ? await api('/api/projects/' + encodeURIComponent(activeProjectId)) : null;
  const ps = projectData?.settings || {};
  const diagnostics = await api('/api/diagnostics');

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
      ${projectData ? `
    <div class="ds-card settings-section" style="margin-bottom:16px;">
      <div class="ds-card__header"><div><h3 class="ds-card__title">Configurações de ${esc(projectData.project.name)}</h3><p class="ds-caption">Sobrescritas aplicadas apenas neste projeto.</p></div><span class="ds-badge ds-badge--info">projeto</span></div>
      ${settingRow('Modelo padrão do projeto', 'Vazio herda o modelo global', `
        <select class="ds-select" id="set-project-model" style="width:260px"><option value="">Herdar global</option>${models.map(model => `<option value="${esc(model.id)}"${model.id === ps.default_model ? ' selected' : ''}>${esc(model.name)}</option>`).join('')}</select>`)}
      ${settingRow('Shell do projeto', 'Permissão independente para este workspace', `
        <select class="ds-select" id="set-project-shell" style="width:180px"><option value="">Herdar global</option><option value="confirm"${ps.shell_mode === 'confirm' ? ' selected' : ''}>Confirmar</option><option value="off"${ps.shell_mode === 'off' ? ' selected' : ''}>Desligado</option><option value="auto"${ps.shell_mode === 'auto' ? ' selected' : ''}>Automático</option></select>`)}
      ${settingRow('Timeout de delegação', 'Entre 10 e 3600 segundos', `<input type="number" class="ds-input" id="set-project-timeout" min="10" max="3600" value="${ps.delegation_timeout_sec ?? 120}" style="width:110px">`)}
      ${settingRow('Concorrência máxima', 'De 1 a 16 agentes simultâneos', `<input type="number" class="ds-input" id="set-project-concurrency" min="1" max="16" value="${ps.max_concurrency ?? 3}" style="width:90px">`)}
      ${settingRow('Memória do projeto', 'Permite que agentes leiam e gravem memórias neste escopo', `<label class="ds-switch"><input type="checkbox" class="ds-switch__input" id="set-project-memory" ${ps.memory_enabled !== 0 ? 'checked' : ''}><span class="ds-switch__track"><span class="ds-switch__thumb"></span></span></label>`)}
    </div>` : ''}
    <div class="ds-card settings-section" style="margin-bottom:16px;">
      <div class="ds-card__header"><div><h3 class="ds-card__title">Diagnóstico do sistema</h3><p class="ds-caption">Estado do backend sem expor caminhos ou segredos.</p></div><span class="ds-badge ds-badge--${diagnostics.status === 'healthy' ? 'success' : 'danger'}">${esc(diagnostics.status)}</span></div>
      <div class="diagnostic-grid">
        <div><span>Versão</span><b>${esc(diagnostics.version)}</b></div>
        <div><span>Node.js</span><b>${esc(diagnostics.runtime?.node)}</b></div>
        <div><span>Banco</span><b>${diagnostics.database?.quickCheck?.[0]?.quick_check === 'ok' ? 'íntegro' : 'revisar'}</b></div>
        <div><span>Projetos</span><b>${diagnostics.database?.counts?.projects ?? 0}</b></div>
        <div><span>Conversas</span><b>${diagnostics.database?.counts?.conversations ?? 0}</b></div>
        <div><span>Runs</span><b>${diagnostics.database?.counts?.runs ?? 0}</b></div>
        <div><span>Acesso remoto</span><b>${diagnostics.web?.remoteAccess ? 'ativo' : 'desativado'}</b></div>
        <div><span>Sessão protegida</span><b>${diagnostics.web?.sessionAuth ? 'sim' : 'não'}</b></div>
        <div><span>Senha remota</span><b>${diagnostics.web?.passwordConfigured ? 'configurada' : 'ausente'}</b></div>
        <div><span>Proxy confi&aacute;vel</span><b>${diagnostics.web?.trustProxy ? 'sim' : 'n&atilde;o'}</b></div>
        <div><span>Sess&atilde;o (min)</span><b>${diagnostics.web?.sessionTtlMinutes ?? '-'}</b></div>
        <div><span>Chat remoto</span><b>${diagnostics.web?.capabilities?.chat ? 'permitido' : 'bloqueado'}</b></div>
        <div><span>Arquivos remotos</span><b>${diagnostics.web?.capabilities?.files ? 'permitido' : 'bloqueado'}</b></div>
        <div><span>Mem&oacute;rias remotas</span><b>${diagnostics.web?.capabilities?.memory ? 'permitido' : 'bloqueado'}</b></div>
        <div><span>Ajustes remotos</span><b>${diagnostics.web?.capabilities?.settings ? 'permitido' : 'bloqueado'}</b></div>
      </div>
    </div>
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
  $('#set-project-model')?.addEventListener('change', event => saveProjectSettings({ defaultModel: event.target.value || null }));
  $('#set-project-shell')?.addEventListener('change', event => saveProjectSettings({ shellMode: event.target.value || null }));
  $('#set-project-timeout')?.addEventListener('change', event => saveProjectSettings({ delegationTimeoutSec: Number(event.target.value) }));
  $('#set-project-concurrency')?.addEventListener('change', event => saveProjectSettings({ maxConcurrency: Number(event.target.value) }));
  $('#set-project-memory')?.addEventListener('change', event => saveProjectSettings({ memoryEnabled: event.target.checked }));

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


async function saveProjectSettings(patch) {
  if (!activeProjectId) return;
  const result = await api('/api/projects/' + encodeURIComponent(activeProjectId) + '/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!result.error) await renderSettings();
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

