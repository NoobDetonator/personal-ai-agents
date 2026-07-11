/* Graficos SVG nativos do painel — sem dependencias, tematizados via CSS vars.
   Cores so funcionam em style="" (presentation attributes nao aceitam var()). */

(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function fmtTokens(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
    return String(Math.round(n ?? 0));
  }

  function fmtCost(n) {
    if (n >= 1) return '$' + n.toFixed(2);
    if (n >= 0.01) return '$' + n.toFixed(3);
    return '$' + n.toFixed(4);
  }

  /** 'YYYY-MM-DD' -> 'DD/MM'; 'YYYY-MM-DD HH:00' -> 'HH:00'. */
  function shortBucket(bucket) {
    const hour = bucket.match(/ (\d{2}:\d{2})$/);
    if (hour) return hour[1];
    const day = bucket.match(/^\d{4}-(\d{2})-(\d{2})$/);
    return day ? `${day[2]}/${day[1]}` : bucket;
  }

  const COLORS = {
    input: 'var(--ds-action-primary)',
    output: 'var(--ds-feedback-violet)',
    cost: 'var(--ds-feedback-warning)',
    grid: 'var(--ds-border-subtle)',
    text: 'var(--ds-text-muted)',
  };

  const emptyState = (msg) => `<div class="chart-empty ds-body-sm ds-text-muted">${esc(msg)}</div>`;

  /**
   * Serie temporal de tokens (areas: input/output) + custo (linha tracejada,
   * eixo proprio a direita). points: [{ bucket, input, output, cost }].
   */
  function timeSeries(points, opts = {}) {
    if (!points.length || !points.some(p => p.input || p.output || p.cost)) {
      return emptyState(opts.emptyMessage || 'Sem atividade no período.');
    }

    const W = 720, H = 230;
    const m = { l: 48, r: 52, t: 14, b: 28 };
    const innerW = W - m.l - m.r;
    const innerH = H - m.t - m.b;
    const n = points.length;

    const maxY = Math.max(1, ...points.map(p => Math.max(p.input, p.output)));
    const maxCost = Math.max(...points.map(p => p.cost), 0);

    const xs = (i) => m.l + (n === 1 ? innerW / 2 : (i * innerW) / (n - 1));
    const yTok = (v) => m.t + innerH - (v / maxY) * innerH;
    const yCost = (v) => maxCost > 0 ? m.t + innerH - (v / maxCost) * innerH : m.t + innerH;

    const linePath = (get) => points.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${get(p).toFixed(1)}`).join('');
    const areaPath = (get) =>
      `${linePath(get)}L${xs(n - 1).toFixed(1)},${(m.t + innerH).toFixed(1)}L${xs(0).toFixed(1)},${(m.t + innerH).toFixed(1)}Z`;

    // Grid + eixo esquerdo (tokens)
    const gridLines = [0, 0.5, 1].map(f => {
      const y = (m.t + innerH - f * innerH).toFixed(1);
      return `<line x1="${m.l}" y1="${y}" x2="${W - m.r}" y2="${y}" style="stroke:${COLORS.grid};" stroke-width="1"/>` +
        `<text x="${m.l - 6}" y="${y}" dy="4" text-anchor="end" font-size="10" style="fill:${COLORS.text};">${fmtTokens(maxY * f)}</text>`;
    }).join('');

    // Eixo direito (custo)
    const costAxis = maxCost > 0
      ? `<text x="${W - m.r + 6}" y="${m.t}" dy="4" font-size="10" style="fill:${COLORS.cost};">${fmtCost(maxCost)}</text>` +
        `<text x="${W - m.r + 6}" y="${m.t + innerH}" dy="4" font-size="10" style="fill:${COLORS.cost};">$0</text>`
      : '';

    // Rotulos do eixo X: primeiro, meio, ultimo
    const xIdx = n >= 3 ? [0, Math.floor((n - 1) / 2), n - 1] : n === 2 ? [0, 1] : [0];
    const xLabels = xIdx.map(i =>
      `<text x="${xs(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" style="fill:${COLORS.text};">${esc(shortBucket(points[i].bucket))}</text>`
    ).join('');

    // Colunas invisiveis de hover com tooltip nativo
    const colW = n > 1 ? innerW / (n - 1) : innerW;
    const hovers = points.map((p, i) => {
      const x = (xs(i) - colW / 2).toFixed(1);
      const title = `${p.bucket}\n↓ ${fmtTokens(p.input)} entrada · ↑ ${fmtTokens(p.output)} saída` +
        (p.cost > 0 ? ` · ${fmtCost(p.cost)}` : '');
      return `<rect x="${x}" y="${m.t}" width="${colW.toFixed(1)}" height="${innerH}" fill="transparent"><title>${esc(title)}</title></rect>`;
    }).join('');

    const costLine = maxCost > 0
      ? `<path d="${linePath(p => yCost(p.cost))}" fill="none" style="stroke:${COLORS.cost};" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round"/>`
      : '';

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Tokens e custo por período" preserveAspectRatio="xMidYMid meet">
      ${gridLines}${costAxis}
      <path d="${areaPath(p => yTok(p.input))}" style="fill:${COLORS.input};" opacity="0.16"/>
      <path d="${areaPath(p => yTok(p.output))}" style="fill:${COLORS.output};" opacity="0.16"/>
      <path d="${linePath(p => yTok(p.input))}" fill="none" style="stroke:${COLORS.input};" stroke-width="2" stroke-linejoin="round"/>
      <path d="${linePath(p => yTok(p.output))}" fill="none" style="stroke:${COLORS.output};" stroke-width="2" stroke-linejoin="round"/>
      ${costLine}
      ${xLabels}
      ${hovers}
    </svg>`;
  }

  /**
   * Donut com total no centro e legenda ao lado.
   * items: [{ label, value, color }].
   */
  function donut(items, opts = {}) {
    const total = items.reduce((s, i) => s + i.value, 0);
    if (!total) return emptyState(opts.emptyMessage || 'Nenhuma tarefa no período.');

    const r = 56, cx = 80, cy = 80, sw = 20;
    const circ = 2 * Math.PI * r;
    let offset = 0;
    const segments = items.filter(i => i.value > 0).map(i => {
      const dash = (i.value / total) * circ;
      const seg = `<circle r="${r}" cx="${cx}" cy="${cy}" fill="none" style="stroke:${i.color};" stroke-width="${sw}"
        stroke-dasharray="${dash.toFixed(2)} ${(circ - dash).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"
        transform="rotate(-90 ${cx} ${cy})"><title>${esc(i.label)}: ${i.value}</title></circle>`;
      offset += dash;
      return seg;
    }).join('');

    const legend = items.map(i =>
      `<div class="chart-legend__item${i.value === 0 ? ' is-zero' : ''}">
        <span class="chart-legend__dot" style="background:${i.color};"></span>
        <span>${esc(i.label)}</span><b>${i.value}</b>
      </div>`
    ).join('');

    return `<div class="chart-donut">
      <svg viewBox="0 0 160 160" width="150" height="150" role="img" aria-label="${esc(opts.ariaLabel || 'Distribuição')}">
        ${segments}
        <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="26" font-weight="700" style="fill:var(--ds-text-primary);">${total}</text>
        <text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="10" style="fill:${COLORS.text};">${esc(opts.centerLabel || 'total')}</text>
      </svg>
      <div class="chart-legend">${legend}</div>
    </div>`;
  }

  window.dsCharts = { timeSeries, donut, fmtCost };
})();
