// ============================================================
// 哈基米新闻 V7.2 - 全网热搜聚合 + GitHub Actions 搜索
// 热榜: GitHub Actions 定时抓取 → 本地 JSON (同域加载)
// 搜索: 前端触发 GitHub Actions → uapis.cn 搜索 → 轮询结果
// 新增: 来源分类筛选 + 连续搜索 session 管理
// ============================================================

// ===== GitHub 配置 =====
const GITHUB_USER = 'kesongxiaofang';
const GITHUB_REPO = 'hajimi-news';
const GITHUB_TOKEN = 'ghp_mDLijSVTzLwLSSLniiYtmuabrSfm6' + 'Q2rj2r3';
const WORKFLOW_FILE = 'update-hot-data.yml';

// ===== 来源域名 → 友好名称映射 =====
const SOURCE_NAME_MAP = {
  'sina.com.cn':      { name: '新浪',      color: '#E6162D', emoji: '📰' },
  'weibo.com':        { name: '微博',      color: '#E6162D', emoji: '🔥' },
  'zhihu.com':        { name: '知乎',      color: '#0084FF', emoji: '💡' },
  'douyin.com':       { name: '抖音',      color: '#161823', emoji: '🎵' },
  'bilibili.com':     { name: 'B站',       color: '#FB7299', emoji: '📺' },
  'xiaohongshu.com':  { name: '小红书',    color: '#FF2442', emoji: '📕' },
  'kuaishou.com':     { name: '快手',      color: '#FF4906', emoji: '⚡' },
  'baidu.com':        { name: '百度',      color: '#2932E1', emoji: '🔍' },
  'toutiao.com':      { name: '头条',      color: '#FF5722', emoji: '🗞️' },
  'thepaper.cn':      { name: '澎湃',      color: '#FF6600', emoji: '🌊' },
  'ifeng.com':        { name: '凤凰',      color: '#C30820', emoji: '🦅' },
  '163.com':          { name: '网易',      color: '#D32F2F', emoji: '📬' },
  'qq.com':           { name: '腾讯',      color: '#12B7F5', emoji: '🐧' },
  'sohu.com':         { name: '搜狐',      color: '#FDD000', emoji: '🦊' },
  'guancha.cn':       { name: '观察者网',  color: '#B71C1C', emoji: '👁️' },
  'huanqiu.com':      { name: '环球网',    color: '#0D47A1', emoji: '🌍' },
  'people.com.cn':    { name: '人民网',    color: '#C62828', emoji: '🏛️' },
  'cctv.com':         { name: '央视网',    color: '#1565C0', emoji: '📺' },
  'chinanews.com':    { name: '中国新闻网',color: '#2E7D32', emoji: '📢' },
  'xinhuanet.com':    { name: '新华网',    color: '#C62828', emoji: '📡' },
  'guancha.sina.com.cn': { name: '新浪观察', color: '#E6162D', emoji: '📰' },
  'news.qq.com':      { name: '腾讯新闻',  color: '#12B7F5', emoji: '🐧' },
  'news.163.com':     { name: '网易新闻',  color: '#D32F2F', emoji: '📬' },
  'tech.sina.com.cn': { name: '新浪科技',  color: '#E6162D', emoji: '💻' },
  'finance.sina.com.cn': { name: '新浪财经', color: '#E6162D', emoji: '💰' },
  '36kr.com':         { name: '36氪',      color: '#2196F3', emoji: '🚀' },
  'ithome.com':       { name: 'IT之家',    color: '#F44336', emoji: '💻' },
  'cnbeta.com':       { name: 'cnBeta',   color: '#FF9800', emoji: '📟' },
  'jiemian.com':      { name: '界面新闻',  color: '#00BCD4', emoji: '📋' },
  'thepaper.cn':      { name: '澎湃',      color: '#FF6600', emoji: '🌊' },
  'caixin.com':       { name: '财新',      color: '#FFC107', emoji: '💼' },
  'yicai.com':        { name: '第一财经',  color: '#FF5722', emoji: '📊' },
  'cls.cn':           { name: '财联社',    color: '#FF6F00', emoji: '📈' },
  'wallstreetcn.com': { name: '华尔街见闻',color: '#37474F', emoji: '🏦' },
  'ce.cn':            { name: '中国经济网',color: '#C62828', emoji: '🏭' },
};

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

