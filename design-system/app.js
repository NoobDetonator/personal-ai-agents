/* ============================================================================
   APP.JS — SHOWROOM INTERACTIVITY
   Navigation, theme toggle, component demos, toast system, motion replays.
   ============================================================================ */

document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  if (window.dsAI) dsAI.createIcons();
  if (window.dsAgent) {
    dsAgent.createIcons();
    renderAgentRolesGrid();
  }
  
  if (window.dsAI_Renderer) {
    dsAI_Renderer.renderShowroomGrid('aiModelsGrid');
  }

  initNavigation();
  initThemeToggle();
  initReducedMotion();
  renderColorRamps();
  renderSpacingScale();
  renderRadiusScale();
});

/* ---------- Navigation (SPA-style section switching) ---------- */
function initNavigation() {
  const nav = document.getElementById('nav');
  const items = nav.querySelectorAll('.ds-sidebar__item');

  items.forEach(item => {
    item.addEventListener('click', () => {
      const section = item.dataset.section;

      // Update active nav item
      items.forEach(i => i.classList.remove('is-active'));
      item.classList.add('is-active');

      // Show target section, hide others
      document.querySelectorAll('.showroom-section').forEach(s => s.classList.add('ds-hidden'));
      const target = document.getElementById(`section-${section}`);
      if (target) {
        target.classList.remove('ds-hidden');
        // Re-render icons in newly visible section
        lucide.createIcons({ nameAttr: 'data-lucide' });
        if (window.dsAI) dsAI.createIcons();
        if (window.dsAgent) dsAgent.createIcons();
        // Scroll main to top
        document.getElementById('main').scrollTop = 0;
      }
    });
  });
}

/* ---------- Theme Toggle ---------- */
function initThemeToggle() {
  const toggle = document.getElementById('themeToggle');
  toggle.addEventListener('change', () => {
    document.documentElement.setAttribute('data-theme', toggle.checked ? 'light' : 'dark');
  });
}

/* ---------- Reduced Motion Toggle ---------- */
function initReducedMotion() {
  const toggle = document.getElementById('reducedMotionToggle');
  toggle.addEventListener('change', () => {
    document.documentElement.setAttribute('data-reduced-motion', toggle.checked ? 'true' : 'false');
  });
}

/* ---------- Color Ramps Generator ---------- */
function renderColorRamps() {
  const container = document.getElementById('colorRamps');
  if (!container) return;

  const ramps = [
    { name: 'Gray',    prefix: '--p-gray',    steps: [50,100,200,300,400,500,600,700,800,900,950] },
    { name: 'Indigo',  prefix: '--p-indigo',  steps: [50,100,200,300,400,500,600,700,800,900,950] },
    { name: 'Blue',    prefix: '--p-blue',    steps: [50,100,200,300,400,500,600,700,800,900,950] },
    { name: 'Emerald', prefix: '--p-emerald', steps: [50,100,200,300,400,500,600,700,800,900,950] },
    { name: 'Amber',   prefix: '--p-amber',   steps: [50,100,200,300,400,500,600,700,800,900,950] },
    { name: 'Red',     prefix: '--p-red',     steps: [50,100,200,300,400,500,600,700,800,900,950] },
    { name: 'Cyan',    prefix: '--p-cyan',    steps: [50,100,200,300,400,500,600,700,800,900,950] },
    { name: 'Violet',  prefix: '--p-violet',  steps: [50,100,200,300,400,500,600,700,800,900,950] },
  ];

  container.innerHTML = ramps.map(ramp => `
    <div class="showroom-color-ramp">
      <span class="showroom-color-ramp__title">${ramp.name}</span>
      <div class="showroom-color-ramp__row">
        ${ramp.steps.map(step => {
          const varName = `${ramp.prefix}-${step}`;
          const textColor = step >= 500 ? '#ffffff' : '#000000';
          return `<div class="showroom-color-swatch" style="background:var(${varName});color:${textColor};" title="${varName}">${step}</div>`;
        }).join('')}
      </div>
    </div>
  `).join('');
}

