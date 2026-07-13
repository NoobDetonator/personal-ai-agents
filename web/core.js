const $ = selector => document.querySelector(selector);

function closestFromEvent(event, selector) {
  return event.target instanceof Element ? event.target.closest(selector) : null;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (data && typeof data === 'object') {
    Object.defineProperty(data, '__status', { value: response.status, enumerable: false });
  }
  return data;
}

function fmtTokens(value) {
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M';
  if (value >= 1_000) return (value / 1_000).toFixed(1) + 'k';
  return String(value ?? 0);
}

function fmtCost(value) {
  return window.dsCharts ? window.dsCharts.fmtCost(value) : '$' + Number(value ?? 0).toFixed(4);
}

function fmtPct(fraction) {
  return Math.round((fraction ?? 0) * 100) + '%';
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
  if (window.dsAgent) window.dsAgent.createIcons();
}
