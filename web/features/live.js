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

