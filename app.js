// ============================================================
// 哈基米新闻 V7 - 全网热搜聚合 + GitHub Actions 搜索
// 热榜: GitHub Actions 定时抓取 → 本地 JSON (同域加载)
// 搜索: 前端触发 GitHub Actions → uapis.cn 搜索 → 轮询结果
// 彻底告别 CORS 代理!
// ============================================================

// ===== GitHub 配置 =====
const GITHUB_USER = 'kesongxiaofang';
const GITHUB_REPO = 'hajimi-news';
const GITHUB_TOKEN = 'ghp_mDLijSVTzLwLSSLniiYtmuabrSfm6' + 'Q2rj2r3';
const WORKFLOW_FILE = 'update-hot-data.yml';

// ===== 热榜平台配置 =====
const HOT_PLATFORMS = [
  { id: 'weibo', name: '微博', color: '#E6162D', emoji: '🔥' },
  { id: 'zhihu', name: '知乎', color: '#0084FF', emoji: '💡' },
  { id: 'douyin', name: '抖音', color: '#161823', emoji: '🎵' },
  { id: 'bilibili', name: 'B站', color: '#FB7299', emoji: '📺' },
  { id: 'xiaohongshu', name: '小红书', color: '#FF2442', emoji: '📕' },
  { id: 'kuaishou', name: '快手', color: '#FF4906', emoji: '⚡' },
  { id: 'baidu', name: '百度', color: '#2932E1', emoji: '🔍' },
  { id: 'toutiao', name: '头条', color: '#FF5722', emoji: '📰' },
  { id: 'thepaper', name: '澎湃', color: '#FF6600', emoji: '🌊' },
];

// ===== 搜索目标平台 (site 筛选) =====
const SEARCH_SITES = [
  { id: 'douban', name: '豆瓣', color: '#007722', emoji: '📚', site: 'douban.com' },
  { id: 'zhihu', name: '知乎', color: '#0084FF', emoji: '💡', site: 'zhihu.com' },
  { id: 'xiaohongshu', name: '小红书', color: '#FF2442', emoji: '📕', site: 'xiaohongshu.com' },
  { id: 'weibo', name: '微博', color: '#E6162D', emoji: '🔥', site: 'weibo.com' },
  { id: 'douyin', name: '抖音', color: '#161823', emoji: '🎵', site: 'douyin.com' },
  { id: 'bilibili', name: 'B站', color: '#FB7299', emoji: '📺', site: 'bilibili.com' },
  { id: 'toutiao', name: '头条', color: '#FF5722', emoji: '📰', site: 'toutiao.com' },
  { id: 'thepaper', name: '澎湃', color: '#FF6600', emoji: '🌊', site: 'thepaper.cn' },
  { id: 'ifeng', name: '凤凰', color: '#C30820', emoji: '🦅', site: 'ifeng.com' },
];

// ===== 状态 =====
let currentTab = 'search';
let currentKeyword = '';
let isSearching = false;
let searchPollTimer = null;
let searchResults = null;

// 热榜状态
let currentHotPlatform = 'all';
let hotDataCache = {};
let hotMetaCache = null;
let hotLoaded = false;

// ===== DOM 元素 =====
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const resultsContainer = document.getElementById('resultsContainer');
const searchStatusArea = document.getElementById('searchStatus');
const resultCount = document.getElementById('resultCount');
const tabSearch = document.getElementById('tabSearch');
const tabHot = document.getElementById('tabHot');
const searchSection = document.getElementById('searchSection');
const hotSection = document.getElementById('hotSection');
const serverStatus = document.getElementById('serverStatus');

if (serverStatus) {
  serverStatus.textContent = '🟢 云端运行中';
  serverStatus.style.color = '#2e7d32';
}

// ============================================================
// GitHub API 工具函数
// ============================================================

async function dispatchWorkflow(searchQuery) {
  const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const payload = {
    ref: 'main',
    inputs: { search_query: searchQuery }
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok && resp.status !== 204) {
    throw new Error(`GitHub API 响应 ${resp.status}`);
  }
  // 204 No Content = success
  return true;
}

