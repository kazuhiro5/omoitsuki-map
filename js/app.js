import { watchUser, signIn, signOut } from './firebase.js';
import {
  isDemo, subscribe, startStore, stopStore,
  getNodes, getLinks, addNode, updateNode, removeNode, addLink, removeLink,
} from './store.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

let currentView = 'list'; // 'list' | 'graph'（リストをメインの初期表示にする）
let addType = '整理';
let filterType = 'all';
let filterStatus = 'all';
let filterHitOnly = false;
let expandedNodeId = null; // リストで行を1回押して「内容」を開いている行のid（task-board の openId と同じ）
let selectedNodeId = null; // 詳細ペインを開いているid

// 関係図用の状態
let cy = null;
let linkMode = false;
let linkSourceId = null;
let graphInitialized = false;

// 入力デバウンス用タイマー
let textTimer = null;
let memoTimer = null;
let hitTimer = null;
let inlineMemoTimer = null;

function typeColorVar(type) {
  if (type === '疑問') return 'var(--ask)';
  if (type === 'やること') return 'var(--person)';
  return 'var(--b5)';
}

function statusPrefix(status) {
  if (status === 'チェック済み') return '✓ ';
  if (status === '理解済み') return '● ';
  return '';
}

function nextStatus(status) {
  if (status === '未着手') return 'チェック済み';
  if (status === 'チェック済み') return '理解済み';
  return '未着手';
}

function formatTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleString('ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[s]));
}

function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { t.hidden = true; }, 2200);
}

// ---- 明るさ（テーマ） ----
function initTheme() {
  const saved = localStorage.getItem('om.theme') || '';
  updateThemeButtons(saved);
  $$('#theme-seg button').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.theme;
      try {
        if (id) localStorage.setItem('om.theme', id);
        else localStorage.removeItem('om.theme');
      } catch (e) {}
      if (id) document.documentElement.setAttribute('data-theme', id);
      else document.documentElement.removeAttribute('data-theme');
      updateThemeButtons(id);
      if (cy) cy.style(buildCyStyle());
    });
  });
}

function updateThemeButtons(id) {
  $$('#theme-seg button').forEach(btn => {
    btn.setAttribute('aria-pressed', btn.dataset.theme === id ? 'true' : 'false');
  });
}

// ---- 左の一覧の開閉 ----
function initSideToggle() {
  const page = $('#pageRoot');
  const rail = $('#sideRail');
  const side = $('#sidePane');
  const setOpen = open => {
    page.classList.toggle('side-closed', !open);
    rail.hidden = open;
    side.hidden = !open;
    try { localStorage.setItem('om.side', open ? 'open' : 'closed'); } catch (e) {}
    setTimeout(() => { if (cy && currentView === 'graph') cy.resize(); }, 50);
  };
  $('#closeSideBtn').addEventListener('click', () => setOpen(false));
  $('#openSideBtn').addEventListener('click', () => setOpen(true));
  try {
    if (localStorage.getItem('om.side') === 'closed') setOpen(false);
  } catch (e) {}
}

// ---- 画面切り替え（リスト ⇔ 関係図） ----
function switchView(view) {
  currentView = view;
  const isGraph = view === 'graph';

  $('#segListBtn').setAttribute('aria-pressed', !isGraph ? 'true' : 'false');
  $('#segGraphBtn').setAttribute('aria-pressed', isGraph ? 'true' : 'false');
  $$('[data-view-nav]').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.viewNav === view);
  });

  $('#listPane').hidden = isGraph;
  $('#graphPane').hidden = !isGraph;

  $('#searchInput').hidden = isGraph;
  $('#sortSelect').hidden = isGraph;
  $('#graphModeSeg').hidden = !isGraph;
  $('#fitGraphBtn').hidden = !isGraph;
  $('#layoutGraphBtn').hidden = !isGraph;
  $('#mainToolbar').classList.toggle('is-wide', isGraph);

  if (isGraph) {
    ensureGraph();
    setTimeout(() => {
      cy.resize();
      syncGraph();
      if (!graphInitialized && getNodes().length > 0) {
        graphInitialized = true;
        runLayout(false);
      }
    }, 30);
  } else {
    renderList();
  }
}

