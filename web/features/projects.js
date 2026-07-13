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
    : `<button class="ds-btn ds-btn--ghost ds-btn--icon ds-btn--sm" data-project-archive="${esc(p.id)}" title="Arquivar"><i data-lucide="archive" class="ds-icon ds-icon--xs"></i></button>`;
  const del = isLegacy ? '' :
    `<button class="ds-btn ds-btn--ghost ds-btn--icon ds-btn--sm project-danger" data-project-delete="${esc(p.id)}" data-project-name="${esc(p.name)}" title="Excluir"><i data-lucide="trash-2" class="ds-icon ds-icon--xs"></i></button>`;
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
        <a class="ds-btn ds-btn--outline ds-btn--sm" href="#/files"><i data-lucide="files" class="ds-icon ds-icon--xs"></i> Arquivos</a>
        ${isLegacy ? '' : '<button class="ds-btn ds-btn--outline ds-btn--sm" id="pd-backups"><i data-lucide="archive-restore" class="ds-icon ds-icon--xs"></i> Backups</button>'}
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
  $('#pd-backups')?.addEventListener('click', () => openProjectBackupsModal(p));
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
  const [models, templates] = await Promise.all([getModels(), api('/api/project-templates')]);
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
        <label class="ds-field__label">Template inicial</label>
        <select class="ds-select" id="np-template">
          ${templates.map(template => `<option value="${esc(template.id)}">${esc(template.name)} - ${esc(template.description)}</option>`).join('')}
        </select>
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
      templateId: $('#np-template').value,
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

async function openProjectBackupsModal(project) {
  const backups = await api(`/api/projects/${encodeURIComponent(project.id)}/backups`);
  const rows = backups.length ? backups.map(backup => `
    <div class="data-list-row">
      <span class="data-list-row__icon"><i data-lucide="archive" class="ds-icon ds-icon--sm"></i></span>
      <span class="data-list-row__main"><b>${esc(new Date(backup.createdAt).toLocaleString('pt-BR'))}</b><small>${backup.files} arquivos - ${fmtBytes(backup.size)}</small></span>
      <a class="ds-btn ds-btn--ghost ds-btn--sm" href="/api/projects/${encodeURIComponent(project.id)}/backup?id=${encodeURIComponent(backup.id)}" download><i data-lucide="download" class="ds-icon ds-icon--xs"></i> Baixar</a>
      <button class="ds-btn ds-btn--ghost ds-btn--icon ds-btn--sm project-danger" data-backup-delete="${esc(backup.id)}" title="Excluir"><i data-lucide="trash-2" class="ds-icon ds-icon--xs"></i></button>
    </div>`).join('') : '<div class="ds-empty-state" style="padding:24px"><p>Nenhum backup criado.</p></div>';
  openModal(`
    <div class="ds-modal__header"><div><h3 class="ds-modal__title">Backups de ${esc(project.name)}</h3><p class="ds-caption">Bundle JSON com dados e arquivos, sem .env ou chaves.</p></div><button class="ds-modal__close" data-modal-close><i data-lucide="x" class="ds-icon ds-icon--sm"></i></button></div>
    <div class="ds-modal__body"><div class="data-list">${rows}</div><div class="ds-field__error hidden" id="backup-error" style="margin-top:12px"><span></span></div></div>
    <div class="ds-modal__footer"><button class="ds-btn ds-btn--ghost" data-modal-close>Fechar</button><button class="ds-btn ds-btn--primary" id="backup-create"><i data-lucide="database-backup" class="ds-icon ds-icon--xs"></i> Criar backup</button></div>`, 'lg');
  $('#backup-create').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    const result = await api(`/api/projects/${encodeURIComponent(project.id)}/backups`, jsonPost({}));
    if (result.error) { event.currentTarget.disabled = false; return showModalError($('#backup-error'), result.error); }
    await openProjectBackupsModal(project);
  });
  document.querySelectorAll('[data-backup-delete]').forEach(button => button.addEventListener('click', () => {
    const id = button.dataset.backupDelete;
    openModal(`
      <div class="ds-modal__header"><h3 class="ds-modal__title">Excluir backup</h3><button class="ds-modal__close" data-modal-close><i data-lucide="x" class="ds-icon ds-icon--sm"></i></button></div>
      <div class="ds-modal__body"><p class="ds-body-sm">Digite o identificador exato:</p><code class="ds-code">${esc(id)}</code><input class="ds-input" id="backup-delete-confirm" style="margin-top:14px"><div class="ds-field__error hidden" id="backup-delete-error" style="margin-top:12px"><span></span></div></div>
      <div class="ds-modal__footer"><button class="ds-btn ds-btn--ghost" data-modal-close>Cancelar</button><button class="ds-btn ds-btn--danger" id="backup-delete-submit">Excluir</button></div>`);
    $('#backup-delete-submit').addEventListener('click', async () => {
      const result = await api(`/api/projects/${encodeURIComponent(project.id)}/backup?id=${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmId: $('#backup-delete-confirm').value }),
      });
      if (result.error) return showModalError($('#backup-delete-error'), result.error);
      await openProjectBackupsModal(project);
    });
  }));
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

