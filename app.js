// ============================================================
// 哈基米新闻 V6 - 全网热搜聚合
// 热榜数据: GitHub Actions 定时抓取 → 本地 JSON (无CORS问题)
// 搜索引擎: 搜狗搜索 (site: 限定) + 多CORS代理容错
// 热榜平台: 微博/知乎/抖音/B站/小红书/快手/百度/头条/澎湃 (9个)
// ============================================================

// ===== 热榜平台配置 (数据来自GitHub Actions) =====
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

// ===== 搜索平台配置 =====
const SEARCH_PLATFORMS = [
  { id: 'douban', name: '豆瓣', color: '#007722', emoji: '📚', site: 'douban.com', searchUrl: 'https://www.douban.com/search?q=' },
  { id: 'zhihu', name: '知乎', color: '#0084FF', emoji: '💡', site: 'zhihu.com', searchUrl: 'https://www.zhihu.com/search?q=' },
  { id: 'xiaohongshu', name: '小红书', color: '#FF2442', emoji: '📕', site: 'xiaohongshu.com', searchUrl: 'https://www.xiaohongshu.com/search_result?keyword=' },
  { id: 'weibo', name: '微博', color: '#E6162D', emoji: '🔥', site: 'weibo.com', searchUrl: 'https://s.weibo.com/weibo?q=' },
  { id: 'douyin', name: '抖音', color: '#161823', emoji: '🎵', site: 'douyin.com', searchUrl: 'https://www.douyin.com/search/' },
  { id: 'bilibili', name: 'B站', color: '#FB7299', emoji: '📺', site: 'bilibili.com', searchUrl: 'https://search.bilibili.com/all?keyword=' },
  { id: 'toutiao', name: '头条', color: '#FF5722', emoji: '📰', site: 'toutiao.com', searchUrl: 'https://so.toutiao.com/search?keyword=' },
  { id: 'thepaper', name: '澎湃', color: '#FF6600', emoji: '🌊', site: 'thepaper.cn', searchUrl: 'https://www.thepaper.cn/searchResult?id=' },
  { id: 'ifeng', name: '凤凰', color: '#C30820', emoji: '🦅', site: 'ifeng.com', searchUrl: 'https://search.ifeng.com/?q=' },
];

// ===== CORS 代理 (多代理容错) =====
const CORS_PROXIES = [
  (url) => `https://cors.eu.org/${url}`,
  (url) => `https://proxy.cors.sh/${url}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy/?quest=${url}`,
];

// ===== 状态管理 =====
let currentKeyword = '';
let currentResults = {};
let activeSearchPlatform = 'all';
let autoRefreshTimer = null;
let isSearching = false;
let currentTab = 'search';
let currentHotPlatform = 'all';
let hotDataCache = {};
let hotMetaCache = null;
let hotLoaded = false;

// ===== DOM 元素 =====
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const platformFilters = document.getElementById('platformFilters');
const resultsContainer = document.getElementById('resultsContainer');
const autoRefreshToggle = document.getElementById('autoRefresh');
const resultCount = document.getElementById('resultCount');
const lastUpdate = document.getElementById('lastUpdate');
const serverStatus = document.getElementById('serverStatus');
const tabSearch = document.getElementById('tabSearch');
const tabHot = document.getElementById('tabHot');
const searchSection = document.getElementById('searchSection');
const hotSection = document.getElementById('hotSection');

// ===== 初始化状态显示 =====
if (serverStatus) {
  serverStatus.textContent = '🟢 云端运行中';
  serverStatus.style.color = '#2e7d32';
}

// ============================================================
// 热榜: 从本地 JSON 加载 (同域, 无CORS问题)
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
  HOT_PLATFORMS.forEach((p, i) => {
    data[p.id] = results[i];
  });
  return data;
}

// ============================================================
// 热榜: 渲染平台选择标签
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

