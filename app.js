// ============================================================
// 哈基米新闻 V8 - 9平台来源 + 时间筛选 + 按日期排序
// 热榜: GitHub Actions 定时抓取 → 本地 JSON (同域加载)
// 搜索: 前端触发 GitHub Actions → uapis.cn 搜索 → 轮询结果
// ============================================================

// ===== GitHub 配置 =====
const GITHUB_USER = 'kesongxiaofang';
const GITHUB_REPO = 'hajimi-news';
const GITHUB_TOKEN = 'ghp_mDLijSVTzLwLSSLniiYtmuabrSfm6' + 'Q2rj2r3';
const WORKFLOW_FILE = 'update-hot-data.yml';

// ===== 9大平台来源映射 =====
const ALLOWED_SOURCES = {
  'douban.com':      { name: '豆瓣',    color: '#00B51D', emoji: '📚' },
  'zhihu.com':       { name: '知乎',    color: '#0084FF', emoji: '💡' },
  'xiaohongshu.com': { name: '小红书',  color: '#FF2442', emoji: '📕' },
  'weibo.com':       { name: '微博',    color: '#E6162D', emoji: '🔥' },
  'douyin.com':      { name: '抖音',    color: '#161823', emoji: '🎵' },
  'bilibili.com':    { name: 'B站',     color: '#FB7299', emoji: '📺' },
  'toutiao.com':     { name: '头条',    color: '#FF5722', emoji: '🗞️' },
  'thepaper.cn':     { name: '澎湃',    color: '#FF6600', emoji: '🌊' },
  'ifeng.com':       { name: '凤凰',    color: '#C30820', emoji: '🦅' },
};

const OTHER_SOURCE = { name: '其他来源', color: '#888', emoji: '🌐' };

// ===== 时间段选项 =====
const TIME_PERIODS = [
  { label: '24小时内', value: 'd',  ms: 24 * 60 * 60 * 1000 },
  { label: '3天内',    value: 'w',  ms: 3 * 24 * 60 * 60 * 1000 },
  { label: '7天内',    value: 'w',  ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30天内',   value: 'm',  ms: 30 * 24 * 60 * 60 * 1000 },
  { label: '全部时间', value: '',   ms: 0 },
];

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

// ===== 全局状态 =====
let currentTab = 'search';
let isSearching = false;
let searchSessionId = 0;
let currentKeyword = '';
let allSearchResults = null;
let activeSourceFilters = [];
let selectedTimePeriod = TIME_PERIODS[TIME_PERIODS.length - 1]; // 默认"全部时间"

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
// 日期解析：将各种格式的 publish_time 转为 Unix 时间戳(ms)
// ============================================================

function parsePublishTime(dateStr) {
  if (!dateStr) return 0;

  const s = String(dateStr).trim();

  // 1. 纯数字时间戳（秒或毫秒）
  if (/^\d+$/.test(s)) {
    const num = parseInt(s);
    if (num > 1e12) return num;          // 毫秒
    if (num > 1e9)  return num * 1000;   // 秒
    return 0;
  }

  // 2. ISO 8601 / 标准日期格式
  let ts = Date.parse(s);
  if (!isNaN(ts)) return ts;

  // 3. 中文相对时间: "3小时前", "1天前", "2周前", "1个月前"
  const relMatch = s.match(/(\d+)\s*(小时|天|周|月|分钟|年|秒)前/);
  if (relMatch) {
    const num = parseInt(relMatch[1]);
    const unit = relMatch[2];
    const now = Date.now();
    const multipliers = {
      '秒': 1000, '分钟': 60000, '小时': 3600000,
      '天': 86400000, '周': 604800000, '月': 2592000000, '年': 31536000000
    };
    return now - num * (multipliers[unit] || 0);
  }

  // 4. "今天 HH:MM", "昨天 HH:MM"
  if (s.startsWith('今天') || s.startsWith('今天 ')) {
    const timeMatch = s.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      const d = new Date();
      d.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0, 0);
      return d.getTime();
    }
  }
  if (s.startsWith('昨天') || s.startsWith('昨天 ')) {
    const timeMatch = s.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      d.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0, 0);
      return d.getTime();
    }
  }

  // 5. 中文日期: "2026年7月5日"
  const cnMatch = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (cnMatch) {
    return new Date(parseInt(cnMatch[1]), parseInt(cnMatch[2]) - 1, parseInt(cnMatch[3])).getTime();
  }

  // 6. 带时间的日期: "2026-07-05 08:30" (non-standard separators)
  const dtMatch = s.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (dtMatch) {
    return new Date(parseInt(dtMatch[1]), parseInt(dtMatch[2]) - 1, parseInt(dtMatch[3]),
                    parseInt(dtMatch[4]), parseInt(dtMatch[5])).getTime();
  }

  // 7. 日期: "2026-07-05"
  const dMatch = s.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (dMatch) {
    return new Date(parseInt(dMatch[1]), parseInt(dMatch[2]) - 1, parseInt(dMatch[3])).getTime();
  }

  // 8. "1天前", "3小时前" (no space)
  const relMatch2 = s.match(/^(\d+)(小时|天|周|月|分钟|年|秒)前$/);
  if (relMatch2) {
    const num = parseInt(relMatch2[1]);
    const unit = relMatch2[2];
    const now = Date.now();
    const multipliers = {
      '秒': 1000, '分钟': 60000, '小时': 3600000,
      '天': 86400000, '周': 604800000, '月': 2592000000, '年': 31536000000
    };
    return now - num * (multipliers[unit] || 0);
  }

  return 0; // 无法解析
}

