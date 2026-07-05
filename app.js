// ============================================================
// 哈基米新闻 V5 - 搜狗搜索 + 热榜 API
// CORS 代理: cors.eu.org (支持 CORS *)
// 搜索引擎: 搜狗搜索 (site: 限定)
// 热榜数据: 百度热搜 + 头条热榜 + 澎湃新闻
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

// ===== CORS 代理 =====
const CORS_PROXIES = [
  (url) => `https://cors.eu.org/${url}`,
  (url) => `https://proxy.cors.sh/${url}`,
];

// ===== 状态管理 =====
let currentKeyword = '';
let currentResults = {};
let activePlatform = 'all';
let autoRefreshTimer = null;
let isSearching = false;
let currentTab = 'search';
let hotBoardsCache = null;

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
  serverStatus.textContent = '🟢 云端搜索就绪';
  serverStatus.style.color = '#2e7d32';
}

// ============================================================
// CORS 代理请求
// ============================================================
async function fetchViaProxy(targetUrl, timeoutMs = 20000) {
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
      if (text && text.length > 100) return text;

    } catch (e) {
      console.log(`代理 ${i} 失败:`, e.message);
    }
  }
  throw new Error('所有代理均失败');
}

// ============================================================
// 搜狗搜索结果解析
// ============================================================
function parseSogouResults(html, maxResults = 8) {
  const results = [];

  // 按 vrwrap 分割结果块
  const blocks = html.split(/<div[^>]*class="[^"]*vrwrap[^"]*"/);
  
  for (let i = 1; i < blocks.length && results.length < maxResults; i++) {
    const block = blocks[i];
    
    // 跳过"大家还在搜"等非结果块
    if (block.includes('大家还在搜') || block.includes('hint-mid')) continue;
    
    // 提取标题和链接
    let title = '';
    let link = '';
    let realUrl = '';
    
    // 从 h3 > a 中提取
    const titleMatch = block.match(/<h3[^>]*class="[^"]*vr-title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (titleMatch) {
      link = titleMatch[1];
      title = cleanText(titleMatch[2]);
    }
    
    if (!title) {
      // 尝试其他格式
      const altTitleMatch = block.match(/<a[^>]*name="dttl"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (altTitleMatch) {
        link = altTitleMatch[1];
        title = cleanText(altTitleMatch[2]);
      }
    }
    
    if (!title) continue;
    
    // 提取真实 URL (data-url 属性)
    const dataUrlMatch = block.match(/data-url="([^"]+)"/);
    if (dataUrlMatch) {
      realUrl = dataUrlMatch[1];
    }
    
    // 如果没有 data-url，检查 citeLinkClass 中的 URL
    if (!realUrl) {
      const citeUrlMatch = block.match(/citeLinkClass[^>]*>[\s\S]*?<span[^>]*>(https?:\/\/[^<]+)<\/span>/);
      if (citeUrlMatch) {
        realUrl = citeUrlMatch[1].replace(/\.\.\./g, '');
      }
    }
    
    // 如果还是没有，用搜狗链接
    if (!realUrl) {
      if (link.startsWith('/link?')) {
        realUrl = 'https://www.sogou.com' + link;
      } else if (link.startsWith('http')) {
        realUrl = link;
      }
    }
    
    // 提取摘要
    let snippet = '';
    const snippetMatch = block.match(/<div[^>]*class="[^"]*fz-mid[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (snippetMatch) {
      snippet = cleanText(snippetMatch[1]);
    }
    
    // 提取来源
    let source = '';
    let date = '';
    const citeMatch = block.match(/citeLinkClass[^>]*>([\s\S]*?)<\/a>/);
    if (citeMatch) {
      const citeText = citeMatch[1];
      // 来源名称在 <span> 中
      const spans = citeText.match(/<span[^>]*>([^<]+)<\/span>/g);
      if (spans) {
        spans.forEach((span, idx) => {
          const text = cleanText(span);
          if (idx === 0) source = text;
          else if (/\d{4}-\d{2}-\d{2}/.test(text)) date = text;
        });
      }
    }
    
    if (title) {
      results.push({
        title: truncate(title, 100),
        snippet: truncate(snippet, 300),
        url: realUrl || link,
        author: source || '',
        date: date || '',
      });
    }
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
    
    // 检查是否被反爬
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
// 热榜获取
// ============================================================
async function fetchBaiduHot() {
  try {
    const url = 'https://top.baidu.com/api/board?platform=wise&tab=realtime';
    const html = await fetchViaProxy(url, 15000);
    const data = JSON.parse(html);
    const cards = data.data?.cards || [];
    const items = [];
    
    if (cards[0]?.content) {
      const content = cards[0].content;
      // content 可能是嵌套数组
      const flatContent = Array.isArray(content[0]) ? content[0] : content;
      flatContent.forEach(item => {
        if (item.word) {
          items.push({
            title: item.word,
            url: item.url || '',
            hot: item.hotScore || '',
            rank: item.index || items.length + 1,
          });
        }
      });
    }
    return items.slice(0, 20);
  } catch (e) {
    console.log('百度热搜获取失败:', e.message);
    return [];
  }
}

async function fetchToutiaoHot() {
  try {
    const url = 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc';
    const html = await fetchViaProxy(url, 15000);
    const data = JSON.parse(html);
    const items = (data.data || []).map((item, idx) => ({
      title: item.Title || '',
      url: item.Url || '',
      hot: item.HotValue || '',
      rank: idx + 1,
      image: item.Image || '',
    }));
    return items.slice(0, 20);
  } catch (e) {
    console.log('头条热榜获取失败:', e.message);
    return [];
  }
}

async function fetchPaperHot() {
  try {
    const url = 'https://cache.thepaper.cn/contentapi/wwwIndex/rightSidebar';
    const html = await fetchViaProxy(url, 15000);
    const data = JSON.parse(html);
    const hotNews = data.data?.hotNews || [];
    const items = hotNews.map((item, idx) => ({
      title: item.name || '',
      url: item.link || `https://www.thepaper.cn/newsDetail_forward_${item.contId}`,
      hot: item.praiseTimes || '',
      rank: idx + 1,
      date: item.pubTime || '',
      image: item.pic || '',
    }));
    return items.slice(0, 20);
  } catch (e) {
    console.log('澎湃新闻获取失败:', e.message);
    return [];
  }
}

async function fetchAllHotBoards() {
  const [baidu, toutiao, paper] = await Promise.allSettled([
    fetchBaiduHot(),
    fetchToutiaoHot(),
    fetchPaperHot(),
  ]);
  
  return {
    baidu: baidu.status === 'fulfilled' ? baidu.value : [],
    toutiao: toutiao.status === 'fulfilled' ? toutiao.value : [],
    paper: paper.status === 'fulfilled' ? paper.value : [],
  };
}

// ============================================================
// 渲染热榜
// ============================================================
function renderHotBoards(data) {
  const sections = [
    { id: 'baidu', name: '百度热搜', emoji: '🔥', color: '#2932E1', items: data.baidu },
    { id: 'toutiao', name: '今日头条', emoji: '📰', color: '#F04142', items: data.toutiao },
    { id: 'paper', name: '澎湃新闻', emoji: '🌊', color: '#F05051', items: data.paper },
  ];
  
  let html = '<div class="hot-boards-grid">';
  
  sections.forEach(section => {
    const count = section.items.length;
    let statusBadge = '';
    if (count > 0) {
      statusBadge = `<span class="hot-status ok">✅ ${count} 条</span>`;
    } else {
      statusBadge = `<span class="hot-status fail">❌ 获取失败</span>`;
    }
    
    html += `
      <div class="hot-board-section">
        <div class="hot-board-header">
          <span class="hot-board-badge" style="background: ${section.color}">
            ${section.emoji} ${section.name}
          </span>
          ${statusBadge}
        </div>
    `;
    
    if (count > 0) {
      html += '<div class="hot-items-list">';
      section.items.slice(0, 15).forEach((item, idx) => {
        const rankClass = idx < 3 ? 'hot-rank-top' : '';
        const hotText = item.hot ? `<span class="hot-value">🔥 ${formatHot(item.hot)}</span>` : '';
        const dateText = item.date ? `<span class="hot-date">${item.date}</span>` : '';
        
        html += `
          <a href="${item.url || '#'}" target="_blank" rel="noopener" class="hot-item ${rankClass}">
            <span class="hot-rank">${idx + 1}</span>
            <div class="hot-content">
              <div class="hot-title">${escapeHtml(item.title)}</div>
              <div class="hot-meta">${hotText}${dateText}</div>
            </div>
          </a>
        `;
      });
      html += '</div>';
    } else {
      html += '<div class="hot-empty">🐱 暂时获取不到数据，稍后再试</div>';
    }
    
    html += '</div>';
  });
  
  html += '</div>';
  
  const hotResults = document.getElementById('hotResults');
  if (hotResults) {
    hotResults.innerHTML = html;
  }
}

function formatHot(hot) {
  const num = parseInt(hot);
  if (isNaN(num)) return hot;
  if (num >= 10000000) return (num / 10000000).toFixed(1) + '千万';
  if (num >= 10000) return (num / 10000).toFixed(1) + '万';
  return num.toString();
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
  
  try {
    // 并行搜索所有平台（每批3个）
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

// ============================================================
// 加载状态
// ============================================================
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

// ============================================================
// 渲染搜索结果
// ============================================================
function renderResults() {
  const orderedIds = activePlatform === 'all'
    ? PLATFORMS.map(p => p.id)
    : [activePlatform];

  if (Object.keys(currentResults).length === 0) return;

  let html = '';
  let total = 0;

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
        const dateHtml = item.date ? `<span class="card-date">📅 ${escapeHtml(item.date)}</span>` : '';
        const sourceHtml = item.author ? `<span class="card-author">${escapeHtml(item.author)}</span>` : '';
        
        html += `
          <a href="${item.url}" target="_blank" rel="noopener" class="result-card" style="--card-color: ${platformData.color}">
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

function updateLastUpdate() {
  const now = new Date();
  lastUpdate.textContent = `更新于 ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
}

function updateResultCount() {
  let total = 0;
  Object.values(currentResults).forEach(p => { total += p.results.length; });
  resultCount.textContent = total > 0 ? `🐾 共 ${total} 条结果` : '';
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
    // 自动加载热榜
    if (!hotBoardsCache) {
      loadHotBoards();
    }
  }
}

async function loadHotBoards() {
  const hotResults = document.getElementById('hotResults');
  if (hotResults) {
    hotResults.innerHTML = `
      <div class="hot-loading">
        <div class="loading-spinner" style="border-color:#FFD70033;border-top-color:#FFD700"></div>
        <p>🐱 正在获取各平台热榜...</p>
      </div>
    `;
  }
  
  try {
    hotBoardsCache = await fetchAllHotBoards();
    renderHotBoards(hotBoardsCache);
  } catch (e) {
    if (hotResults) {
      hotResults.innerHTML = `<div class="hot-loading"><p>😿 获取热榜失败：${escapeHtml(e.message)}</p></div>`;
    }
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
// 初始化平台筛选
// ============================================================
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

// ============================================================
// 初始化
// ============================================================
initFloatingPaws();
initPlatformFilters();