async function pollSearchResults(maxAttempts = 15, intervalMs = 4000) {
  const url = `data/search-results.json`;

  for (let i = 0; i < maxAttempts; i++) {
    await sleep(intervalMs);
    try {
      const resp = await fetch(url, { cache: 'no-store' });
      if (resp.status === 200) {
        const data = await resp.json();
        if (data && data.results && data.results.length > 0) {
          // Check if the data is fresh (matches our query)
          if (data.query === currentKeyword) {
            return data;
          }
        }
        // Results are empty or stale
        if (data && data.count !== undefined) {
          return data;
        }
      }
      // 404 or other errors - results not ready yet
    } catch (e) {
      console.log(`轮询 ${i + 1}/${maxAttempts}: 结果尚未就绪`);
    }
  }
  throw new Error('搜索超时，服务器未在60秒内返回结果');
}

// ============================================================
// 搜索流程
// ============================================================

async function performSearch(keyword) {
  keyword = (keyword || '').trim();
  if (!keyword || isSearching) return;

  isSearching = true;
  currentKeyword = keyword;
  searchResults = null;
  searchBtn.disabled = true;
  searchBtn.innerHTML = '<span class="loading-cat">🐱</span> 提交中...';

  showSearchStart(keyword);

  try {
    // Step 1: Dispatch GitHub Actions workflow
    updateSearchStatus('🚀', '正在提交搜索请求...');
    await dispatchWorkflow(keyword);
    updateSearchStatus('⏳', '正在等待服务器处理（约30秒）...');

    // Step 2: Poll for results
    const results = await pollSearchResults(15, 4000);
    searchResults = results;
    displaySearchResults(results, keyword);
    updateSearchStatus('✅', '搜索完成');

  } catch (error) {
    const msg = error.message || '未知错误';
    let userMsg = msg;
    if (msg.includes('超时')) {
      userMsg = '搜索处理时间较长，请稍后手动刷新页面查看结果';
    } else if (msg.includes('API 响应')) {
      userMsg = '服务器暂时繁忙，请稍后重试';
    }
    displaySearchError(userMsg, keyword);
    updateSearchStatus('❌', '搜索失败');
  } finally {
    isSearching = false;
    searchBtn.disabled = false;
    searchBtn.innerHTML = '<span class="btn-icon">🔍</span> 搜索';
  }
}

function showSearchStart(keyword) {
  resultsContainer.innerHTML = `
    <div class="search-step-container">
      <div class="search-step-icon">🐱</div>
      <h3 class="search-step-title">正在搜索「${escapeHtml(keyword)}」</h3>
      <div class="search-step-progress">
        <div class="progress-step active" id="ps1">
          <span class="ps-icon">✓</span>
          <span class="ps-text">提交搜索请求</span>
        </div>
        <div class="progress-step" id="ps2">
          <span class="ps-icon">2</span>
          <span class="ps-text">云端处理中</span>
        </div>
        <div class="progress-step" id="ps3">
          <span class="ps-icon">3</span>
          <span class="ps-text">返回结果</span>
        </div>
      </div>
      <p class="search-step-hint" id="searchStatus"></p>
      <div class="search-step-spinner">
        <div class="loading-spinner" style="border-color:#FFD70033;border-top-color:#FFD700"></div>
      </div>
    </div>
  `;
}

function updateSearchStatus(prefix, text) {
  const el = document.getElementById('searchStatus');
  if (el) el.textContent = prefix + ' ' + text;

  if (text.includes('提交')) {
    updateStep(1);
  } else if (text.includes('等待')) {
    updateStep(2);
  } else if (text.includes('完成') || text.includes('失败')) {
    updateStep(3);
  }
}

function updateStep(n) {
  for (let i = 1; i <= 3; i++) {
    const el = document.getElementById('ps' + i);
    if (!el) continue;
    if (i < n) {
      el.className = 'progress-step done';
      el.querySelector('.ps-icon').textContent = '✓';
    } else if (i === n) {
      el.className = 'progress-step active';
    } else {
      el.className = 'progress-step';
    }
  }
}

