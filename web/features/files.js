// ---------- Arquivos do projeto ----------

let fileBrowser = { projectId: null, directory: '', document: null, search: null };

function fileTabsKey(projectId) { return 'paa.fileTabs.' + projectId; }
function loadFileTabs(projectId) {
  try {
    const tabs = JSON.parse(localStorage.getItem(fileTabsKey(projectId)) || '[]');
    return Array.isArray(tabs) ? tabs.filter(item => item && typeof item.path === 'string').slice(-12) : [];
  } catch { return []; }
}
function saveFileTabs(projectId, tabs) {
  localStorage.setItem(fileTabsKey(projectId), JSON.stringify(tabs.slice(-12)));
}
function rememberFileTab(projectId, doc) {
  const tabs = loadFileTabs(projectId).filter(tab => tab.path !== doc.path);
  tabs.push({ path: doc.path, name: doc.name, viewer: doc.viewer });
  saveFileTabs(projectId, tabs);
  return tabs;
}
function closeFileTab(projectId, filePath) {
  const tabs = loadFileTabs(projectId).filter(tab => tab.path !== filePath);
  saveFileTabs(projectId, tabs);
  if (fileBrowser.document?.path === filePath) {
    const next = tabs[tabs.length - 1];
    location.hash = next ? '#/files/' + encodeURIComponent(next.path) : '#/files';
    if (!next && location.hash === '#/files') void renderFiles(null);
  } else {
    void renderFiles(fileBrowser.document?.path || null);
  }
}
function openProjectFile(filePath) {
  location.hash = '#/files/' + encodeURIComponent(filePath);
}
function fileTabsHtml(projectId, activePath) {
  return loadFileTabs(projectId).map(tab => `
    <div class="chat-tab file-tab${tab.path === activePath ? ' is-active' : ''}" role="tab" tabindex="0" data-file-tab="${esc(tab.path)}">
      <i data-lucide="${fileIcon({ kind: 'file', viewer: tab.viewer })}" class="ds-icon ds-icon--xs"></i>
      <span class="chat-tab__label">${esc(tab.name)}</span>
      <button class="chat-tab__close" data-file-tab-close="${esc(tab.path)}" title="Fechar" aria-label="Fechar aba"><i data-lucide="x" class="ds-icon ds-icon--xs"></i></button>
    </div>`).join('');
}
function fileNameInCurrentDirectory(name) {
  const clean = String(name || '').trim();
  if (!clean || /[\\/]/.test(clean) || clean === '.' || clean === '..') return null;
  return fileBrowser.directory ? fileBrowser.directory + '/' + clean : clean;
}

function startFileEditor(doc) {
  if (!doc || typeof doc.content !== 'string') return;
  const viewer = $('#file-viewer');
  viewer.innerHTML = `
    <div class="file-editor">
      <div class="file-editor__bar">
        <span><i data-lucide="shield-check" class="ds-icon ds-icon--xs"></i> ETag protegido</span>
        <span id="file-editor-state">Alterações ainda não salvas</span>
      </div>
      <textarea id="file-editor-input" spellcheck="false" aria-label="Editor de ${esc(doc.name)}">${esc(doc.content)}</textarea>
      <div class="file-editor__actions">
        <button class="ds-btn ds-btn--ghost ds-btn--sm" id="file-editor-cancel">Cancelar</button>
        <button class="ds-btn ds-btn--primary ds-btn--sm" id="file-editor-save"><i data-lucide="save" class="ds-icon ds-icon--xs"></i> Salvar</button>
      </div>
    </div>`;
  const input = $('#file-editor-input');
  const stateLabel = $('#file-editor-state');
  const cancel = () => { viewer.innerHTML = fileViewerHtml(doc); refreshIcons(); };
  const save = async () => {
    const button = $('#file-editor-save');
    button.disabled = true;
    stateLabel.textContent = 'Salvando...';
    const result = await api(`/api/projects/${encodeURIComponent(activeProjectId)}/file`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'If-Match': doc.etag },
      body: JSON.stringify({ path: doc.path, content: input.value }),
    });
    if (result.error) {
      stateLabel.textContent = result.__status === 409
        ? 'Conflito: o arquivo mudou. Copie seu rascunho e recarregue.'
        : result.error;
      stateLabel.classList.add('is-error');
      button.disabled = false;
      return;
    }
    fileBrowser.document = result.document;
    await renderFiles(result.document.path);
  };
  $('#file-editor-cancel').addEventListener('click', cancel);
  $('#file-editor-save').addEventListener('click', save);
  input.addEventListener('input', () => { stateLabel.textContent = 'Alterações ainda não salvas'; stateLabel.classList.remove('is-error'); });
  input.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
  });
  input.focus();
  refreshIcons();
}