// ---- 絞り込み条件 ----
function matchesFilter(n) {
  if (filterType !== 'all' && n.type !== filterType) return false;
  if (filterStatus !== 'all' && n.status !== filterStatus) return false;
  if (filterHitOnly && (!n.hitMemo || !n.hitMemo.trim())) return false;
  return true;
}

function setTypeFilter(val) {
  filterType = val;
  $$('[data-ftype]').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.ftype === val);
  });
  $$('[data-mtype]').forEach(btn => {
    btn.setAttribute('aria-pressed', btn.dataset.mtype === val ? 'true' : 'false');
  });
  refreshViews();
}

function setStatusFilter(val) {
  filterStatus = val;
  $$('[data-fstatus]').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.fstatus === val);
  });
  refreshViews();
}

function toggleHitFilter() {
  filterHitOnly = !filterHitOnly;
  $('#sideHitBtn').classList.toggle('is-active', filterHitOnly);
  $('#mobileHitBtn').setAttribute('aria-pressed', filterHitOnly ? 'true' : 'false');
  refreshViews();
}

// ---- 件数バッジの更新 ----
function updateCounts() {
  const nodes = getNodes();
  $('#countAll').textContent = nodes.length;

  ['疑問', 'やること', '整理'].forEach(t => {
    const el = document.querySelector(`[data-count-type="${t}"]`);
    if (el) el.textContent = nodes.filter(n => n.type === t).length;
  });

  ['未着手', 'チェック済み', '理解済み'].forEach(s => {
    const el = document.querySelector(`[data-count-status="${s}"]`);
    if (el) el.textContent = nodes.filter(n => n.status === s).length;
  });

  $('#countHit').textContent = nodes.filter(n => n.hitMemo && n.hitMemo.trim()).length;
}