// ============================================================
// 热榜: 渲染内容
// ============================================================
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

    let statusBadge = '';
    if (count > 0) {
      statusBadge = `<span class="hot-status ok">✅ ${count} 条</span>`;
    } else {
      statusBadge = `<span class="hot-status fail">❌ 暂无数据</span>`;
    }

    html += `
      <div class="hot-board-section">
        <div class="hot-board-header">
          <span class="hot-board-badge" style="background: ${p.color}">
            ${p.emoji} ${p.name}
          </span>
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
        <p style="font-size:13px;color:var(--text-lighter);margin-top:4px">数据可能正在更新中，请稍后再试</p>
      </div>
    `;
    return;
  }

  let html = `<div class="hot-single-list">`;
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

  // 加载元数据并显示更新时间
  const meta = await loadHotMeta();
  const updateTimeEl = document.getElementById('hotUpdateTime');
  if (updateTimeEl) {
    if (meta && meta.update_time) {
      const date = new Date(meta.update_time);
      const beijingTime = new Date(date.getTime() + 8 * 3600 * 1000);
      const timeStr = beijingTime.toISOString().slice(0, 16).replace('T', ' ');
      updateTimeEl.textContent = `📅 ${timeStr} (北京时间)`;
    } else {
      updateTimeEl.textContent = '📅 加载中...';
    }
  }

  // 统计平台数量
  if (meta && meta.platforms) {
    const activeCount = meta.platforms.filter(p => p.count > 0).length;
    const totalCount = meta.platforms.length;
    if (serverStatus) {
      serverStatus.textContent = `🟢 ${activeCount}/${totalCount} 平台在线`;
    }
  }

  await renderHotContent();
}

// ============================================================
// 热榜: 刷新
// ============================================================
async function refreshHotBoards() {
  hotDataCache = {};
  hotMetaCache = null;
  hotLoaded = false;
  await initHotBoards();
}

// ============================================================
// CORS 代理请求 (多代理容错)
// ============================================================
async function fetchViaProxy(targetUrl, timeoutMs = 15000) {
  for (let i = 0; i < CORS_PROXIES.length; i++) {
    const proxyUrl = CORS_PROXIES[i](targetUrl);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(proxyUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!resp.ok) {
        console.log(`代理 ${i} HTTP ${resp.status}`);
        continue;
      }

      const text = await resp.text();
      if (text && text.length > 100 && !text.includes('rate limited')) return text;
    } catch (e) {
      console.log(`代理 ${i} 失败:`, e.message);
    }
  }
  throw new Error('所有CORS代理均不可用');
}

