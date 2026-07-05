// ============================================================
// 哈基米新闻 - 纯前端版 V4 CORS代理搜索
// 策略：allorigins CORS代理 → Bing site:搜索 → 浏览器解析
// 无需后端服务器，完全静态部署
// ============================================================

// ===== 平台配置 =====
const PLATFORMS = [
  { id: 'douban', name: '豆瓣', color: '#007722', emoji: '📚', site: 'douban.com', searchUrl: 'https://www.douban.com/search?q=' },
  { id: 'zhihu', name: '知乎', color: '#0084FF', emoji: '💡', site: 'zhihu.com', searchUrl: 'https://www.zhihu.com/search?q=' },
  { id: 'xiaohongshu', name: '小红书', color: '#FF2442', emoji: '📕', site: 'xiaohongshu.com', searchUrl: 'https://www.xiaohongshu.com/search_result?keyword=' },
  { id: 'weibo', name: '微博', color: '#E6162D', emoji: '📡', site: 'weibo.com', searchUrl: 'https://s.weibo.com/weibo?q=' },
  { id: 'douyin', name: '抖音', color: '#161823', emoji: '🎵', site: 'douyin.com', searchUrl: 'https://www.douyin.com/search/' },
  { id: 'toutiao', name: '今日头条', color: '#F04142', emoji: '📰', site: 'toutiao.com', searchUrl: 'https://so.toutiao.com/search?keyword=' },
  { id: 'ifeng', name: '凤凰新闻', color: '#C30820', emoji: '🦅', site: 'ifeng.com', searchUrl: 'https://search.ifeng.com/?q=' },
  { id: 'thepaper', name: '澎湃新闻', color: '#F05051', emoji: '🌊', site: 'thepaper.cn', searchUrl: 'https://www.thepaper.cn/searchResult?id=' },
  { id: 'daxiang', name: '大象新闻', color: '#FF6600', emoji: '🐘', site: 'dxntv.com', searchUrl: 'https://www.dxntv.com/search?keyword=' },
];