function formatRelativeDate(ts) {
  if (!ts) return '';
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  if (diff < 604800000) return Math.floor(diff / 86400000) + '天前';
  if (diff < 2592000000) return Math.floor(diff / 604800000) + '周前';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ============================================================
// 来源解析（只保留9大平台 + 其他）
// ============================================================

function extractDomain(source) {
  if (!source) return 'unknown';
  let domain = source.replace(/^https?:\/\//, '').replace(/^www\./, '');
  domain = domain.split('/')[0].split('#')[0].split('?')[0];
  return domain;
}

function getSourceInfo(source) {
  const domain = extractDomain(source);
  // 精确匹配
  if (ALLOWED_SOURCES[domain]) return ALLOWED_SOURCES[domain];
  // 子域名匹配: news.qq.com → 检查 qq.com 不在列表中，不匹配
  // 检查后缀匹配
  for (const [key, info] of Object.entries(ALLOWED_SOURCES)) {
    if (domain.endsWith('.' + key)) return info;
  }
  // 其他来源
  return OTHER_SOURCE;
}

function getSourceKey(source) {
  const domain = extractDomain(source);
  if (ALLOWED_SOURCES[domain]) return domain;
  for (const key of Object.keys(ALLOWED_SOURCES)) {
    if (domain.endsWith('.' + key)) return key;
  }
  return '__other__';
}

function groupResultsBySource(items) {
  const groups = {};
  items.forEach(item => {
    const key = getSourceKey(item.source || '');
    if (!groups[key]) groups[key] = { key, items: [] };
    groups[key].items.push(item);
  });
  // 9个平台优先，其他来源放最后
  const ordered = [];
  Object.keys(ALLOWED_SOURCES).forEach(k => {
    if (groups[k]) ordered.push(groups[k]);
  });
  if (groups['__other__']) ordered.push(groups['__other__']);
  return ordered;
}

// ============================================================
// GitHub API 工具
// ============================================================

async function dispatchWorkflow(searchQuery) {
  const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const payload = {
    ref: 'main',
    inputs: { search_query: searchQuery }
  };

  console.log('[Search] Dispatching workflow for:', searchQuery);

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
  } catch (networkError) {
    // Catches CORS errors and network errors (TypeError: Failed to fetch)
    console.error('[Search] Network/CORS error:', networkError);
    throw new Error(`网络错误: ${networkError.message}`);
  }

  console.log('[Search] Dispatch response status:', resp.status);

  if (!resp.ok && resp.status !== 204) {
    let text = '';
    try { text = await resp.text(); } catch(e) {}
    console.error('[Search] Dispatch failed:', resp.status, text.slice(0, 300));
    throw new Error(`GitHub API ${resp.status}: ${text.slice(0, 200)}`);
  }
  return true;
}

async function pollSearchResults(sessionId, maxAttempts, intervalMs) {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(intervalMs);

    if (sessionId !== searchSessionId) {
      console.log(`Session ${sessionId} expired, stopping poll`);
      throw new Error('SESSION_EXPIRED');
    }

    try {
      // Use random cache-buster to avoid CDN caching
      const cacheBuster = Date.now() + '_' + Math.random();
      const resp = await fetch(`data/search-results.json?_v=${cacheBuster}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });
      
      if (resp.status === 200) {
        const data = await resp.json();
        if (sessionId !== searchSessionId) throw new Error('SESSION_EXPIRED');
        
        console.log(`[Poll ${i+1}/${maxAttempts}] Got response: query="${data.query}", count=${data.count}, update_time=${data.update_time}`);
        
        if (data && data.query === currentKeyword) {
          console.log(`[Search] Success! Found ${data.count} results for "${currentKeyword}"`);
          return data;
        }
        console.log(`Poll ${i+1}/${maxAttempts}: old result (query="${data.query||'unknown'}"), waiting...`);
      } else {
        console.log(`Poll ${i+1}/${maxAttempts}: HTTP ${resp.status}`);
      }
    } catch (e) {
      if (e.message === 'SESSION_EXPIRED') throw e;
      console.log(`Poll ${i+1}/${maxAttempts}: not ready (${e.message})`);
    }
  }

    // Last attempt - try one more time with forced cache bypass
    try {
      const cacheBuster = Date.now() + '_' + Math.random();
      const resp = await fetch(`data/search-results.json?_v=${cacheBuster}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (resp.status === 200) {
        const data = await resp.json();
        if (data && data.query === currentKeyword) {
          console.log(`[Search] Last attempt success: ${data.count} results`);
          return data;
        }
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

  // 取消旧 session
  if (isSearching) {
    const oldId = searchSessionId;
    searchSessionId++;
    console.log(`Cancelled old session ${oldId}, new session ${searchSessionId}`);
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
    updateSearchStatus('🚀', '正在提交搜索请求...');
    await dispatchWorkflow(keyword);

    if (mySessionId !== searchSessionId) return;

    updateSearchStatus('⏳', '正在等待服务器处理（约30-60秒）...');

    const results = await pollSearchResults(mySessionId, 25, 4000);

    if (mySessionId !== searchSessionId) return;

    allSearchResults = results;
    activeSourceFilters = [];
    displaySearchResults(results, keyword);
    updateSearchStatus('✅', '搜索完成');

  } catch (error) {
    if (mySessionId !== searchSessionId) return;

    const msg = error.message || '未知错误';
    let userMsg = msg;
    if (msg.includes('超时')) {
      userMsg = '搜索处理时间较长（超过100秒），请稍后刷新页面或重新搜索';
    } else if (msg.includes('网络错误') || msg.includes('Failed to fetch')) {
      userMsg = '无法连接GitHub API（可能是浏览器CORS限制），请尝试刷新页面后重试';
    } else if (msg.includes('API')) {
      userMsg = 'GitHub API 返回错误：' + msg;
    }
    displaySearchError(userMsg, keyword, msg);
    updateSearchStatus('❌', '搜索失败');
  } finally {
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

  if (text.includes('提交')) updateStep(1);
  else if (text.includes('等待')) updateStep(2);
  else if (text.includes('完成') || text.includes('失败')) updateStep(3);
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
// 搜索结果展示（来源筛选 + 时间筛选 + 日期排序）
// ============================================================

function displaySearchResults(data, keyword) {
  const rawItems = data.results || [];
  allSearchResults = data;

  // 为每个结果解析时间戳
  rawItems.forEach(item => {
    item._ts = parsePublishTime(item.date);
  });

  const sortedItems = sortItemsByDate(rawItems);
  const count = sortedItems.length;

  // 按来源分组（用于统计）
  const groups = groupResultsBySource(sortedItems);

  let html = '';

  // 结果头部
  const timeLabel = selectedTimePeriod.label || '全部时间';
  html += `<div class="search-results-header">
    <span class="srh-icon">🐱</span>
    <span class="srh-title">「${escapeHtml(keyword)}」的搜索结果</span>
    <span class="srh-count">${count} 条 · ${timeLabel}</span>
  </div>`;

  if (count === 0) {
    html += renderEmptyState(keyword);
  } else {
    // 时间筛选栏
    html += renderTimeFilterBar(count);
    // 来源筛选栏
    html += renderSourceFilters(groups);
    // 结果容器
    html += '<div id="searchResultsContent"></div>';
  }

  if (resultCount) {
    resultCount.textContent = count > 0 ? `🐾 共 ${count} 条 · ${timeLabel}` : '';
  }

  resultsContainer.innerHTML = html;

  if (count > 0) renderFilteredResults();

  console.log(`[Search] Displaying ${count} results for "${keyword}"`);
}

function renderEmptyState(keyword) {
  return `
    <div class="empty-state">
      <div style="font-size:60px;margin-bottom:12px">😿</div>
      <p style="color:var(--text);font-weight:600;font-size:16px">暂时没有找到相关内容</p>
      <p style="color:var(--text-light);margin-top:8px;font-size:13px">
        可能是搜索词太特殊，或者时间范围太窄<br>
        试试换个关键词，或选择「全部时间」？
      </p>
      <button onclick="switchTab('hot')" style="margin-top:16px;padding:10px 24px;background:var(--gold-gradient);color:white;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(255,165,0,0.3)">
        🔥 查看全网热榜
      </button>
    </div>
  `;
}

// ===== 时间筛选栏 =====

function renderTimeFilterBar(totalCount) {
  let html = '<div class="time-filter-bar">';
  html += '<span class="tf-label">⏱ 时间筛选:</span>';

  TIME_PERIODS.forEach((period, idx) => {
    const isActive = selectedTimePeriod.value === period.value && selectedTimePeriod.ms === period.ms;
    html += `<button class="tf-chip ${isActive ? 'active' : ''}" onclick="selectTimePeriod(${idx})">
      ${period.label}
    </button>`;
  });

  html += '</div>';
  return html;
}

function selectTimePeriod(idx) {
  selectedTimePeriod = TIME_PERIODS[idx];

  // 如果已有缓存结果，直接重新筛选渲染
  if (allSearchResults) {
    // 客户端时间过滤
    const filterBar = document.querySelector('.time-filter-bar');
    if (filterBar) {
      filterBar.outerHTML = renderTimeFilterBar(allSearchResults.count);
    }

    // 更新头部标签
    const srhCount = document.querySelector('.srh-count');
    if (srhCount) {
      srhCount.textContent = `${allSearchResults.count} 条 · ${selectedTimePeriod.label}`;
    }

    renderFilteredResults();
  }
}

// ===== 来源筛选栏 =====

function renderSourceFilters(groups) {
  let html = '<div class="source-filter-bar">';
  html += '<span class="sf-label">📂 来源筛选:</span>';

  // "全部" 按钮
  const isAllActive = activeSourceFilters.length === 0;
  html += `<button class="sf-chip ${isAllActive ? 'active' : ''}" onclick="toggleSourceFilter('__ALL__')">
    🐱 全部
  </button>`;

  groups.forEach(g => {
    const info = getSourceInfo(g.key === '__other__' ? 'other.example.com' : (g.items[0]?.source || g.key));
    // 如果 key 是 __other__，使用 OTHER_SOURCE
    const displayInfo = g.key === '__other__' ? OTHER_SOURCE : 
      (ALLOWED_SOURCES[g.key] || OTHER_SOURCE);
    const isActive = activeSourceFilters.includes(g.key);
    html += `<button class="sf-chip ${isActive ? 'active' : ''}"
      onclick="toggleSourceFilter('${escapeAttr(g.key)}')"
      style="--sf-color:${displayInfo.color}">
      ${displayInfo.emoji} ${displayInfo.name}
      <span class="sf-chip-count">${g.items.length}</span>
    </button>`;
  });

  if (activeSourceFilters.length > 0) {
    html += '<button class="sf-clear-btn" onclick="clearSourceFilters()">✕ 清除</button>';
  }

  html += '</div>';
  return html;
}

// ===== 结果渲染（含时间过滤+日期排序） =====

function sortItemsByDate(items) {
  return [...items].sort((a, b) => {
    const ta = a._ts || 0;
    const tb = b._ts || 0;
    if (ta > 0 && tb > 0) return tb - ta;     // 都有日期：从近到远
    if (ta > 0) return -1;                    // a 有日期，b 没有：a 在前
    if (tb > 0) return 1;                     // b 有日期，a 没有：b 在前
    return 0;                                 // 都没有日期：保持原序
  });
}

function applyTimeFilter(items) {
  if (!selectedTimePeriod.ms) return items; // "全部时间"，不筛选
  const cutoff = Date.now() - selectedTimePeriod.ms;
  return items.filter(item => {
    const ts = item._ts || 0;
    return ts === 0 || ts >= cutoff; // 无日期的不排除（可能是近期内容）
  });
}

function renderFilteredResults() {
  if (!allSearchResults) return;

  const items = allSearchResults.results || [];

  // 1. 时间筛选
  let filtered = applyTimeFilter(items);

  // 2. 日期排序（从近到远）
  filtered = sortItemsByDate(filtered);

  // 3. 来源筛选
  if (activeSourceFilters.length > 0) {
    filtered = filtered.filter(item => {
      const key = getSourceKey(item.source || '');
      return activeSourceFilters.includes(key);
    });
  }

  const groups = groupResultsBySource(filtered);
  const el = document.getElementById('searchResultsContent');
  if (!el) return;

  let html = '';

  groups.forEach(g => {
    const displayInfo = g.key === '__other__' ? OTHER_SOURCE :
      (ALLOWED_SOURCES[g.key] || OTHER_SOURCE);

    html += `<div class="source-group">
      <div class="source-group-header">
        <span class="source-badge" style="background:${displayInfo.color}">${displayInfo.emoji} ${displayInfo.name}</span>
        <span class="source-group-count">${g.items.length} 条</span>
      </div>
      <div class="results-grid">`;

    g.items.forEach(item => {
      const relDate = formatRelativeDate(item._ts);
      html += `
        <a href="${item.url || '#'}" target="_blank" rel="noopener" class="result-card">
          <div class="card-title">${escapeHtml(item.title)}</div>
          ${item.snippet ? `<div class="card-snippet">${escapeHtml(item.snippet)}</div>` : ''}
          <div class="card-footer">
            <span class="card-author">
              <span class="ca-dot" style="background:${displayInfo.color}"></span>${escapeHtml(displayInfo.name)}
            </span>
            <span class="card-date">${relDate ? '🕐 ' + relDate : ''}</span>
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
        <p style="color:var(--text-light);font-weight:600">当前筛选条件下没有结果</p>
        <p style="font-size:13px;color:var(--text-lighter);margin-top:4px">试试扩大时间范围或清除来源筛选</p>
      </div>
    `;
  }

  el.innerHTML = html;

  // 更新来源筛选栏
  const groupsAll = groupResultsBySource(applyTimeFilter(allSearchResults.results));
  const sfBar = document.querySelector('.source-filter-bar');
  if (sfBar) sfBar.outerHTML = renderSourceFilters(groupsAll);

  // 更新计数
  if (resultCount) {
    const suffix = activeSourceFilters.length > 0 ? ' (已筛选)' : '';
    resultCount.textContent = `🐾 共 ${filtered.length} 条 · ${selectedTimePeriod.label}${suffix}`;
  }
}

// ===== 来源筛选交互 =====

function toggleSourceFilter(key) {
  if (key === '__ALL__') {
    activeSourceFilters = [];
  } else {
    const idx = activeSourceFilters.indexOf(key);
    if (idx >= 0) activeSourceFilters.splice(idx, 1);
    else activeSourceFilters.push(key);
  }
  renderFilteredResults();
  const sfBar = document.querySelector('.source-filter-bar');
  if (sfBar) sfBar.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clearSourceFilters() {
  activeSourceFilters = [];
  renderFilteredResults();
}

function displaySearchError(msg, keyword, debugMsg) {
  const debugHtml = debugMsg ? `<details style="margin-top:12px;font-size:12px;color:var(--text-lighter)">
    <summary style="cursor:pointer;color:var(--text-light)">查看技术详情</summary>
    <div style="margin-top:6px;padding:8px;background:#f5f5f5;border-radius:6px;word-break:break-all;font-family:monospace;font-size:11px">${escapeHtml(debugMsg)}</div>
  </details>` : '';

  resultsContainer.innerHTML = `
    <div class="empty-state">
      <div style="font-size:60px;margin-bottom:12px">😿</div>
      <p style="color:var(--accent-deep);font-weight:600;font-size:16px">${escapeHtml(msg)}</p>
      <p style="color:var(--text-light);margin-top:8px;font-size:13px">
        您可以稍后重试，或查看 🔥 全网热榜 获取最新资讯
      </p>
      ${debugHtml}
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
        </div>`;

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
          </a>`;
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
    </div>`;

  const data = await loadHotData(platformId);
  if (!data || !data.list || data.list.length === 0) {
    container.innerHTML = `
      <div class="hot-empty-state">
        <div style="font-size:48px;margin-bottom:12px">😿</div>
        <p>${platform.emoji} ${platform.name}热榜暂时不可用</p>
        <p style="font-size:13px;color:var(--text-lighter);margin-top:4px">数据可能正在更新中</p>
      </div>`;
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
      </a>`;
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