// ============================================================
// 搜狗搜索结果解析
// ============================================================
function parseSogouResults(html, maxResults = 8) {
  const results = [];
  const blocks = html.split(/<div[^>]*class="[^"]*vrwrap[^"]*"/);

  for (let i = 1; i < blocks.length && results.length < maxResults; i++) {
    const block = blocks[i];
    if (block.includes('大家还在搜') || block.includes('hint-mid')) continue;

    let title = '';
    let link = '';
    let realUrl = '';

    const titleMatch = block.match(/<h3[^>]*class="[^"]*vr-title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (titleMatch) {
      link = titleMatch[1];
      title = cleanText(titleMatch[2]);
    }

    if (!title) {
      const altTitleMatch = block.match(/<a[^>]*name="dttl"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (altTitleMatch) {
        link = altTitleMatch[1];
        title = cleanText(altTitleMatch[2]);
      }
    }

    if (!title) continue;

    const dataUrlMatch = block.match(/data-url="([^"]+)"/);
    if (dataUrlMatch) realUrl = dataUrlMatch[1];

    if (!realUrl) {
      const citeUrlMatch = block.match(/citeLinkClass[^>]*>[\s\S]*?<span[^>]*>(https?:\/\/[^<]+)<\/span>/);
      if (citeUrlMatch) realUrl = citeUrlMatch[1].replace(/\.\.\./g, '');
    }

    if (!realUrl) {
      if (link.startsWith('/link?')) realUrl = 'https://www.sogou.com' + link;
      else if (link.startsWith('http')) realUrl = link;
    }

    let snippet = '';
    const snippetMatch = block.match(/<div[^>]*class="[^"]*fz-mid[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (snippetMatch) snippet = cleanText(snippetMatch[1]);

    let source = '';
    let date = '';
    const citeMatch = block.match(/citeLinkClass[^>]*>([\s\S]*?)<\/a>/);
    if (citeMatch) {
      const spans = citeMatch[1].match(/<span[^>]*>([^<]+)<\/span>/g);
      if (spans) {
        spans.forEach((span, idx) => {
          const text = cleanText(span);
          if (idx === 0) source = text;
          else if (/\d{4}-\d{2}-\d{2}/.test(text)) date = text;
        });
      }
    }

    results.push({
      title: truncate(title, 100),
      snippet: truncate(snippet, 300),
      url: realUrl || link,
      author: source || '',
      date: date || '',
    });
  }
  return results;
}

// ============================================================
// 单平台搜索
// ============================================================
async function searchPlatform(platform, keyword) {
  // 策略1: 搜狗 site: 搜索
  try {
    const sogouUrl = `https://www.sogou.com/web?query=${encodeURIComponent(keyword + ' site:' + platform.site)}&num=10`;
    const html = await fetchViaProxy(sogouUrl, 20000);

    if (html.includes('安全验证') || html.includes('antispider') || html.length < 500) {
      console.log(`${platform.name} 搜狗搜索被反爬`);
    } else {
      const results = parseSogouResults(html, 8);
      if (results.length > 0) return { results, status: 'success' };
    }
  } catch (e) {
    console.log(`${platform.name} 搜狗site搜索失败:`, e.message);
  }

  // 策略2: 搜狗不限站点搜索，然后过滤
  try {
    const sogouUrl2 = `https://www.sogou.com/web?query=${encodeURIComponent(keyword + ' ' + platform.name)}&num=10`;
    const html2 = await fetchViaProxy(sogouUrl2, 20000);
    const results2 = parseSogouResults(html2, 8).filter(r =>
      r.url.includes(platform.site) || r.author.includes(platform.name)
    );
    if (results2.length > 0) return { results: results2, status: 'success' };
  } catch (e) {
    console.log(`${platform.name} 搜狗兜底搜索失败:`, e.message);
  }

  return { results: [], status: 'empty' };
}

// ============================================================
// 渐进式渲染搜索结果
// ============================================================
function renderPlatformResult(platform, results, status) {
  currentResults[platform.id] = {
    platformId: platform.id,
    platformName: platform.name,
    color: platform.color,
    emoji: platform.emoji,
    searchUrl: platform.searchUrl + encodeURIComponent(currentKeyword),
    status: status,
    results: results,
  };

  if (activeSearchPlatform === 'all' || activeSearchPlatform === platform.id) {
    renderResults();
  }
  updateResultCount();
  updateChipCounts();
}

function updateChipCounts() {
  SEARCH_PLATFORMS.forEach(p => {
    const data = currentResults[p.id];
    const countEl = document.querySelector(`[data-count="${p.id}"]`);
    if (countEl && data) {
      const count = data.results.length;
      countEl.textContent = count;
      countEl.style.display = count > 0 ? 'inline-block' : 'none';
    }
  });
}

// ============================================================
// 执行搜索
// ============================================================
async function performSearch(keyword) {
  keyword = (keyword || '').trim();
  if (!keyword || isSearching) return;

  isSearching = true;
  currentKeyword = keyword;
  currentResults = {};
  searchBtn.disabled = true;
  searchBtn.innerHTML = '<span class="loading-cat">🐱</span> 搜索中...';

  showLoadingState();

  const searchStartTime = Date.now();
  let allFailed = true;

  try {
    const batchSize = 3;
    for (let i = 0; i < SEARCH_PLATFORMS.length; i += batchSize) {
      const batch = SEARCH_PLATFORMS.slice(i, i + batchSize);
      const promises = batch.map(async (platform) => {
        try {
          const { results, status } = await searchPlatform(platform, keyword);
          if (status === 'success') allFailed = false;
          renderPlatformResult(platform, results, status);
        } catch (e) {
          renderPlatformResult(platform, [], 'empty');
        }
      });
      await Promise.allSettled(promises);
    }

    updateLastUpdate();

    const elapsed = ((Date.now() - searchStartTime) / 1000).toFixed(1);
    console.log(`搜索完成，耗时 ${elapsed}s`);

    // 如果所有平台都失败了，显示提示
    if (allFailed) {
      resultsContainer.innerHTML = `
        <div class="empty-state">
          <div style="font-size:60px;margin-bottom:12px">😿</div>
          <p style="color:var(--accent-deep);font-weight:600;font-size:16px">搜索服务暂时不可用</p>
          <p style="color:var(--text-light);margin-top:8px;font-size:13px">
            所有CORS代理均不可用，请稍后重试<br>
            💡 你也可以查看 <strong>全网热榜</strong> 获取最新资讯
          </p>
          <button onclick="switchTab('hot')" style="margin-top:16px;padding:10px 24px;background:var(--gold-gradient);color:white;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(255,165,0,0.3)">
            🔥 查看全网热榜
          </button>
        </div>
      `;
    }

    updateResultCount();
  } catch (error) {
    showError('搜索出错：' + error.message);
  } finally {
    isSearching = false;
    searchBtn.disabled = false;
    searchBtn.innerHTML = '<span class="btn-icon">🔍</span> 搜索';
  }
}

// ============================================================
// 加载状态
// ============================================================
function showLoadingState() {
  const html = `
    <div class="loading-grid">
      ${SEARCH_PLATFORMS.map(p => `
        <div class="loading-card" id="loading-${p.id}">
          <div class="loading-spinner" style="border-color: ${p.color}33;border-top-color: ${p.color}"></div>
          <div>
            <div class="loading-text" style="font-weight:600;color:${p.color}">${p.emoji} ${p.name}</div>
            <div class="loading-text">🐱 搜索中...</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  resultsContainer.innerHTML = html;
}

// ============================================================
// 渲染搜索结果
// ============================================================
function renderResults() {
  const orderedIds = activeSearchPlatform === 'all'
    ? SEARCH_PLATFORMS.map(p => p.id)
    : [activeSearchPlatform];

  if (Object.keys(currentResults).length === 0) return;

  let html = '';
  let total = 0;

  orderedIds.forEach(platformId => {
    const platformData = currentResults[platformId];
    if (!platformData) return;

    const count = platformData.results.length;
    total += count;

    const platformInfo = SEARCH_PLATFORMS.find(p => p.id === platformId);
    const emoji = platformInfo ? platformInfo.emoji : '🐾';

    let statusClass = 'status-empty';
    let statusText = '🐱 无结果';
    if (platformData.status === 'success') {
      statusClass = 'status-success';
      statusText = `✅ ${count} 条结果`;
    }

    html += `
      <div class="platform-section">
        <div class="platform-section-header">
          <span class="platform-badge" style="background: ${platformData.color}">
            ${emoji} ${platformData.platformName}
          </span>
          <span class="platform-count ${statusClass}">${statusText}</span>
          <a href="${platformData.searchUrl}" target="_blank" rel="noopener" class="platform-direct-link">
            直接搜索 →
          </a>
        </div>
    `;

    if (count > 0) {
      html += '<div class="results-grid">';
      platformData.results.forEach(item => {
        const dateHtml = item.date ? `<span class="card-date">📅 ${escapeHtml(item.date)}</span>` : '';
        const sourceHtml = item.author ? `<span class="card-author">${escapeHtml(item.author)}</span>` : '';

        html += `
          <a href="${item.url}" target="_blank" rel="noopener" class="result-card">
            <div class="card-title">${escapeHtml(item.title)}</div>
            ${item.snippet ? `<div class="card-snippet">${escapeHtml(item.snippet)}</div>` : '<div class="card-snippet"></div>'}
            <div class="card-footer">
              ${sourceHtml}
              ${dateHtml}
              <span>🔗 查看</span>
            </div>
          </a>
        `;
      });
      html += '</div>';
    } else {
      html += `
        <div class="no-result-box">
          🐱 暂未搜到相关内容，<a href="${platformData.searchUrl}" target="_blank" rel="noopener">前往${platformData.platformName}直接搜索 →</a>
        </div>
      `;
    }

    html += '</div>';
  });

  resultsContainer.innerHTML = html;
}

// ============================================================
// 错误状态
// ============================================================
function showError(msg) {
  resultsContainer.innerHTML = `
    <div class="empty-state">
      <div style="font-size:60px;margin-bottom:12px">😿</div>
      <p style="color:var(--error);font-weight:600">${escapeHtml(msg)}</p>
      <p style="color:var(--text-light);margin-top:8px;font-size:13px">
        💡 提示：网络可能不稳定，请稍后重试<br>
      </p>
    </div>
  `;
}

// ============================================================
// 辅助函数
// ============================================================
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text, maxLen = 200) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + '...';
}

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

