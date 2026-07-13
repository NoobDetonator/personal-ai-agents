function fileParent(filePath) {
  const parts = String(filePath || '').split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function fmtBytes(bytes) {
  if (bytes == null) return 'pasta';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function fileIcon(entry) {
  if (entry.kind === 'directory') return 'folder';
  return ({ markdown: 'file-text', json: 'braces', csv: 'table-2', html: 'panel-top', image: 'image', pdf: 'file-type-2', code: 'file-code-2', text: 'file-text' })[entry.viewer] || 'file';
}

function fileBreadcrumbs(directory) {
  const parts = String(directory || '').split('/').filter(Boolean);
  let current = '';
  const crumbs = ['<button class="file-crumb" data-file-dir="" title="Raiz"><i data-lucide="home" class="ds-icon ds-icon--xs"></i></button>'];
  for (const part of parts) {
    current = current ? current + '/' + part : part;
    crumbs.push(`<i data-lucide="chevron-right" class="ds-icon ds-icon--xs ds-text-muted"></i><button class="file-crumb" data-file-dir="${esc(current)}">${esc(part)}</button>`);
  }
  return crumbs.join('');
}

function safeMarkdown(source) {
  const lines = String(source || '').split(/\r?\n/);
  let inCode = false;
  const html = [];
  const inline = value => esc(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  for (const line of lines) {
    if (/^```/.test(line)) {
      html.push(inCode ? '</code></pre>' : '<pre><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) { html.push(esc(line) + '\n'); continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { const level = heading[1].length; html.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue; }
    if (/^>\s?/.test(line)) { html.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); continue; }
    if (/^[-*]\s+/.test(line)) { html.push(`<div class="md-list-item"><span>•</span><p>${inline(line.replace(/^[-*]\s+/, ''))}</p></div>`); continue; }
    if (!line.trim()) { html.push('<br>'); continue; }
    html.push(`<p>${inline(line)}</p>`);
  }
  if (inCode) html.push('</code></pre>');
  return html.join('');
}

function parseDelimited(source, delimiter) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const text = String(source || '');
  for (let index = 0; index <= text.length && rows.length < 500; index++) {
    const character = text[index] ?? '\n';
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === delimiter) { row.push(field); field = ''; }
    else if (character === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += character;
  }
  return rows;
}

function csvPreview(document) {
  const rows = parseDelimited(document.content, document.name.toLowerCase().endsWith('.tsv') ? '\t' : ',');
  if (!rows.length) return '<div class="file-empty">Tabela vazia.</div>';
  const head = rows[0].slice(0, 50).map(cell => `<th>${esc(cell)}</th>`).join('');
  const body = rows.slice(1).map(row => `<tr>${row.slice(0, 50).map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('');
  return `<div class="file-table-wrap"><table class="file-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function codePreview(content) {
  return `<div class="file-code">${String(content || '').split(/\r?\n/).map((line, index) => `<div class="file-code__line"><span>${index + 1}</span><code>${esc(line) || ' '}</code></div>`).join('')}</div>`;
}

function sandboxHtml(source) {
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; media-src data:">`;
  return '<!doctype html><html><head>' + policy + '</head><body>' + String(source || '') + '</body></html>';
}

function fileViewerHtml(document) {
  if (!document) return '<div class="file-empty"><i data-lucide="mouse-pointer-2" class="ds-icon ds-icon--lg"></i><h3>Selecione um arquivo</h3><p>Abra um item da árvore para visualizar seu conteúdo.</p></div>';
  if (document.error) return `<div class="file-empty file-empty--error"><i data-lucide="shield-alert" class="ds-icon ds-icon--lg"></i><h3>Não foi possível abrir</h3><p>${esc(document.error)}</p></div>`;
  if (document.viewer === 'markdown') return `<article class="file-markdown">${safeMarkdown(document.content)}</article>`;
  if (document.viewer === 'json') {
    let content = document.content;
    try { content = JSON.stringify(JSON.parse(document.content), null, 2); } catch { /* exibe a fonte inválida */ }
    return codePreview(content);
  }
  if (document.viewer === 'csv') return csvPreview(document);
  if (document.viewer === 'html') return `<iframe class="file-html-frame" sandbox="" referrerpolicy="no-referrer" srcdoc="${esc(sandboxHtml(document.content))}" title="Preview HTML isolado"></iframe>`;
  if (document.viewer === 'image') return `<div class="file-media"><img src="${esc(document.rawUrl)}" alt="Preview de ${esc(document.name)}"></div>`;
  if (document.viewer === 'pdf') return `<iframe class="file-pdf-frame" src="${esc(document.rawUrl)}" title="PDF ${esc(document.name)}"></iframe>`;
  return codePreview(document.content);
}

function diffPreviewHtml(data) {
  if (!data?.available) return `<div class="file-empty"><i data-lucide="git-compare" class="ds-icon ds-icon--lg"></i><h3>Diff indisponível</h3><p>${esc(data?.reason || 'Sem comparação disponível.')}</p></div>`;
  if (!data.diff) return '<div class="file-empty"><i data-lucide="badge-check" class="ds-icon ds-icon--lg"></i><h3>Sem alterações</h3><p>O arquivo coincide com o HEAD do repositório.</p></div>';
  return `<div class="file-diff">${String(data.diff).split(/\r?\n/).map(line => {
    const type = line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'remove' : line.startsWith('@@') ? 'hunk' : '';
    return `<div class="file-diff__line ${type ? 'is-' + type : ''}">${esc(line) || ' '}</div>`;
  }).join('')}</div>`;
}

function filesListHtml(entries) {
  if (!entries.length) return '<div class="file-empty file-empty--compact"><p>Esta pasta está vazia.</p></div>';
  return entries.map(entry => `
    <button class="file-tree-row" data-${entry.kind === 'directory' ? 'file-dir' : 'file-open'}="${esc(entry.path)}" title="${esc(entry.path)}">
      <i data-lucide="${fileIcon(entry)}" class="ds-icon ds-icon--sm"></i>
      <span>${esc(entry.name)}</span>
      <small>${entry.kind === 'directory' ? '' : fmtBytes(entry.size)}</small>
    </button>`).join('');
}

function searchResultsHtml(search) {
  if (!search) return '';
  if (search.error) return `<div class="file-empty file-empty--error file-empty--compact"><p>${esc(search.error)}</p></div>`;
  if (!search.results.length) return '<div class="file-empty file-empty--compact"><p>Nenhum resultado.</p></div>';
  return search.results.map(item => `
    <button class="file-search-result" data-file-open="${esc(item.path)}">
      <b>${esc(item.name)} <span>L${item.line}</span></b>
      <small>${esc(item.path)}</small>
      <p>${esc(item.preview)}</p>
    </button>`).join('') + (search.truncated ? '<p class="ds-caption ds-text-muted file-search-limit">Resultados limitados por segurança.</p>' : '');
}