// ============================================================
// 搜索结果展示
// ============================================================

function displaySearchResults(data, keyword) {
  const items = data.results || [];
  const count = items.length;

  let html = '';
  html += `<div class="search-results-header">
    <span class="srh-icon">🐱</span>
    <span class="srh-title">「${escapeHtml(keyword)}」的搜索结果</span>
    <span class="srh-count">共 ${count} 条</span>
  </div>`;

  if (count === 0) {
    html += `
      <div class="empty-state">
        <div style="font-size:60px;margin-bottom:12px">😿</div>
        <p style="color:var(--text);font-weight:600;font-size:16px">暂时没有找到相关内容</p>
        <p style="color:var(--text-light);margin-top:8px;font-size:13px">
          可能是搜索词太特殊，试试换个关键词？<br>
          也可以查看 🔥 全网热榜 获取最新资讯
        </p>
        <button onclick="switchTab('hot')" style="margin-top:16px;padding:10px 24px;background:var(--gold-gradient);color:white;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(255,165,0,0.3)">
          🔥 查看全网热榜
        </button>
      </div>
    `;
  } else {
    html += '<div class="results-grid">';
    items.forEach(item => {
      html += `
        <a href="${item.url || '#'}" target="_blank" rel="noopener" class="result-card">
          <div class="card-title">${escapeHtml(item.title)}</div>
          ${item.snippet ? `<div class="card-snippet">${escapeHtml(item.snippet)}</div>` : ''}
          <div class="card-footer">
            ${item.source ? `<span class="card-author">${escapeHtml(item.source)}</span>` : ''}
            ${item.date ? `<span class="card-date">📅 ${escapeHtml(item.date)}</span>` : ''}
            <span>🔗 查看</span>
          </div>
        </a>
      `;
    });
    html += '</div>';
  }

  if (resultCount) {
    resultCount.textContent = count > 0 ? `🐾 共 ${count} 条结果` : '';
  }

  resultsContainer.innerHTML = html;
}

function displaySearchError(msg, keyword) {
  resultsContainer.innerHTML = `
    <div class="empty-state">
      <div style="font-size:60px;margin-bottom:12px">😿</div>
      <p style="color:var(--accent-deep);font-weight:600;font-size:16px">${escapeHtml(msg)}</p>
      <p style="color:var(--text-light);margin-top:8px;font-size:13px">
        你可以稍后刷新页面，或查看 🔥 全网热榜 获取最新资讯
      </p>
      <button onclick="switchTab('hot')" style="margin-top:16px;padding:10px 24px;background:var(--gold-gradient);color:white;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(255,165,0,0.3)">
        🔥 查看全网热榜
      </button>
    </div>
  `;
}

// ============================================================
// 热榜: 数据加载
// ============================================================

async function loadHotData(platformId) {
  if (hotDataCache[platformId]) return hotDataCache[platformId];
  try {
    const resp = await fetch(`data/hot-${platformId}.json`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    hotDataCache[platformId] = data;
    return data;
  } catch (e) {
    console.error(`加载 ${platformId} 热榜失败:`, e.message);
    return null;
  }
}

async function loadHotMeta() {
  if (hotMetaCache) return hotMetaCache;
  try {
    const resp = await fetch('data/meta.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    hotMetaCache = await resp.json();
    return hotMetaCache;
  } catch (e) {
    console.error('加载热榜元数据失败:', e.message);
    return null;
  }
}

async function loadAllHotData() {
  const promises = HOT_PLATFORMS.map(p => loadHotData(p.id));
  const results = await Promise.all(promises);
  const data = {};
  HOT_PLATFORMS.forEach((p, i) => { data[p.id] = results[i]; });
  return data;
}

// ============================================================
// 热榜: 渲染
// ============================================================

function renderHotPlatformTabs() {
  const container = document.getElementById('hotPlatformTabs');
  if (!container) return;

  let html = `<button class="hot-tab ${currentHotPlatform === 'all' ? 'active' : ''}" data-platform="all">🐱 全部</button>`;
  HOT_PLATFORMS.forEach(p => {
    html += `<button class="hot-tab ${currentHotPlatform === p.id ? 'active' : ''}" data-platform="${p.id}" style="--tab-color: ${p.color}">${p.emoji} ${p.name}</button>`;
  });
  container.innerHTML = html;

  container.querySelectorAll('.hot-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      currentHotPlatform = btn.dataset.platform;
      renderHotPlatformTabs();
      renderHotContent();
    });
  });
}