function updateLastUpdate() {
  const now = new Date();
  if (lastUpdate) {
    lastUpdate.textContent = `更新于 ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
  }
}

function updateResultCount() {
  let total = 0;
  Object.values(currentResults).forEach(p => { total += p.results.length; });
  if (resultCount) {
    resultCount.textContent = total > 0 ? `🐾 共 ${total} 条结果` : '';
  }
}

// ============================================================
// Tab 切换
// ============================================================
function switchTab(tab) {
  currentTab = tab;
  if (tab === 'search') {
    if (tabSearch) tabSearch.classList.add('active');
    if (tabHot) tabHot.classList.remove('active');
    if (searchSection) searchSection.style.display = '';
    if (hotSection) hotSection.style.display = 'none';
  } else {
    if (tabSearch) tabSearch.classList.remove('active');
    if (tabHot) tabHot.classList.add('active');
    if (searchSection) searchSection.style.display = 'none';
    if (hotSection) hotSection.style.display = '';
    initHotBoards();
  }
}

// ============================================================
// 自动刷新
// ============================================================
function toggleAutoRefresh() {
  if (autoRefreshToggle.checked) {
    if (!currentKeyword) {
      autoRefreshToggle.checked = false;
      return;
    }
    autoRefreshTimer = setInterval(() => {
      if (currentKeyword && !isSearching) {
        performSearch(currentKeyword);
      }
    }, 60000);
  } else {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  }
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
// 初始化搜索平台筛选
// ============================================================
function initPlatformFilters() {
  SEARCH_PLATFORMS.forEach(p => {
    const chip = document.createElement('button');
    chip.className = 'platform-chip';
    chip.dataset.platform = p.id;
    chip.innerHTML = `
      <span class="chip-dot" style="background: ${p.color}"></span>
      ${p.emoji} ${p.name}
      <span class="chip-count" data-count="${p.id}" style="display:none">0</span>
    `;
    platformFilters.appendChild(chip);
  });

  platformFilters.addEventListener('click', (e) => {
    const chip = e.target.closest('.platform-chip');
    if (!chip) return;

    document.querySelectorAll('.platform-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    activeSearchPlatform = chip.dataset.platform;

    if (Object.keys(currentResults).length > 0) {
      renderResults();
    }
  });
}

// ============================================================
// 事件绑定
// ============================================================
searchBtn.addEventListener('click', () => {
  performSearch(searchInput.value);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    performSearch(searchInput.value);
  }
});

autoRefreshToggle.addEventListener('change', toggleAutoRefresh);

if (tabSearch) {
  tabSearch.addEventListener('click', () => switchTab('search'));
}
if (tabHot) {
  tabHot.addEventListener('click', () => switchTab('hot'));
}

const refreshHotBtn = document.getElementById('refreshHotBtn');
if (refreshHotBtn) {
  refreshHotBtn.addEventListener('click', refreshHotBoards);
}

// ============================================================
// 初始化
// ============================================================
initFloatingPaws();
initPlatformFilters();