function openCreateFileItemModal(kind) {
  const directoryLabel = fileBrowser.directory || 'raiz';
  openModal(`
    <div class="ds-modal__header"><h3 class="ds-modal__title">Nova ${kind === 'directory' ? 'pasta' : 'arquivo'}</h3><button class="ds-modal__close" data-modal-close><i data-lucide="x" class="ds-icon ds-icon--sm"></i></button></div>
    <div class="ds-modal__body">
      <p class="ds-caption">Destino: ${esc(directoryLabel)}</p>
      <div class="ds-field" style="margin-top:14px;"><label class="ds-field__label">Nome</label><input class="ds-input" id="new-file-name" autocomplete="off" placeholder="${kind === 'directory' ? 'componentes' : 'README.md'}"></div>
      <div class="ds-field__error hidden" id="new-file-error" style="margin-top:12px;"><span></span></div>
    </div>
    <div class="ds-modal__footer"><button class="ds-btn ds-btn--ghost" data-modal-close>Cancelar</button><button class="ds-btn ds-btn--primary" id="new-file-submit">Criar</button></div>`);
  const submit = async () => {
    const target = fileNameInCurrentDirectory($('#new-file-name').value);
    if (!target) return showModalError($('#new-file-error'), 'Use somente um nome, sem barras.');
    let result;
    if (kind === 'directory') {
      result = await api(`/api/projects/${encodeURIComponent(activeProjectId)}/files`, jsonPost({ kind: 'directory', path: target }));
    } else {
      result = await api(`/api/projects/${encodeURIComponent(activeProjectId)}/file`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'If-None-Match': '*' },
        body: JSON.stringify({ path: target, content: '' }),
      });
    }
    if (result.error) return showModalError($('#new-file-error'), result.error);
    closeModal();
    if (kind === 'file') openProjectFile(target); else await renderFiles(null);
  };
  $('#new-file-submit').addEventListener('click', submit);
  $('#new-file-name').addEventListener('keydown', event => { if (event.key === 'Enter') void submit(); });
  $('#new-file-name').focus();
}