/* ---------- Agent Roles Grid Generator ---------- */
function renderAgentRolesGrid() {
  const container = document.getElementById('agentRolesGrid');
  if (!container || !window.AgentVectors) return;
  
  const roles = Object.keys(AgentVectors);
  container.innerHTML = roles.map(role => `
    <div class="ds-card ds-card--interactive" style="text-align:center; padding: 24px 16px;">
      <i data-agent-icon="${role}" style="width:32px;height:32px;color:var(--ds-text-primary);margin-bottom:12px;"></i>
      <div class="ds-body-sm" style="font-weight:600; text-transform:capitalize;">${role}</div>
      <div class="ds-caption ds-text-muted" style="margin-top:4px;">&lt;i data-agent-icon="${role}"&gt;</div>
    </div>
  `).join('');
}

/* ---------- Spacing Scale Generator ---------- */
function renderSpacingScale() {
  const container = document.getElementById('spacingScale');
  if (!container) return;

  const spaces = [
    { name: '--p-space-px',  val: '1px' },
    { name: '--p-space-0-5', val: '2px' },
    { name: '--p-space-1',   val: '4px' },
    { name: '--p-space-1-5', val: '6px' },
    { name: '--p-space-2',   val: '8px' },
    { name: '--p-space-2-5', val: '10px' },
    { name: '--p-space-3',   val: '12px' },
    { name: '--p-space-4',   val: '16px' },
    { name: '--p-space-5',   val: '20px' },
    { name: '--p-space-6',   val: '24px' },
    { name: '--p-space-8',   val: '32px' },
    { name: '--p-space-10',  val: '40px' },
    { name: '--p-space-12',  val: '48px' },
    { name: '--p-space-16',  val: '64px' },
    { name: '--p-space-20',  val: '80px' },
    { name: '--p-space-24',  val: '96px' },
  ];

  const maxW = 500;
  const maxPx = 96;

  container.innerHTML = '<div style="padding:20px;">' + spaces.map(s => {
    const px = parseInt(s.val);
    const w = Math.max(4, (px / maxPx) * maxW);
    return `
      <div class="showroom-space-item">
        <span class="showroom-space-label">${s.name}</span>
        <div class="showroom-space-bar" style="width:${w}px;"></div>
        <span class="showroom-space-value">${s.val}</span>
      </div>
    `;
  }).join('') + '</div>';
}

/* ---------- Radius Scale Generator ---------- */
function renderRadiusScale() {
  const container = document.getElementById('radiusScale');
  if (!container) return;

  const radii = [
    { name: 'xs',   val: 'var(--p-radius-xs)' },
    { name: 'sm',   val: 'var(--p-radius-sm)' },
    { name: 'md',   val: 'var(--p-radius-md)' },
    { name: 'lg',   val: 'var(--p-radius-lg)' },
    { name: 'xl',   val: 'var(--p-radius-xl)' },
    { name: '2xl',  val: 'var(--p-radius-2xl)' },
    { name: 'full', val: 'var(--p-radius-full)' },
  ];

  container.innerHTML = radii.map(r =>
    `<div class="showroom-radius-demo" style="border-radius:${r.val};">
      <span style="font-weight:600;">${r.name}</span>
    </div>`
  ).join('');
}

/* ---------- Accordion ---------- */
function toggleAccordion(trigger) {
  const item = trigger.closest('.ds-accordion__item');
  const wasOpen = item.classList.contains('is-open');

  // Close all items in same accordion
  const accordion = item.closest('.ds-accordion');
  accordion.querySelectorAll('.ds-accordion__item').forEach(i => {
    i.classList.remove('is-open');
    const panel = i.querySelector('.ds-accordion__panel');
    if (panel) panel.style.maxHeight = '0';
  });

  // Toggle clicked
  if (!wasOpen) {
    item.classList.add('is-open');
    const panel = item.querySelector('.ds-accordion__panel');
    if (panel) panel.style.maxHeight = panel.scrollHeight + 'px';
  }

  lucide.createIcons({ nameAttr: 'data-lucide' });
}