// ---- リスト画面の描画（task-board と同じく、行を1回押すとすぐ下に「内容」が開いて書き換えられる） ----
function renderList() {
  // 行の中の「内容」欄を入力している最中は、カーソルが外れないようにリスト全体の描き直しを飛ばす
  if (document.activeElement && document.activeElement.classList.contains('tb-memo-edit')) {
    return;
  }

  const container = $('#cardList');
  const nodes = getNodes();
  const links = getLinks();
  const q = ($('#searchInput').value || '').trim().toLowerCase();
  const sortBy = $('#sortSelect').value;

  let list = nodes.filter(n => {
    if (!matchesFilter(n)) return false;
    if (q) {
      const hay = `${n.text || ''} ${n.memo || ''} ${n.hitMemo || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const statusOrder = { '未着手': 1, 'チェック済み': 2, '理解済み': 3 };
  if (sortBy === 'created') {
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } else if (sortBy === 'status') {
    list.sort((a, b) => (statusOrder[a.status] || 9) - (statusOrder[b.status] || 9));
  } else if (sortBy === 'type') {
    list.sort((a, b) => (a.type || '').localeCompare(b.type || ''));
  } else {
    list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  container.innerHTML = '';
  if (list.length === 0) {
    container.innerHTML = '<div class="empty-box">思いつきがありません。上の入力欄からすぐに追加できます。</div>';
    return;
  }

  const byId = new Map(nodes.map(n => [n.id, n]));

  list.forEach(n => {
    const isExpanded = expandedNodeId === n.id;
    const card = document.createElement('div');
    card.className = 'tb-card'
      + (isExpanded ? ' is-expanded' : '')
      + (selectedNodeId === n.id ? ' is-selected' : '');
    card.dataset.status = n.status;
    card.dataset.id = n.id;

    // 左の丸ボタン（ワンタップで 未着手 → チェック済み → 理解済み）
    const checkBtn = document.createElement('button');
    checkBtn.type = 'button';
    checkBtn.className = 'tb-check';
    checkBtn.title = `状態を変える（今：${n.status}）`;
    const markChar = n.status === 'チェック済み' ? '✓' : (n.status === '理解済み' ? '●' : '');
    checkBtn.innerHTML = `<span class="tb-check-mark">${markChar}</span>`;
    checkBtn.addEventListener('click', async e => {
      e.stopPropagation();
      const next = nextStatus(n.status);
      await updateNode(n.id, { status: next });
      showToast(`状態を「${next}」に変えました`);
    });

    // 本体（1回押すとすぐ下に「内容」が伸びて開き、開いている行をもう一度押すと右の詳細ペインが開く）
    const bodyBtn = document.createElement('button');
    bodyBtn.type = 'button';
    bodyBtn.className = 'tb-body';
    bodyBtn.setAttribute('aria-expanded', String(isExpanded));
    bodyBtn.addEventListener('click', () => {
      if (expandedNodeId === n.id) {
        openDetail(n.id);
        return;
      }
      expandedNodeId = n.id;
      renderList();
      requestAnimationFrame(() => {
        const ta = container.querySelector(`.tb-card[data-id="${CSS.escape(n.id)}"] .tb-memo-edit`);
        if (ta) ta.focus();
      });
    });

    const connected = links
      .filter(l => l.source === n.id || l.target === n.id)
      .map(l => byId.get(l.source === n.id ? l.target : l.source))
      .filter(Boolean);

    const pillsHtml = connected.length
      ? `<div class="tb-links-row">${connected.map(c => `<span class="tb-link-pill">つながり：${escapeHtml(c.text)}</span>`).join('')}</div>`
      : '';

    const hitHtml = n.hitMemo && n.hitMemo.trim()
      ? `<div class="tb-hit">ヒット：${escapeHtml(n.hitMemo)}</div>`
      : '';

    const hasMemo = !!(n.memo && n.memo.trim());

    bodyBtn.innerHTML = `
      <div class="tb-line">
        <span class="tb-title">${escapeHtml(n.text)}</span>
        <span class="tb-chev" aria-hidden="true">▾</span>
      </div>
      ${hitHtml}
      ${pillsHtml}
      <div class="tb-meta">
        <span class="tb-type"><i class="dot" style="background:${typeColorVar(n.type)}"></i>${escapeHtml(n.type)}</span>
        <span class="tb-status-tag">${escapeHtml(n.status)}</span>
        ${hasMemo && !isExpanded ? '<span>内容あり</span>' : ''}
        <span>${formatTime(n.updatedAt)}</span>
      </div>
    `;

    card.appendChild(checkBtn);
    card.appendChild(bodyBtn);

    // 1回押した時にすぐ下に開く「内容」書き換え欄
    if (isExpanded) {
      const memoBox = document.createElement('div');
      memoBox.className = 'tb-memo-box';

      const memoTa = document.createElement('textarea');
      memoTa.className = 'tb-memo-edit';
      memoTa.rows = 3;
      memoTa.placeholder = '内容を書く（自動で保存されます）';
      memoTa.setAttribute('aria-label', '内容');
      memoTa.value = n.memo || '';
      memoTa.addEventListener('input', () => {
        const val = memoTa.value;
        clearTimeout(inlineMemoTimer);
        inlineMemoTimer = setTimeout(() => {
          updateNode(n.id, { memo: val });
        }, 300);
      });

      const foot = document.createElement('div');
      foot.className = 'tb-memo-foot';
      foot.innerHTML = '<span>内容は自動で保存されます（もう一度タイトルを押すと詳細・リンク編集）</span>';
      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'tb-memo-more';
      moreBtn.textContent = '詳細・つなぐ';
      moreBtn.addEventListener('click', () => openDetail(n.id));
      foot.appendChild(moreBtn);

      memoBox.appendChild(memoTa);
      memoBox.appendChild(foot);
      card.appendChild(memoBox);
    }

    container.appendChild(card);
  });
}

// ---- 関係図（Cytoscape.js） ----
function isDark() {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark') return true;
  if (attr === 'light') return false;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function makeGraphLabel(n) {
  const hit = n.hitMemo && n.hitMemo.trim() ? '[ヒット] ' : '';
  return `${hit}${statusPrefix(n.status)}[${n.type}]\n${n.text}`;
}

function buildCyStyle() {
  const dark = isDark();
  const textCol = dark ? '#E6EDF3' : '#1F2328';
  const surfaceCol = dark ? '#151B23' : '#FFFFFF';
  const mutedCol = dark ? '#9198A1' : '#59636E';
  const lineCol = dark ? '#3D444D' : '#D1D9E0';
  const checkedBg = dark ? '#0C2D4E' : '#DDF4FF';
  const checkedBorder = dark ? '#4493F8' : '#0969DA';
  const doneBg = dark ? '#12261A' : '#EBF6EE';
  const doneBorder = dark ? '#3FB950' : '#1A7F37';
  const warnCol = dark ? '#D29922' : '#9A6700';

  return [
    {
      selector: 'node',
      style: {
        'label': 'data(label)',
        'text-wrap': 'wrap',
        'text-max-width': '180px',
        'font-size': '12px',
        'line-height': 1.4,
        'color': textCol,
        'text-valign': 'center',
        'text-halign': 'center',
        'padding': '12px',
        'width': 'label',
        'height': 'label',
        'shape': 'round-rectangle',
        'background-color': surfaceCol,
        'border-width': 1.5,
        'border-color': mutedCol,
      }
    },
    { selector: 'node[type = "疑問"]', style: { 'shape': 'ellipse' } },
    { selector: 'node[type = "やること"]', style: { 'shape': 'round-rectangle' } },
    { selector: 'node[type = "整理"]', style: { 'shape': 'hexagon' } },
    {
      selector: 'node[status = "未着手"]',
      style: { 'background-color': surfaceCol, 'border-color': mutedCol, 'border-style': 'dashed', 'border-width': 1.5 }
    },
    {
      selector: 'node[status = "チェック済み"]',
      style: { 'background-color': checkedBg, 'border-color': checkedBorder, 'border-style': 'solid', 'border-width': 2.5 }
    },
    {
      selector: 'node[status = "理解済み"]',
      style: { 'background-color': doneBg, 'border-color': doneBorder, 'border-style': 'solid', 'border-width': 2.5 }
    },
    {
      selector: 'node[hasHit = "yes"]',
      style: { 'outline-width': 2, 'outline-color': warnCol, 'outline-offset': 2 }
    },
    {
      selector: 'node:selected',
      style: { 'outline-width': 3, 'outline-color': doneBorder, 'outline-offset': 3 }
    },
    {
      selector: 'node.link-source',
      style: { 'outline-width': 3, 'outline-color': warnCol, 'outline-offset': 4 }
    },
    {
      selector: 'edge',
      style: { 'width': 1.8, 'line-color': lineCol, 'curve-style': 'bezier' }
    }
  ];
}

function ensureGraph() {
  if (cy) return;
  cy = window.cytoscape({
    container: $('#cy'),
    elements: [],
    style: buildCyStyle(),
    layout: { name: 'grid' },
  });

  cy.on('tap', 'node', evt => {
    const id = evt.target.id();
    if (linkMode) {
      handleLinkModeTap(id);
      return;
    }
    openDetail(id);
  });

  cy.on('tap', evt => {
    if (evt.target === cy) closeDetail();
  });
}

function syncGraph() {
  if (!cy) return;
  const nodes = getNodes();
  const links = getLinks();
  const nodeIds = new Set(nodes.map(n => n.id));
  const edgeIds = new Set(links.map(l => l.id));

  cy.nodes().forEach(el => {
    if (!nodeIds.has(el.id())) cy.remove(el);
  });
  cy.edges().forEach(el => {
    if (!edgeIds.has(el.id())) cy.remove(el);
  });

  let addedNewNode = false;
  nodes.forEach(n => {
    const existing = cy.getElementById(n.id);
    const data = {
      id: n.id,
      label: makeGraphLabel(n),
      type: n.type,
      status: n.status,
      hasHit: n.hitMemo && n.hitMemo.trim() ? 'yes' : 'no',
    };
    if (existing && existing.length) {
      existing.data(data);
    } else {
      cy.add({
        group: 'nodes',
        data,
        position: {
          x: (cy.width() || 500) / 2 + (Math.random() * 140 - 70),
          y: (cy.height() || 400) / 2 + (Math.random() * 140 - 70),
        }
      });
      addedNewNode = true;
    }
  });

  links.forEach(l => {
    if (!nodeIds.has(l.source) || !nodeIds.has(l.target)) return;
    const existing = cy.getElementById(l.id);
    if (!existing || !existing.length) {
      cy.add({ group: 'edges', data: { id: l.id, source: l.source, target: l.target } });
    }
  });

  const visibleIds = new Set();
  nodes.forEach(n => {
    const ok = matchesFilter(n);
    const el = cy.getElementById(n.id);
    if (el && el.length) el.style('display', ok ? 'element' : 'none');
    if (ok) visibleIds.add(n.id);
  });
  cy.edges().forEach(edge => {
    const show = visibleIds.has(edge.data('source')) && visibleIds.has(edge.data('target'));
    edge.style('display', show ? 'element' : 'none');
  });

  if (selectedNodeId) {
    const el = cy.getElementById(selectedNodeId);
    if (el && el.length) el.select();
  }

  if (addedNewNode && !graphInitialized && currentView === 'graph') {
    graphInitialized = true;
    runLayout(false);
  }
}

function runLayout(animate = true) {
  if (!cy) return;
  cy.layout({
    name: 'cose',
    animate,
    animationDuration: 280,
    padding: 48,
    nodeRepulsion: 9000,
  }).run();
}

function setLinkMode(on) {
  linkMode = on;
  linkSourceId = null;
  if (cy) cy.nodes().removeClass('link-source');
  $('#modeSelectBtn').setAttribute('aria-pressed', !on ? 'true' : 'false');
  $('#modeLinkBtn').setAttribute('aria-pressed', on ? 'true' : 'false');
  $('#linkBanner').hidden = !on;
  if (on) {
    $('#linkBannerText').textContent = 'つなぎたい1つ目のノードを押してください';
  }
}

async function handleLinkModeTap(targetId) {
  if (!linkSourceId) {
    linkSourceId = targetId;
    cy.getElementById(targetId).addClass('link-source');
    $('#linkBannerText').textContent = '続けて、つなぐ先の2つ目のノードを押してください';
    return;
  }
  if (linkSourceId === targetId) {
    cy.getElementById(targetId).removeClass('link-source');
    linkSourceId = null;
    $('#linkBannerText').textContent = 'つなぎたい1つ目のノードを押してください';
    return;
  }
  const res = await addLink(linkSourceId, targetId);
  if (res) showToast('線をつなぎました');
  else showToast('すでにつながっています');
  setLinkMode(false);
  openDetail(targetId);
}

// ---- 詳細・編集ペイン ----
function openDetail(id) {
  const n = getNodes().find(x => x.id === id);
  if (!n) return;
  selectedNodeId = id;

  if (cy) {
    cy.nodes().unselect();
    const el = cy.getElementById(id);
    if (el && el.length) el.select();
  }

  $('#detailText').value = n.text || '';
  $('#detailMemo').value = n.memo || '';
  $('#detailHit').value = n.hitMemo || '';
  $('#detailUpdated').textContent = '更新：' + formatTime(n.updatedAt);

  $$('#detailStatusSeg button').forEach(btn => {
    btn.setAttribute('aria-pressed', btn.dataset.val === n.status ? 'true' : 'false');
  });
  $$('#detailTypeSeg button').forEach(btn => {
    btn.setAttribute('aria-pressed', btn.dataset.val === n.type ? 'true' : 'false');
  });

  renderDetailLinks(n.id);
  $('#detailPane').hidden = false;
  if (currentView === 'list') renderList();
}

function closeDetail() {
  selectedNodeId = null;
  if (cy) cy.nodes().unselect();
  $('#detailPane').hidden = true;
  if (currentView === 'list') renderList();
}

function renderDetailLinks(nodeId) {
  const listEl = $('#detailLinks');
  const selectEl = $('#detailLinkSelect');
  listEl.innerHTML = '';
  selectEl.innerHTML = '';

  const nodes = getNodes();
  const links = getLinks();
  const connectedEdges = links.filter(e => e.source === nodeId || e.target === nodeId);
  const connectedIds = new Set();

  if (connectedEdges.length === 0) {
    listEl.innerHTML = '<li style="color:var(--muted);border:0;">まだつながりがありません</li>';
  } else {
    connectedEdges.forEach(e => {
      const otherId = e.source === nodeId ? e.target : e.source;
      connectedIds.add(otherId);
      const other = nodes.find(x => x.id === otherId);
      if (!other) return;
      const li = document.createElement('li');
      const jumpBtn = document.createElement('button');
      jumpBtn.type = 'button';
      jumpBtn.className = 'pane-rel-link';
      jumpBtn.textContent = `[${other.type}] ${other.text}`;
      jumpBtn.addEventListener('click', () => openDetail(other.id));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'row-del';
      delBtn.textContent = '外す';
      delBtn.addEventListener('click', async () => {
        await removeLink(e.id);
        showToast('つながりを外しました');
      });

      li.appendChild(jumpBtn);
      li.appendChild(delBtn);
      listEl.appendChild(li);
    });
  }

  const candidates = nodes.filter(x => x.id !== nodeId && !connectedIds.has(x.id));
  if (candidates.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'つなげる候補がありません';
    selectEl.appendChild(opt);
  } else {
    candidates.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `[${c.type}] ${c.text}`;
      selectEl.appendChild(opt);
    });
  }
}

function refreshViews() {
  updateCounts();
  if (currentView === 'list') renderList();
  else syncGraph();

  if (selectedNodeId) {
    const n = getNodes().find(x => x.id === selectedNodeId);
    if (!n) {
      closeDetail();
    } else {
      if (document.activeElement !== $('#detailText')) {
        $('#detailText').value = n.text || '';
      }
      if (document.activeElement !== $('#detailMemo')) {
        $('#detailMemo').value = n.memo || '';
      }
      if (document.activeElement !== $('#detailHit')) {
        $('#detailHit').value = n.hitMemo || '';
      }
      $('#detailUpdated').textContent = '更新：' + formatTime(n.updatedAt);
      $$('#detailStatusSeg button').forEach(btn => {
        btn.setAttribute('aria-pressed', btn.dataset.val === n.status ? 'true' : 'false');
      });
      $$('#detailTypeSeg button').forEach(btn => {
        btn.setAttribute('aria-pressed', btn.dataset.val === n.type ? 'true' : 'false');
      });
      renderDetailLinks(n.id);
    }
  }
}

// ---- イベント結線 ----
function bindEvents() {
  // 画面切替
  $('#segListBtn').addEventListener('click', () => switchView('list'));
  $('#segGraphBtn').addEventListener('click', () => switchView('graph'));
  $$('[data-view-nav]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.viewNav));
  });

  // 上部の追加欄：押すと「内容」と「種類」が開く（task-board の .is-open と同じ）
  const addForm = $('#addForm');
  addForm.addEventListener('focusin', () => addForm.classList.add('is-open'));
  document.addEventListener('pointerdown', e => {
    if (!addForm.contains(e.target)) {
      if (!$('#addText').value.trim() && !$('#addMemo').value.trim()) {
        addForm.classList.remove('is-open');
      }
    }
    // リストで開いている行の外を押したら閉じる
    if (expandedNodeId && !e.target.closest?.('.tb-card.is-expanded, .detail-pane, .toast')) {
      expandedNodeId = null;
      renderList();
    }
  });

  // 追加フォームの種類選択
  $$('#addTypeChips .chip').forEach(btn => {
    btn.addEventListener('click', () => {
      addType = btn.dataset.atype;
      $$('#addTypeChips .chip').forEach(b => {
        b.setAttribute('aria-pressed', b.dataset.atype === addType ? 'true' : 'false');
      });
    });
  });

  // 思いつき追加
  addForm.addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('#addText');
    const memoInput = $('#addMemo');
    const text = input.value.trim();
    const memo = memoInput.value.trim();
    if (!text) return;
    input.value = '';
    memoInput.value = '';
    const created = await addNode({ text, memo, type: addType });
    showToast('思いつきを追加しました');
    if (created && currentView === 'graph') {
      openDetail(created.id);
    }
  });

  // 検索・並び替え
  $('#searchInput').addEventListener('input', () => renderList());
  $('#sortSelect').addEventListener('change', () => renderList());

  // 絞り込み（PC左欄＋スマホ帯）
  $$('[data-ftype]').forEach(btn => {
    btn.addEventListener('click', () => setTypeFilter(btn.dataset.ftype));
  });
  $$('[data-mtype]').forEach(btn => {
    btn.addEventListener('click', () => setTypeFilter(btn.dataset.mtype));
  });
  $$('[data-fstatus]').forEach(btn => {
    btn.addEventListener('click', () => setStatusFilter(btn.dataset.fstatus));
  });
  $('#sideHitBtn').addEventListener('click', toggleHitFilter);
  $('#mobileHitBtn').addEventListener('click', toggleHitFilter);

  // 関係図の操作ボタン
  $('#modeSelectBtn').addEventListener('click', () => setLinkMode(false));
  $('#modeLinkBtn').addEventListener('click', () => setLinkMode(true));
  $('#cancelLinkBtn').addEventListener('click', () => setLinkMode(false));
  $('#fitGraphBtn').addEventListener('click', () => { if (cy) cy.fit(undefined, 44); });
  $('#layoutGraphBtn').addEventListener('click', () => runLayout(true));

  // 詳細ペインの操作
  $('#closeDetailBtn').addEventListener('click', closeDetail);

  $$('#detailStatusSeg button').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!selectedNodeId) return;
      const val = btn.dataset.val;
      await updateNode(selectedNodeId, { status: val });
      showToast(`状態を「${val}」に変えました`);
    });
  });

  $$('#detailTypeSeg button').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!selectedNodeId) return;
      const val = btn.dataset.val;
      await updateNode(selectedNodeId, { type: val });
    });
  });

  $('#detailText').addEventListener('input', e => {
    const id = selectedNodeId;
    const val = e.target.value;
    if (!id) return;
    clearTimeout(textTimer);
    textTimer = setTimeout(() => {
      updateNode(id, { text: val });
    }, 350);
  });

  $('#detailMemo').addEventListener('input', e => {
    const id = selectedNodeId;
    const val = e.target.value;
    if (!id) return;
    clearTimeout(memoTimer);
    memoTimer = setTimeout(() => {
      updateNode(id, { memo: val });
    }, 350);
  });

  $('#detailHit').addEventListener('input', e => {
    const id = selectedNodeId;
    const val = e.target.value;
    if (!id) return;
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => {
      updateNode(id, { hitMemo: val });
    }, 350);
  });

  $('#addLinkBtn').addEventListener('click', async () => {
    const targetId = $('#detailLinkSelect').value;
    if (!selectedNodeId || !targetId) return;
    const res = await addLink(selectedNodeId, targetId);
    if (res) showToast('つながりを追加しました');
  });

  $('#deleteNodeBtn').addEventListener('click', async () => {
    if (!selectedNodeId) return;
    const id = selectedNodeId;
    closeDetail();
    await removeNode(id);
    showToast('削除しました');
  });

  // ログイン・ログアウト
  $('#signInBtn').addEventListener('click', async () => {
    $('#loginError').textContent = '';
    try {
      await signIn();
    } catch (e) {
      $('#loginError').textContent = 'ログインできませんでした：' + (e.message || e);
    }
  });

  $('#signOutBtn').addEventListener('click', async () => {
    stopStore();
    await signOut();
  });
}

// ---- 起動 ----
initTheme();
initSideToggle();
bindEvents();
subscribe(() => refreshViews());

if (isDemo) {
  $('#loading').hidden = true;
  $('#login').hidden = true;
  $('#appRoot').hidden = false;
  $('#userStatus').textContent = '見本モード（?demo=1）';
  $('#signOutBtn').hidden = true;
  startStore('demo');
} else {
  watchUser(user => {
    $('#loading').hidden = true;
    if (!user) {
      stopStore();
      $('#appRoot').hidden = true;
      $('#login').hidden = false;
      return;
    }
    $('#login').hidden = true;
    $('#appRoot').hidden = false;
    $('#userStatus').textContent = user.email || 'ログイン中';
    startStore(user.uid, err => {
      showToast('読み書きエラー：' + (err.message || err));
    });
  });
}