// ===== CORS 代理配置 =====
const CORS_PROXIES = [
  (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`,
];

// ===== 状态管理 =====
let currentKeyword = '';
let currentResults = {};
let activePlatform = 'all';
let autoRefreshTimer = null;
let isSearching = false;

// ===== DOM 元素 =====
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const platformFilters = document.getElementById('platformFilters');
const resultsContainer = document.getElementById('resultsContainer');
const autoRefreshToggle = document.getElementById('autoRefresh');
const resultCount = document.getElementById('resultCount');
const lastUpdate = document.getElementById('lastUpdate');
const serverStatus = document.getElementById('serverStatus');

// ===== 初始化状态显示 =====
if (serverStatus) {
  serverStatus.textContent = '🟢 云端搜索就绪';
  serverStatus.style.color = '#2e7d32';
}

// ===== 浮动猫爪背景 =====
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

// ===== 初始化平台筛选 =====
function initPlatformFilters() {
  PLATFORMS.forEach(p => {
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
    activePlatform = chip.dataset.platform;
    
    if (Object.keys(currentResults).length > 0) {
      renderResults();
    }
  });
}

// ============================================================
// CORS 代理请求
// ============================================================
async function fetchViaProxy(targetUrl, timeoutMs = 25000) {
  for (let i = 0; i < CORS_PROXIES.length; i++) {
    const proxyUrl = CORS_PROXIES[i](targetUrl);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      const resp = await fetch(proxyUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!resp.ok) continue;
      
      const text = await resp.text();
      
      // allorigins 返回 JSON
      if (i === 0) {
        try {
          const data = JSON.parse(text);
          if (data.contents) return data.contents;
          if (data.status && data.status.http_code !== 200) continue;
        } catch (e) {
          // 可能是纯文本
          if (text.length > 100) return text;
        }
      } else {
        // codetabs 返回原始内容
        if (text.length > 100) return text;
      }
    } catch (e) {
      console.log(`代理 ${i} 失败:`, e.message);
    }
  }
  throw new Error('所有代理均失败');
}

// ============================================================
// Bing 搜索解析
// ============================================================
function parseBingResults(html, maxResults = 8) {
  const results = [];
  
  // 匹配 Bing 搜索结果项
  const algoRegex = /<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
  let match;
  let count = 0;
  
  while ((match = algoRegex.exec(html)) !== null && count < maxResults) {
    const block = match[1];
    
    // 提取链接
    const linkMatch = block.match(/<h2>\s*<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) continue;
    
    const link = linkMatch[1];
    const title = cleanText(linkMatch[2]);
    
    // 提取摘要
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const snippet = snippetMatch ? cleanText(snippetMatch[1]) : '';
    
    // 提取来源
    const sourceMatch = block.match(/<cite[^>]*>([\s\S]*?)<\/cite>/);
    const source = sourceMatch ? cleanText(sourceMatch[1]) : '';
    
    if (title && link) {
      results.push({
        title,
        snippet: truncate(snippet, 200),
        url: link,
        author: source || '',
      });
      count++;
    }
  }
  
  return results;
}

// ============================================================
// DuckDuckGo HTML 搜索解析
// ============================================================
function parseDuckDuckGoResults(html, maxResults = 8) {
  const results = [];
  
  const resultRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  let count = 0;
  
  while ((match = resultRegex.exec(html)) !== null && count < maxResults) {
    let link = match[1];
    const title = cleanText(match[2]);
    
    // DuckDuckGo 重定向链接
    if (link.includes('uddg=')) {
      const uddgMatch = link.match(/uddg=([^&]+)/);
      if (uddgMatch) link = decodeURIComponent(uddgMatch[1]);
    }
    
    if (title && link) {
      results.push({
        title,
        snippet: '',
        url: link,
        author: '',
      });
      count++;
    }
  }
  
  return results;
}

// ============================================================
// 单平台搜索
// ============================================================
async function searchPlatform(platform, keyword) {
  // 策略1: Bing site: 搜索
  try {
    const bingUrl = `https://cn.bing.com/search?q=${encodeURIComponent(keyword + ' site:' + platform.site)}&count=10`;
    const html = await fetchViaProxy(bingUrl, 20000);
    const results = parseBingResults(html, 8);
    if (results.length > 0) return { results, status: 'success' };
  } catch (e) {
    console.log(`${platform.name} Bing搜索失败:`, e.message);
  }
  
  // 策略2: Bing 不限站点搜索
  try {
    const domainName = platform.site.split('.')[0];
    const bingUrl2 = `https://cn.bing.com/search?q=${encodeURIComponent(keyword + ' ' + domainName)}&count=10`;
    const html2 = await fetchViaProxy(bingUrl2, 20000);
    const results2 = parseBingResults(html2, 8).filter(r => r.url.includes(platform.site));
    if (results2.length > 0) return { results: results2, status: 'success' };
  } catch (e) {
    console.log(`${platform.name} Bing兜底搜索失败:`, e.message);
  }
  
  // 策略3: DuckDuckGo HTML 搜索
  try {
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(keyword + ' site:' + platform.site)}`;
    const html3 = await fetchViaProxy(ddgUrl, 15000);
    const results3 = parseDuckDuckGoResults(html3, 8);
    if (results3.length > 0) return { results: results3, status: 'success' };
  } catch (e) {
    console.log(`${platform.name} DuckDuckGo搜索失败:`, e.message);
  }
  
  return { results: [], status: 'empty' };
}

// ============================================================
// 渐进式渲染
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
  
  if (activePlatform === 'all' || activePlatform === platform.id) {
    renderResults();
  }
  updateResultCount();
  updateChipCounts();
}

function updateChipCounts() {
  PLATFORMS.forEach(p => {
    const data = currentResults[p.id];
    const countEl = document.querySelector(`[data-count="${p.id}"]`);
    if (countEl && data) {
      const count = data.results.length;
      countEl.textContent = count;
      countEl.style.display = count > 0 ? 'inline-block' : 'none';
    }
  });
}

// ===== 执行搜索 =====
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
  
  try {
    // 并行搜索所有平台（每批3个，避免代理限流）
    const batchSize = 3;
    for (let i = 0; i < PLATFORMS.length; i += batchSize) {
      const batch = PLATFORMS.slice(i, i + batchSize);
      const promises = batch.map(async (platform) => {
        try {
          const { results, status } = await searchPlatform(platform, keyword);
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
    
    updateResultCount();
    
  } catch (error) {
    showError('搜索出错：' + error.message);
  } finally {
    isSearching = false;
    searchBtn.disabled = false;
    searchBtn.innerHTML = '<span class="btn-icon">🔍</span> 搜索';
  }
}

// ===== 加载状态 =====
function showLoadingState() {
  const html = `
    <div class="loading-grid">
      ${PLATFORMS.map(p => `
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

// ===== 渲染结果 =====
function renderResults() {
  const platforms = activePlatform === 'all' 
    ? Object.keys(currentResults) 
    : [activePlatform];

  if (platforms.length === 0 || Object.keys(currentResults).length === 0) {
    return;
  }

  let html = '';
  let total = 0;

  const orderedIds = activePlatform === 'all' 
    ? PLATFORMS.map(p => p.id)
    : [activePlatform];

  orderedIds.forEach(platformId => {
    const platformData = currentResults[platformId];
    if (!platformData) return;

    const count = platformData.results.length;
    total += count;

    const platformInfo = PLATFORMS.find(p => p.id === platformId);
    const emoji = platformInfo ? platformInfo.emoji : '🐾';

    let statusClass = 'status-empty';
    let statusText = '🐱 无结果';
    if (platformData.status === 'success') {
      statusClass = 'status-success';
      statusText = `✅ ${count} 条结果`;
    } else if (platformData.status === 'pending') {
      statusClass = 'status-pending';
      statusText = '⏳ 搜索中...';
    } else if (platformData.status === 'empty') {
      statusClass = 'status-empty';
      statusText = '🐱 暂无结果';
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
        html += `
          <a href="${item.url}" target="_blank" rel="noopener" class="result-card" style="--card-color: ${platformData.color}">
            <div class="card-title">${escapeHtml(item.title)}</div>
            ${item.snippet ? `<div class="card-snippet">${escapeHtml(item.snippet)}</div>` : '<div class="card-snippet"></div>'}
            <div class="card-footer">
              <span class="card-author">${item.author ? escapeHtml(item.author) : ''}</span>
              <span>🔗 点击查看</span>
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

// ===== 错误状态 =====
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

// ===== 辅助函数 =====
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
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

function updateLastUpdate() {
  const now = new Date();
  lastUpdate.textContent = `更新于 ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
}

function updateResultCount() {
  let total = 0;
  Object.values(currentResults).forEach(p => { total += p.results.length; });
  resultCount.textContent = total > 0 ? `🐾 共 ${total} 条结果` : '';
}

// ===== 自动刷新 =====
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

// ===== 事件绑定 =====
searchBtn.addEventListener('click', () => {
  performSearch(searchInput.value);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    performSearch(searchInput.value);
  }
});

autoRefreshToggle.addEventListener('change', toggleAutoRefresh);

// ===== 初始化 =====
initFloatingPaws();
initPlatformFilters();