/* ---------- Tabs ---------- */
function switchTab(tabBtn, panelId) {
  const tabList = tabBtn.closest('.ds-tabs__list');
  const tabs = tabList.querySelectorAll('.ds-tabs__tab');
  const container = tabBtn.closest('.ds-tabs');
  const panels = container.querySelectorAll('.ds-tabs__panel');

  tabs.forEach(t => t.classList.remove('is-active'));
  tabBtn.classList.add('is-active');

  panels.forEach(p => p.hidden = true);
  const target = document.getElementById(panelId);
  if (target) target.hidden = false;
}

/* ---------- Modal ---------- */
function openModal() {
  const overlay = document.getElementById('modalOverlay');
  overlay.classList.add('is-open');
  document.body.style.overflow = 'hidden';
  lucide.createIcons({ nameAttr: 'data-lucide' });
}

function closeModal(event) {
  if (event && event.target !== event.currentTarget) return;
  const overlay = document.getElementById('modalOverlay');
  overlay.classList.remove('is-open');
  document.body.style.overflow = '';
}

// Close modal on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal();
    closeDrawer();
  }
});

/* ---------- Drawer ---------- */
function openDrawer() {
  document.getElementById('drawerOverlay').classList.add('is-open');
  document.getElementById('drawer').classList.add('is-open');
  document.body.style.overflow = 'hidden';
  lucide.createIcons({ nameAttr: 'data-lucide' });
}

function closeDrawer() {
  document.getElementById('drawerOverlay').classList.remove('is-open');
  document.getElementById('drawer').classList.remove('is-open');
  document.body.style.overflow = '';
}

/* ---------- Toast System ---------- */
let toastCounter = 0;

const toastData = {
  info: {
    icon: 'info',
    title: 'Informação',
    message: 'O agente Aria iniciou uma nova análise do projeto.',
    variant: 'ds-toast--info',
  },
  success: {
    icon: 'check-circle',
    title: 'Sucesso!',
    message: 'Tarefa completada com êxito em 1.8 segundos.',
    variant: 'ds-toast--success',
  },
  warning: {
    icon: 'alert-triangle',
    title: 'Atenção',
    message: 'Rate limit atingindo 90%. Considere reduzir requisições.',
    variant: 'ds-toast--warning',
  },
  danger: {
    icon: 'alert-octagon',
    title: 'Erro',
    message: 'Falha na comunicação com o agente. Reconectando...',
    variant: 'ds-toast--danger',
  },
};

function showToast(type = 'info') {
  const container = document.getElementById('toastContainer');
  const data = toastData[type] || toastData.info;
  const id = `toast-${++toastCounter}`;

  const toast = document.createElement('div');
  toast.className = `ds-toast ${data.variant}`;
  toast.id = id;
  toast.setAttribute('role', 'alert');
  toast.innerHTML = `
    <div class="ds-toast__icon"><i data-lucide="${data.icon}"></i></div>
    <div class="ds-toast__body">
      <div class="ds-toast__title">${data.title}</div>
      <div class="ds-toast__message">${data.message}</div>
    </div>
    <button class="ds-toast__dismiss" onclick="dismissToast('${id}')" aria-label="Fechar">
      <i data-lucide="x" style="width:16px;height:16px;"></i>
    </button>
    <div class="ds-toast__timer"></div>
  `;

  container.appendChild(toast);
  lucide.createIcons({ nameAttr: 'data-lucide' });

  // Auto-dismiss after 4s
  setTimeout(() => dismissToast(id), 4000);
}

function dismissToast(id) {
  const toast = document.getElementById(id);
  if (!toast) return;
  toast.classList.add('ds-toast--exiting');
  setTimeout(() => toast.remove(), 200);
}

/* ---------- Motion Replay ---------- */
function replayAnim(btn) {
  const card = btn.closest('.showroom-motion-card');
  const animClass = card.dataset.anim;
  card.classList.remove(animClass);
  // Force reflow
  void card.offsetWidth;
  card.classList.add(animClass);
}

function replayStagger() {
  const container = document.getElementById('staggerDemo');
  const children = container.children;
  container.classList.remove('ds-stagger');
  for (const child of children) {
    child.style.opacity = '0';
  }
  void container.offsetWidth;
  container.classList.add('ds-stagger');
  for (const child of children) {
    child.style.opacity = '';
  }
}