function openRenameFileModal(doc) {
  openModal(`
    <div class="ds-modal__header"><h3 class="ds-modal__title">Renomear arquivo</h3><button class="ds-modal__close" data-modal-close><i data-lucide="x" class="ds-icon ds-icon--sm"></i></button></div>
    <div class="ds-modal__body"><div class="ds-field"><label class="ds-field__label">Novo nome</label><input class="ds-input" id="rename-file-name" value="${esc(doc.name)}"></div><div class="ds-field__error hidden" id="rename-file-error" style="margin-top:12px;"><span></span></div></div>
    <div class="ds-modal__footer"><button class="ds-btn ds-btn--ghost" data-modal-close>Cancelar</button><button class="ds-btn ds-btn--primary" id="rename-file-submit">Renomear</button></div>`);
  $('#rename-file-submit').addEventListener('click', async () => {
    const destination = fileNameInCurrentDirectory($('#rename-file-name').value);
    if (!destination) return showModalError($('#rename-file-error'), 'Use somente um nome, sem barras.');
    const result = await api(`/api/projects/${encodeURIComponent(activeProjectId)}/file/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'If-Match': doc.etag },
      body: JSON.stringify({ path: doc.path, destination }),
    });
    if (result.error) return showModalError($('#rename-file-error'), result.error);
    saveFileTabs(activeProjectId, loadFileTabs(activeProjectId).filter(tab => tab.path !== doc.path));
    closeModal();
    openProjectFile(result.path);
  });
}

function openDeleteFileModal(doc) {
  openModal(`
    <div class="ds-modal__header"><h3 class="ds-modal__title">Excluir arquivo</h3><button class="ds-modal__close" data-modal-close><i data-lucide="x" class="ds-icon ds-icon--sm"></i></button></div>
    <div class="ds-modal__body"><p class="ds-body-sm">Digite o caminho exato para confirmar:</p><code class="ds-code">${esc(doc.path)}</code><input class="ds-input" id="delete-file-confirm" style="margin-top:14px" autocomplete="off"><div class="ds-field__error hidden" id="delete-file-error" style="margin-top:12px;"><span></span></div></div>
    <div class="ds-modal__footer"><button class="ds-btn ds-btn--ghost" data-modal-close>Cancelar</button><button class="ds-btn ds-btn--danger" id="delete-file-submit">Excluir</button></div>`);
  $('#delete-file-submit').addEventListener('click', async () => {
    const result = await api(`/api/projects/${encodeURIComponent(activeProjectId)}/file`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'If-Match': doc.etag },
      body: JSON.stringify({ path: doc.path, confirmPath: $('#delete-file-confirm').value }),
    });
    if (result.error) return showModalError($('#delete-file-error'), result.error);
    saveFileTabs(activeProjectId, loadFileTabs(activeProjectId).filter(tab => tab.path !== doc.path));
    closeModal();
    location.hash = '#/files';
    await renderFiles(null);
  });
}

async function renderFiles(requestedFile = null) {
  const view = $('#view-files');
  if (!activeProjectId) {
    await loadProjects();
    activeProjectId = projectsCache.find(project => project.status === 'active')?.id || projectsCache[0]?.id || null;
  }
  if (!activeProjectId) {
    view.innerHTML = `<div class="ds-empty-state"><i data-lucide="folder-x" class="ds-icon ds-icon--lg"></i><h3>Nenhum projeto</h3><p>Crie um projeto para navegar pelos arquivos.</p></div>`;
    refreshIcons();
    return;
  }
  if (fileBrowser.projectId !== activeProjectId) fileBrowser = { projectId: activeProjectId, directory: '', document: null, search: null };
  if (requestedFile) fileBrowser.directory = fileParent(requestedFile);
  view.innerHTML = `<div class="file-loading"><span class="ds-spinner"></span> Carregando arquivos...</div>`;

  const listing = await api(`/api/projects/${encodeURIComponent(activeProjectId)}/files?path=${encodeURIComponent(fileBrowser.directory)}`);
  if (requestedFile) {
    fileBrowser.document = await api(`/api/projects/${encodeURIComponent(activeProjectId)}/file?path=${encodeURIComponent(requestedFile)}`);
    if (!fileBrowser.document.error) rememberFileTab(activeProjectId, fileBrowser.document);
  } else {
    fileBrowser.document = null;
  }
  const project = projectsCache.find(item => item.id === activeProjectId);
  const entries = listing.entries || [];
  const doc = fileBrowser.document;
  view.innerHTML = `
    <div class="files-header">
      <div><p class="ds-eyebrow">Workspace</p><h2 class="ds-heading-2xl">Arquivos de ${esc(project?.name || 'projeto')}</h2></div>
      <div class="files-security"><i data-lucide="shield-check" class="ds-icon ds-icon--sm"></i><span>Leitura e edição protegidas · isolado por projeto</span></div>
    </div>
    <div class="files-shell">
      <aside class="files-explorer">
        <form class="file-search" id="file-search-form">
          <i data-lucide="search" class="ds-icon ds-icon--xs"></i>
          <input id="file-search-input" aria-label="Buscar nos arquivos" placeholder="Buscar conteúdo..." value="${esc(fileBrowser.search?.query || '')}">
          <button type="submit" title="Buscar"><i data-lucide="arrow-right" class="ds-icon ds-icon--xs"></i></button>
          ${fileBrowser.search ? '<button type="button" id="file-search-clear" title="Limpar busca"><i data-lucide="x" class="ds-icon ds-icon--xs"></i></button>' : ''}
        </form>
        <div class="file-explorer-title">
          <b>${fileBrowser.search ? 'Resultados' : 'Explorador'}</b>
          <div class="file-explorer-actions">
            <button class="ds-btn ds-btn--ghost ds-btn--icon ds-btn--sm" id="file-new-file" title="Novo arquivo"><i data-lucide="file-plus-2" class="ds-icon ds-icon--xs"></i></button>
            <button class="ds-btn ds-btn--ghost ds-btn--icon ds-btn--sm" id="file-new-folder" title="Nova pasta"><i data-lucide="folder-plus" class="ds-icon ds-icon--xs"></i></button>
          </div>
          ${fileBrowser.directory && !fileBrowser.search ? `<button class="ds-btn ds-btn--ghost ds-btn--icon ds-btn--sm" data-file-dir="${esc(fileParent(fileBrowser.directory))}" title="Subir"><i data-lucide="corner-left-up" class="ds-icon ds-icon--xs"></i></button>` : ''}
        </div>
        <div class="file-tree">${fileBrowser.search ? searchResultsHtml(fileBrowser.search) : (listing.error ? `<div class="file-empty file-empty--error"><p>${esc(listing.error)}</p></div>` : filesListHtml(entries))}</div>
      </aside>
      <section class="files-workbench">
        <div class="file-tabs chat-tabs">${fileTabsHtml(activeProjectId, doc?.path)}</div>
        <div class="file-toolbar">
          <div class="file-breadcrumbs">${fileBreadcrumbs(fileBrowser.directory)}</div>
          ${doc && !doc.error ? `<div class="file-meta"><span class="ds-badge ds-badge--info">${esc(doc.viewer)}</span><span>${fmtBytes(doc.size)}</span>${typeof doc.content === 'string' ? '<button class="ds-btn ds-btn--primary ds-btn--sm" id="file-edit"><i data-lucide="pencil-line" class="ds-icon ds-icon--xs"></i> Editar</button>' : ''}<button class="ds-btn ds-btn--ghost ds-btn--sm" id="file-rename"><i data-lucide="text-cursor-input" class="ds-icon ds-icon--xs"></i> Renomear</button><button class="ds-btn ds-btn--ghost ds-btn--icon ds-btn--sm project-danger" id="file-delete" title="Excluir"><i data-lucide="trash-2" class="ds-icon ds-icon--xs"></i></button><button class="ds-btn ds-btn--ghost ds-btn--sm" id="file-diff"><i data-lucide="git-compare" class="ds-icon ds-icon--xs"></i> Diff</button></div>` : ''}
        </div>
        <div class="file-viewer" id="file-viewer">${fileViewerHtml(doc)}</div>
      </section>
    </div>`;

  view.querySelectorAll('[data-file-dir]').forEach(button => button.addEventListener('click', () => {
    fileBrowser.directory = button.dataset.fileDir || '';
    fileBrowser.document = null;
    fileBrowser.search = null;
    if (location.hash !== '#/files') location.hash = '#/files'; else void renderFiles(null);
  }));
  view.querySelectorAll('[data-file-open],[data-file-tab]').forEach(button => button.addEventListener('click', () => openProjectFile(button.dataset.fileOpen || button.dataset.fileTab)));
  view.querySelectorAll('[data-file-tab-close]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation(); closeFileTab(activeProjectId, button.dataset.fileTabClose);
  }));
  $('#file-search-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const query = $('#file-search-input').value.trim();
    if (query.length < 2) return;
    fileBrowser.search = await api(`/api/projects/${encodeURIComponent(activeProjectId)}/search?q=${encodeURIComponent(query)}`);
    await renderFiles(doc?.path || null);
  });
  $('#file-search-clear')?.addEventListener('click', async () => { fileBrowser.search = null; await renderFiles(doc?.path || null); });
  $('#file-diff')?.addEventListener('click', async () => {
    const button = $('#file-diff');
    button.disabled = true;
    const data = await api(`/api/projects/${encodeURIComponent(activeProjectId)}/diff?path=${encodeURIComponent(doc.path)}`);
    $('#file-viewer').innerHTML = diffPreviewHtml(data);
    button.disabled = false;
    refreshIcons();
  });
  $('#file-new-file')?.addEventListener('click', () => openCreateFileItemModal('file'));
  $('#file-new-folder')?.addEventListener('click', () => openCreateFileItemModal('directory'));
  $('#file-edit')?.addEventListener('click', () => startFileEditor(doc));
  $('#file-rename')?.addEventListener('click', () => openRenameFileModal(doc));
  $('#file-delete')?.addEventListener('click', () => openDeleteFileModal(doc));
  refreshIcons();
}