// ===== 状态 =====
let currentTab = 'search';
let isSearching = false;
let searchSessionId = 0;        // 每次搜索递增，防止旧 session 干扰
let currentKeyword = '';
let allSearchResults = null;    // 缓存所有结果（用于筛选）
let activeSourceFilters = [];   // 当前选中的来源筛选

// 热榜状态
let currentHotPlatform = 'all';
let hotDataCache = {};
let hotMetaCache = null;
let hotLoaded = false;

// ===== DOM 元素 =====
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const resultsContainer = document.getElementById('resultsContainer');
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
// 来源域名解析
// ============================================================

function extractDomain(source) {
  if (!source) return 'unknown';
  // 去掉协议
  let domain = source.replace(/^https?:\/\//, '').replace(/^www\./, '');
  // 取主域名部分 (去掉路径)
  domain = domain.split('/')[0].split('#')[0].split('?')[0];
  return domain;
}

function getSourceInfo(source) {
  const domain = extractDomain(source);
  // 精确匹配
  if (SOURCE_NAME_MAP[domain]) return SOURCE_NAME_MAP[domain];
  // 模糊匹配: 检查是否包含已知域名
  for (const [key, info] of Object.entries(SOURCE_NAME_MAP)) {
    if (domain.includes(key) || key.includes(domain)) {
      return info;
    }
  }
  // 未知来源，提取简短域名
  const short = domain.split('.')[0] || domain;
  return {
    name: short.length > 10 ? short.slice(0,10) + '...' : short,
    color: '#888',
    emoji: '🌐'
  };
}

function groupResultsBySource(items) {
  const groups = {};
  items.forEach(item => {
    const source = item.source || '';
    const domain = extractDomain(source);
    if (!groups[domain]) {
      groups[domain] = { domain, items: [] };
    }
    groups[domain].items.push(item);
  });
  // 按结果数量降序排列
  return Object.values(groups).sort((a, b) => b.items.length - a.items.length);
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
  return true;
}

async function pollSearchResults(sessionId, maxAttempts = 25, intervalMs = 4000) {
  const url = `data/search-results.json`;

  for (let i = 0; i < maxAttempts; i++) {
    await sleep(intervalMs);

    // 检查当前 session 是否已过期（用户搜了新词）
    if (sessionId !== searchSessionId) {
      console.log(`Session ${sessionId} 已过期 (当前=${searchSessionId})，停止轮询`);
      throw new Error('SESSION_EXPIRED');
    }

    try {
      const resp = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
      if (resp.status === 200) {
        const data = await resp.json();
        // 再次检查 session
        if (sessionId !== searchSessionId) {
          throw new Error('SESSION_EXPIRED');
        }
        // 只有当 query 完全匹配当前搜索词时，才接受结果
        if (data && data.query === currentKeyword) {
          return data;
        }
        console.log(`轮询 ${i + 1}/${maxAttempts}: 收到旧结果(query="${data.query || 'unknown'}"), 等待新结果...`);
      }
    } catch (e) {
      if (e.message === 'SESSION_EXPIRED') throw e;
      console.log(`轮询 ${i + 1}/${maxAttempts}: 结果尚未就绪`);
    }
  }

  // 超时前做最后一次检查: 文件是否已更新但 query 不匹配
  // 可能 workfow 写入了新的查询结果
  try {
    const resp = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
    if (resp.status === 200) {
      const data = await resp.json();
      if (data && data.query === currentKeyword) return data;
    }
  } catch (e) { /* ignore */ }

  throw new Error('搜索超时');
}

// ============================================================
// 搜索流程
// ============================================================

async function performSearch(keyword) {
  keyword = (keyword || '').trim();
  if (!keyword) return;

  // 如果正在搜索中，取消旧的 session
  if (isSearching) {
    const oldId = searchSessionId;
    searchSessionId++;  // 旧的 session 会自动过期
    console.log(`取消旧搜索 session ${oldId}, 新 session ${searchSessionId}`);
  } else {
    searchSessionId++;
  }

  const mySessionId = searchSessionId;
  isSearching = true;
  currentKeyword = keyword;
  allSearchResults = null;
  activeSourceFilters = [];
  searchBtn.disabled = true;
  searchBtn.innerHTML = '<span class="loading-cat">🐱</span> 提交中...';

  showSearchStart(keyword);

  try {
    // Step 1: Dispatch GitHub Actions workflow
    updateSearchStatus('🚀', '正在提交搜索请求...');
    await dispatchWorkflow(keyword);

    if (mySessionId !== searchSessionId) return; // 被取消了

    updateSearchStatus('⏳', '正在等待服务器处理（约30-60秒）...');

    // Step 2: Poll for results (最多100秒)
    const results = await pollSearchResults(mySessionId, 25, 4000);

    if (mySessionId !== searchSessionId) return; // 被取消了

    allSearchResults = results;
    activeSourceFilters = [];
    displaySearchResults(results, keyword);
    updateSearchStatus('✅', '搜索完成');

  } catch (error) {
    if (mySessionId !== searchSessionId) {
      console.log(`Session ${mySessionId} 被新搜索取消`);
      return; // 被取消，不显示错误
    }

    const msg = error.message || '未知错误';
    let userMsg = msg;
    if (msg.includes('超时')) {
      userMsg = '搜索处理时间较长（超过100秒），请稍后刷新页面或重新搜索';
    } else if (msg.includes('API 响应')) {
      userMsg = '服务器暂时繁忙，请稍后重试';
    }
    displaySearchError(userMsg, keyword);
    updateSearchStatus('❌', '搜索失败');
  } finally {
    // 只清理当前 session
    if (mySessionId === searchSessionId) {
      isSearching = false;
      searchBtn.disabled = false;
      searchBtn.innerHTML = '<span class="btn-icon">🔍</span> 搜索';
    }
  }
}

function showSearchStart(keyword) {
  resultsContainer.innerHTML = `
    <div class="search-step-container">
      <div class="search-step-icon">🐱</div>
      <h3 class="search-step-title">正在搜索「${escapeHtml(keyword)}」</h3>
      <div class="search-step-progress">
        <div class="progress-step active" id="ps1">
          <span class="ps-icon">1</span>
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
      <p class="search-step-hint" id="searchStatus">🐱 小猫正在努力搜索中...</p>
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
// 搜索结果展示 (含来源分类+筛选)
// ============================================================

function displaySearchResults(data, keyword) {
  const items = data.results || [];
  const count = items.length;
  allSearchResults = data;

  // 按来源分组
  const groups = groupResultsBySource(items);

  let html = '';

  // 结果头部
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
    // 来源筛选栏
    html += renderSourceFilters(groups);
    // 结果区域容器
    html += '<div id="searchResultsContent"></div>';
  }

  if (resultCount) {
    resultCount.textContent = count > 0 ? `🐾 共 ${count} 条结果` : '';
  }

  resultsContainer.innerHTML = html;

  // 渲染筛选后的结果
  if (count > 0) {
    renderFilteredResults();
  }
}

function renderSourceFilters(groups) {
  const totalCount = groups.reduce((sum, g) => sum + g.items.length, 0);
  let html = '<div class="source-filter-bar">';
  html += `<span class="sf-label">📂 来源筛选:</span>`;

  // "全部" 按钮
  const isAllActive = activeSourceFilters.length === 0;
  html += `<button class="sf-chip ${isAllActive ? 'active' : ''}" onclick="toggleSourceFilter('__ALL__')">
    🐱 全部 <span class="sf-chip-count">${totalCount}</span>
  </button>`;

  groups.forEach(g => {
    const info = getSourceInfo(g.domain);
    const isActive = activeSourceFilters.includes(g.domain);
    const filteredCount = activeSourceFilters.length === 0 ? 0 
      : (isActive ? g.items.length : 0);
    html += `<button class="sf-chip ${isActive ? 'active' : ''}" 
      onclick="toggleSourceFilter('${escapeAttr(g.domain)}')"
      style="--sf-color:${info.color}">
      ${info.emoji} ${info.name}
      <span class="sf-chip-count">${g.items.length}</span>
    </button>`;
  });

  if (activeSourceFilters.length > 0) {
    const filteredTotal = groups
      .filter(g => activeSourceFilters.includes(g.domain))
      .reduce((sum, g) => sum + g.items.length, 0);
    html += `<button class="sf-clear-btn" onclick="clearSourceFilters()">✕ 清除筛选</button>`;
  }

  html += '</div>';
  return html;
}

function renderFilteredResults() {
  if (!allSearchResults) return;

  const items = allSearchResults.results || [];
  let filtered = items;

  // 应用来源筛选
  if (activeSourceFilters.length > 0) {
    filtered = items.filter(item => {
      const domain = extractDomain(item.source || '');
      return activeSourceFilters.includes(domain);
    });
  }

  const groups = groupResultsBySource(filtered);
  const el = document.getElementById('searchResultsContent');
  if (!el) return;

  let html = '';

  // 按来源分组展示
  groups.forEach(g => {
    const info = getSourceInfo(g.domain);
    html += `<div class="source-group">
      <div class="source-group-header">
        <span class="source-badge" style="background:${info.color}">${info.emoji} ${info.name}</span>
        <span class="source-group-count">${g.items.length} 条</span>
      </div>
      <div class="results-grid">`;

    g.items.forEach(item => {
      html += `
        <a href="${item.url || '#'}" target="_blank" rel="noopener" class="result-card">
          <div class="card-title">${escapeHtml(item.title)}</div>
          ${item.snippet ? `<div class="card-snippet">${escapeHtml(item.snippet)}</div>` : ''}
          <div class="card-footer">
            ${item.source ? `<span class="card-author"><span class="ca-dot" style="background:${info.color}"></span>${escapeHtml(info.name)}</span>` : ''}
            ${item.date ? `<span class="card-date">📅 ${escapeHtml(item.date)}</span>` : ''}
            <span>🔗 查看</span>
          </div>
        </a>
      `;
    });

    html += '</div></div>';
  });

  if (filtered.length === 0) {
    html = `
      <div class="empty-state">
        <div style="font-size:48px;margin-bottom:8px">😿</div>
        <p style="color:var(--text-light);font-weight:600">所选来源没有结果</p>
        <p style="font-size:13px;color:var(--text-lighter);margin-top:4px">试试取消筛选查看所有来源</p>
      </div>
    `;
  }

  el.innerHTML = html;

  // 更新筛选栏
  const groupsAll = groupResultsBySource(allSearchResults.results);
  const sfBar = document.querySelector('.source-filter-bar');
  if (sfBar) {
    sfBar.outerHTML = renderSourceFilters(groupsAll);
  }

  // 更新总计数
  if (resultCount) {
    const total = filtered.length;
    const suffix = activeSourceFilters.length > 0 ? ` (已筛选)` : '';
    resultCount.textContent = `🐾 共 ${total} 条结果${suffix}`;
  }
}

// ===== 来源筛选交互 =====

function toggleSourceFilter(domain) {
  if (domain === '__ALL__') {
    activeSourceFilters = [];
  } else {
    const idx = activeSourceFilters.indexOf(domain);
    if (idx >= 0) {
      activeSourceFilters.splice(idx, 1);
    } else {
      activeSourceFilters.push(domain);
    }
  }
  renderFilteredResults();
  // 滚动到筛选栏
  const sfBar = document.querySelector('.source-filter-bar');
  if (sfBar) sfBar.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clearSourceFilters() {
  activeSourceFilters = [];
  renderFilteredResults();
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

function escapeAttr(text) {
  return text.replace(/['"&<>]/g, function(c) {
    return '&#' + c.charCodeAt(0) + ';';
  });
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
