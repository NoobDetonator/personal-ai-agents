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

  const [data, models] = await Promise.all([
    api('/api/conversations/' + convId),
    api('/api/models'),
  ]);
  const meta = data.meta || {};
  const title = meta.title || (chatTabs.find(t => t.id === convId)?.title) || 'Conversa';
  // Mantém o título da aba em sincronia
  const tab = chatTabs.find(t => t.id === convId);
  if (tab && meta.title) { tab.title = meta.title; saveChatTabs(); }

  const eventsByRun = new Map();
  for (const event of data.runEvents || []) {
    const list = eventsByRun.get(event.run_id) || [];
    list.push(event);
    eventsByRun.set(event.run_id, list);
  }
  const messagesHtml = (data.messages || []).map(m =>
    chatMsgHtml(
      m.role,
      m.role === 'user' ? 'Você' : (m.agent_id || 'Aria'),
      m.content,
      m.role === 'assistant' && m.run_id ? eventsByRun.get(m.run_id) : null,
    )
  ).join('') || `<div class="chat-empty ds-text-muted ds-body-sm">Envie a primeira mensagem para começar.</div>`;

  const inheritedModel = models.find(model => model.id === meta.inherited_model);
  const inheritedLabel = meta.inherited_source === 'project'
    ? `Projeto: ${inheritedModel?.name || meta.inherited_model}`
    : `Herdar: ${inheritedModel?.name || meta.inherited_model}`;
  const modelOptions = `<option value="">${esc(inheritedLabel)}</option>` + models.map(model =>
    `<option value="${esc(model.id)}"${model.id === meta.model_override ? ' selected' : ''}>${esc(model.name)}</option>`
  ).join('');

  view.innerHTML = `
    <div class="chat-tabs" id="chat-tabs">${chatTabsHtml(convId)}</div>
    <div class="chat-panel">
      <div class="chat-header">
        <input class="chat-title-input" id="chat-title" value="${esc(title)}" aria-label="Título da conversa">
        <label class="chat-model-control" title="Modelo usado apenas nesta conversa">
          <i data-lucide="brain-circuit" class="ds-icon ds-icon--xs"></i>
          <select class="ds-select chat-model-select" id="chat-model" aria-label="Modelo da conversa">${modelOptions}</select>
        </label>
        <div class="chat-actions">
          <button class="ds-btn ds-btn--ghost ds-btn--icon ds-btn--sm" id="chat-pin" title="${meta.pinned ? 'Desafixar' : 'Fixar'}"><i data-lucide="pin" class="ds-icon ds-icon--xs" style="${meta.pinned ? 'color:var(--ds-action-primary)' : ''}"></i></button>
          <button class="ds-btn ds-btn--ghost ds-btn--icon ds-btn--sm" id="chat-fork" title="Duplicar"><i data-lucide="copy" class="ds-icon ds-icon--xs"></i></button>
          <button class="ds-btn ds-btn--ghost ds-btn--icon ds-btn--sm" id="chat-archive" title="${meta.archived ? 'Desarquivar' : 'Arquivar'}"><i data-lucide="archive" class="ds-icon ds-icon--xs"></i></button>
          <button class="ds-btn ds-btn--ghost ds-btn--icon ds-btn--sm project-danger" id="chat-delete" title="Apagar"><i data-lucide="trash-2" class="ds-icon ds-icon--xs"></i></button>
        </div>
      </div>
      <div class="chat-timeline" id="chat-timeline">${messagesHtml}</div>
      <div class="chat-composer">
        <textarea class="ds-textarea chat-input" id="chat-input" rows="1" placeholder="Envie uma mensagem..."></textarea>
        <button class="ds-btn ds-btn--danger hidden" id="chat-cancel"><i data-lucide="square" class="ds-icon ds-icon--xs"></i> Cancelar</button>
        <button class="ds-btn ds-btn--primary ds-btn--icon" id="chat-send" title="Enviar"><i data-lucide="send" class="ds-icon ds-icon--sm"></i></button>
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
  $('#chat-model').addEventListener('change', async event => {
    const select = event.target;
    select.disabled = true;
    const result = await api('/api/conversations/' + convId, jsonPatch({ model: select.value || null }));
    if (result.error) {
      select.disabled = false;
      return;
    }
    await renderChat(convId);
  });

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

function openDeleteConversationModal(convId, title, onDeleted) {
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
    await api('/api/conversations/' + convId, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmId: convId }) });
    closeModal();
    if (typeof onDeleted === 'function') await onDeleted();
    else closeChatTab(convId);
  });
}

// --- Envio / streaming ---

function setChatComposerState(streaming) {
  const send = $('#chat-send');
  const cancel = $('#chat-cancel');
  const input = $('#chat-input');
  const model = $('#chat-model');
  if (send) send.disabled = streaming;
  if (cancel) {
    cancel.classList.toggle('hidden', !streaming);
    cancel.disabled = false;
  }
  if (input) input.disabled = streaming;
  if (model) model.disabled = streaming;
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