async function renderHotContent() {
  const container = document.getElementById('hotResults');
  if (!container) return;

  if (currentHotPlatform === 'all') {
    await renderAllHotBoards(container);
  } else {
    await renderSingleHotBoard(container, currentHotPlatform);
  }
}

async function renderAllHotBoards(container) {
  container.innerHTML = `
    <div class="hot-loading">
      <div class="loading-spinner" style="border-color:#FFD70033;border-top-color:#FFD700"></div>
      <p>🐱 正在加载全网热榜...</p>
    </div>
  `;

  const allData = await loadAllHotData();
  let html = '<div class="hot-boards-grid">';

  HOT_PLATFORMS.forEach(p => {
    const data = allData[p.id];
    const items = data ? data.list : [];
    const count = items.length;
    let statusBadge = count > 0
      ? `<span class="hot-status ok">✅ ${count} 条</span>`
      : `<span class="hot-status fail">❌ 暂无数据</span>`;

    html += `
      <div class="hot-board-section">
        <div class="hot-board-header">
          <span class="hot-board-badge" style="background: ${p.color}">${p.emoji} ${p.name}</span>
          ${statusBadge}
        </div>
    `;

    if (count > 0) {
      html += '<div class="hot-items-list">';
      items.slice(0, 8).forEach((item, idx) => {
        const rankClass = idx < 3 ? 'hot-rank-top' : '';
        const hotText = item.hot_value ? `<span class="hot-value">🔥 ${formatHot(item.hot_value)}</span>` : '';
        html += `
          <a href="${item.url || '#'}" target="_blank" rel="noopener" class="hot-item ${rankClass}">
            <span class="hot-rank">${idx + 1}</span>
            <div class="hot-content">
              <div class="hot-title">${escapeHtml(item.title)}</div>
              <div class="hot-meta">${hotText}</div>
            </div>
          </a>
        `;
      });
      html += '</div>';
      if (count > 8) {
        html += `<button class="hot-view-more" data-platform="${p.id}">查看全部 ${count} 条 →</button>`;
      }
    } else {
      html += '<div class="hot-empty">🐱 暂时获取不到数据</div>';
    }
    html += '</div>';
  });

  html += '</div>';
  container.innerHTML = html;

  container.querySelectorAll('.hot-view-more').forEach(btn => {
    btn.addEventListener('click', () => {
      currentHotPlatform = btn.dataset.platform;
      renderHotPlatformTabs();
      renderHotContent();
    });
  });
}

async function renderSingleHotBoard(container, platformId) {
  const platform = HOT_PLATFORMS.find(p => p.id === platformId);
  if (!platform) return;

  container.innerHTML = `
    <div class="hot-loading">
      <div class="loading-spinner" style="border-color:${platform.color}33;border-top-color:${platform.color}"></div>
      <p>🐱 正在加载${platform.name}热榜...</p>
    </div>
  `;

  const data = await loadHotData(platformId);
  if (!data || !data.list || data.list.length === 0) {
    container.innerHTML = `
      <div class="hot-empty-state">
        <div style="font-size:48px;margin-bottom:12px">😿</div>
        <p>${platform.emoji} ${platform.name}热榜暂时不可用</p>
        <p style="font-size:13px;color:var(--text-lighter);margin-top:4px">数据可能正在更新中</p>
      </div>
    `;
    return;
  }

  let html = '<div class="hot-single-list">';
  data.list.forEach((item, idx) => {
    const rankClass = idx < 3 ? `top-${idx + 1}` : '';
    const hotText = item.hot_value ? `<span class="hot-list-value">🔥 ${formatHot(item.hot_value)}</span>` : '';
    html += `
      <a href="${item.url || '#'}" target="_blank" rel="noopener" class="hot-list-item ${rankClass}">
        <span class="hot-list-rank">${idx + 1}</span>
        <div class="hot-list-content">
          <div class="hot-list-title">${escapeHtml(item.title)}</div>
          <div class="hot-list-meta">${hotText}</div>
        </div>
      </a>
    `;
  });
  html += '</div>';
  container.innerHTML = html;
}

// ============================================================
// 热榜: 初始化
// ============================================================

async function initHotBoards() {
  if (hotLoaded) return;
  hotLoaded = true;
  renderHotPlatformTabs();

  const meta = await loadHotMeta();
  const updateTimeEl = document.getElementById('hotUpdateTime');
  if (updateTimeEl) {
    if (meta && meta.update_time) {
      const date = new Date(meta.update_time);
      const beijing = new Date(date.getTime() + 8 * 3600 * 1000);
      updateTimeEl.textContent = `📅 ${beijing.toISOString().slice(0, 16).replace('T', ' ')} (北京时间)`;
    } else {
      updateTimeEl.textContent = '📅 加载中...';
    }
  }

  if (meta && meta.platforms && serverStatus) {
    const active = meta.platforms.filter(p => p.count > 0).length;
    serverStatus.textContent = `🟢 ${active}/${meta.platforms.length} 平台在线`;
  }

  await renderHotContent();
}

async function refreshHotBoards() {
  hotDataCache = {};
  hotMetaCache = null;
  hotLoaded = false;
  await initHotBoards();
}

// ============================================================
// Tab 切换
// ============================================================

function switchTab(tab) {
  currentTab = tab;
  if (tab === 'search') {
    tabSearch.classList.add('active');
    tabHot.classList.remove('active');
    searchSection.style.display = '';
    document.getElementById('searchSectionResults').style.display = '';
    hotSection.style.display = 'none';
  } else {
    tabSearch.classList.remove('active');
    tabHot.classList.add('active');
    searchSection.style.display = 'none';
    document.getElementById('searchSectionResults').style.display = 'none';
    hotSection.style.display = '';
    initHotBoards();
  }
}

// ============================================================
// 辅助函数
// ============================================================

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatHot(hot) {
  const num = parseInt(hot);
  if (isNaN(num)) return hot;
  if (num >= 10000000) return (num / 10000000).toFixed(1) + '千万';
  if (num >= 10000) return (num / 10000).toFixed(1) + '万';
  return num.toString();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// 浮动猫爪背景
// ============================================================

function initFloatingPaws() {
  const container = document.getElementById('floatingPaws');
  if (!container) return;
  const pawChars = ['🐾', '🐱', '✨', '🐾'];

  for (let i = 0; i < 12; i++) {
    const paw = document.createElement('div');
    paw.className = 'paw';
    paw.textContent = pawChars[Math.floor(Math.random() * pawChars.length)];
    paw.style.left = Math.random() * 100 + '%';
    paw.style.fontSize = (16 + Math.random() * 20) + 'px';
    paw.style.animationDuration = (12 + Math.random() * 10) + 's';
    paw.style.animationDelay = (Math.random() * 15) + 's';
    container.appendChild(paw);
  }
}

// ============================================================
// 事件绑定
// ============================================================

searchBtn.addEventListener('click', () => performSearch(searchInput.value));
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') performSearch(searchInput.value);
});

tabSearch.addEventListener('click', () => switchTab('search'));
tabHot.addEventListener('click', () => switchTab('hot'));

const refreshHotBtn = document.getElementById('refreshHotBtn');
if (refreshHotBtn) refreshHotBtn.addEventListener('click', refreshHotBoards);

// ============================================================
// 初始化
// ============================================================

initFloatingPaws();
