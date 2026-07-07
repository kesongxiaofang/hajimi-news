#!/usr/bin/env python3
"""
V10: Fast multi-source search using Bing + DuckDuckGo.

Strategy:
1. Search Bing site: for each of 9 platforms (parallel, ~2s each)
2. Search Bing general (no site: operator)
3. Search DuckDuckGo site: for each platform (parallel, fallback/supplement)
4. Aggregate and deduplicate
5. Sort by relevance

uapis.cn search API removed (was 31s/call, poor quality results).
uapis.cn hot board API kept (fast, reliable).
"""

import argparse
import json
import os
import time
import urllib.request
import urllib.parse
import re
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

# Platform site mappings for search source filter (matches frontend ALLOWED_SOURCES)
PLATFORM_SITES = {
    "weibo": "weibo.com",
    "zhihu": "zhihu.com",
    "douyin": "douyin.com",
    "bilibili": "bilibili.com",
    "xiaohongshu": "xiaohongshu.com",
    "toutiao": "toutiao.com",
    "thepaper": "thepaper.cn",
    "douban": "douban.com",
    "ifeng": "ifeng.com",
}

# Platform domain aliases for URL verification
PLATFORM_DOMAIN_ALIASES = {
    "xiaohongshu.com": ["xiaohongshu.com", "xhslink.com", "m.xiaohongshu.com"],
    "weibo.com": ["weibo.com", "m.weibo.cn", "t.cn"],
    "zhihu.com": ["zhihu.com", "zhuanlan.zhihu.com", "m.zhihu.com"],
    "douyin.com": ["douyin.com", "v.douyin.com", "m.douyin.com", "iesdouyin.com"],
    "bilibili.com": ["bilibili.com", "b23.tv", "m.bilibili.com"],
    "toutiao.com": ["toutiao.com", "m.toutiao.com"],
    "thepaper.cn": ["thepaper.cn", "m.thepaper.cn"],
    "douban.com": ["douban.com", "m.douban.com"],
    "ifeng.com": ["ifeng.com", "m.ifeng.com", "share.ifeng.com"],
}

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(REPO_ROOT, "data")

# Cache settings (short duration to avoid stale results)
CACHE_FILE = os.path.join(DATA_DIR, "search-cache.json")
CACHE_DURATION = 300  # 5 minutes (was 24 hours)
CACHE_VERSION = "v10"  # Bump for V10 architecture change


def fetch_url(url, timeout=10, headers=None):
    """Fetch URL and return response as bytes."""
    if headers is None:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def parse_bing_html(html, site_domain=None, max_results=20):
    """Parse Bing HTML results and extract search items."""
    results = []
    result_pattern = r'<li class="b_algo"[^>]*>(.*?)</li>'
    result_blocks = re.findall(result_pattern, html, re.DOTALL)

    for block in result_blocks[:max_results]:
        # Extract title and URL from <h2><a href="...">...</a></h2>
        title_match = re.search(r'<h2[^>]*>.*?<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>.*?</h2>', block, re.DOTALL)
        snippet_match = re.search(r'<div class="b_caption"[^>]*>(.*?)</div>', block, re.DOTALL)

        if title_match:
            title_url = title_match.group(1).strip()
            title = re.sub(r'<[^>]+>', '', title_match.group(2)).strip()

            if not title_url.startswith('http'):
                continue

            snippet = ""
            if snippet_match:
                snippet = re.sub(r'<[^>]+>', '', snippet_match.group(1)).strip()

            # Determine source domain
            from urllib.parse import urlparse
            parsed = urlparse(title_url)
            domain = parsed.netloc.lower()
            if domain.startswith("www."):
                domain = domain[4:]

            results.append({
                "title": title,
                "url": title_url,
                "snippet": snippet[:300],
                "source": site_domain if site_domain else domain,
                "date": "",
                "search_source": "Bing"
            })

    return results


def search_bing_site(query, site_domain, max_results=20):
    """Search via Bing HTML API with site: operator."""
    print(f"    [Bing] Searching site:{site_domain} for '{query}'...")
    try:
        site_query = f"site:{site_domain} {query}"
        url = f'https://www.bing.com/search?q={urllib.parse.quote(site_query)}&count={max_results}&setmkt=zh-CN&setlang=zh-CN'

        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        }

        html = fetch_url(url, timeout=15, headers=headers).decode('utf-8', errors='ignore')
        results = parse_bing_html(html, site_domain=site_domain, max_results=max_results)

        print(f"    [Bing] Found {len(results)} results from {site_domain}")
        return results

    except Exception as e:
        print(f"    [Bing] Error for {site_domain}: {e}")
        return []


def search_bing_general(query, max_results=20):
    """Search via Bing without site: operator (general search)."""
    print(f"    [Bing] General search for '{query}'...")
    try:
        url = f'https://www.bing.com/search?q={urllib.parse.quote(query)}&count={max_results}&setmkt=zh-CN&setlang=zh-CN'

        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        }

        html = fetch_url(url, timeout=15, headers=headers).decode('utf-8', errors='ignore')
        results = parse_bing_html(html, site_domain=None, max_results=max_results)

        print(f"    [Bing] Found {len(results)} general results")
        return results

    except Exception as e:
        print(f"    [Bing] General search error: {e}")
        return []


def search_duckduckgo_site(query, site_domain, max_results=10):
    """Search via DuckDuckGo HTML API with site: operator."""
    print(f"    [DuckDuckGo] Searching site:{site_domain} for '{query}'...")
    try:
        site_query = f"site:{site_domain} {query}"
        url = f'https://html.duckduckgo.com/html/?q={urllib.parse.quote(site_query)}&kl=wt-wt'

        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        }

        html = fetch_url(url, timeout=15, headers=headers).decode('utf-8')

        results = []
        result_pattern = r'<div class="result__body">(.*?)</div>\s*</div>'
        result_blocks = re.findall(result_pattern, html, re.DOTALL)

        for block in result_blocks[:max_results]:
            title_match = re.search(r'<a[^>]*class="result__a"[^>]*>([^<]*)</a>', block, re.DOTALL)
            url_match = re.search(r'<a[^>]*class="result__a"[^>]*href="([^"]*)"', block)
            snippet_match = re.search(r'<a[^>]*class="result__snippet"[^>]*>([^<]*)</a>', block, re.DOTALL)

            if title_match and url_match:
                title = re.sub(r'<[^>]+>', '', title_match.group(1)).strip()
                url = url_match.group(1).strip()

                if url.startswith('//duckduckgo.com/l/?'):
                    actual_url_match = re.search(r'uddg=(.*?)&', url)
                    if actual_url_match:
                        url = urllib.parse.unquote(actual_url_match.group(1))

                if url.startswith('http://') or url.startswith('https://'):
                    snippet = ""
                    if snippet_match:
                        snippet = re.sub(r'<[^>]+>', '', snippet_match.group(1)).strip()

                    results.append({
                        "title": title,
                        "url": url,
                        "snippet": snippet[:300],
                        "source": site_domain,
                        "date": "",
                        "search_source": "DuckDuckGo"
                    })

        print(f"    [DuckDuckGo] Found {len(results)} results from {site_domain}")
        return results

    except Exception as e:
        print(f"    [DuckDuckGo] Error for {site_domain}: {e}")
        return []


def check_search_cache(query, time_range="", sort_by=""):
    """Check if we have cached results for this query (5-minute cache)."""
    if not os.path.exists(CACHE_FILE):
        return None

    try:
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            cache = json.load(f)

        if cache.get("query") != query:
            return None
        if cache.get("time_range") != time_range:
            return None
        if cache.get("cache_version") != CACHE_VERSION:
            print(f"  Cache version mismatch, ignoring")
            return None

        update_time = cache.get("update_time", "")
        if update_time:
            try:
                update_dt = datetime.strptime(update_time, "%Y-%m-%dT%H:%M:%SZ")
                age = (datetime.utcnow() - update_dt).total_seconds()
                if age > CACHE_DURATION:
                    print(f"  Cache expired ({age:.0f}s old)")
                    return None
            except:
                return None

        print(f"  Cache hit! Found {cache.get('count', 0)} results")
        return cache

    except Exception as e:
        print(f"  Cache check failed: {e}")
        return None


def save_search_cache(query, time_range, sort_by, results, count):
    """Save search results to cache."""
    try:
        os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)

        cache_data = {
            "query": query,
            "time_range": time_range,
            "sort": sort_by,
            "update_time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "count": count,
            "results": results,
            "cache_version": CACHE_VERSION,
        }

        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache_data, f, ensure_ascii=False, indent=2)

        print(f"  Cache saved: {count} results")

    except Exception as e:
        print(f"  Cache save failed: {e}")


def get_relevance_score(query, item):
    """Calculate relevance score (lower = more relevant).

    Score 0: Exact match (title or snippet contains full search query)
    Score 1: Partial match (title or snippet contains some keywords)
    Score 2: No match in title/snippet
    """
    query_lower = query.lower()
    title = (item.get('title', '') or '').lower()
    snippet = (item.get('snippet', '') or '').lower()

    if query_lower in title or query_lower in snippet:
        return 0

    # Chinese 2-char segments
    cn_chars = re.findall(r'[\u4e00-\u9fff]+', query)
    cn_segments = []
    for seg in cn_chars:
        if len(seg) >= 2:
            cn_segments.extend(seg[i:i+2] for i in range(len(seg) - 1))

    query_words = [w for w in query_lower.split() if len(w) > 1]
    all_units = list(dict.fromkeys(query_words + cn_segments))

    for unit in all_units:
        if unit in title or unit in snippet:
            return 1

    return 2


def do_search(query, site=None, time_range="", sort_by=""):
    """V10: Fast search using Bing + DuckDuckGo (no uapis.cn).

    Strategy:
    1. Check cache (5-minute expiry)
    2. Search Bing for each of 9 platforms + general (10 parallel requests, ~2s each)
    3. Search DuckDuckGo for each of 9 platforms (9 parallel requests, supplement)
    4. Aggregate and deduplicate
    5. Sort by relevance
    """
    print(f"\n  === V10 Fast Search: {query} ===")
    if time_range:
        print(f"  Time range: {time_range}")

    # Check cache first (5-minute cache for repeated searches)
    cached = check_search_cache(query, time_range, sort_by)
    if cached:
        filepath = os.path.join(DATA_DIR, "search-results.json")
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(cached, f, ensure_ascii=False, indent=2)
        print(f"  Using cached results: {cached['count']} items")
        return cached['count']

    all_items = []
    seen_urls = set()

    # Determine which platforms to search
    if site:
        platforms_to_search = [s.strip() for s in site.split(",")]
    else:
        platforms_to_search = list(PLATFORM_SITES.keys())

    print(f"\n  Step 1: Bing + DuckDuckGo parallel search ({len(platforms_to_search)} platforms)...")
    print(f"  Estimated time: ~3-5 seconds (all parallel)")

    def search_one_platform(platform_name):
        """Search one platform using Bing (primary) + DuckDuckGo (secondary)."""
        if platform_name not in PLATFORM_SITES:
            return platform_name, []

        site_domain = PLATFORM_SITES[platform_name]
        results = []

        # Bing search (primary, 20 results)
        try:
            bing_results = search_bing_site(query, site_domain, max_results=20)
            results.extend(bing_results)
        except Exception as e:
            print(f"  Bing error for {platform_name}: {e}")

        # DuckDuckGo search (secondary, 10 results)
        try:
            ddg_results = search_duckduckgo_site(query, site_domain, max_results=10)
            results.extend(ddg_results)
        except Exception as e:
            print(f"  DuckDuckGo error for {platform_name}: {e}")

        return platform_name, results

    # Run all platform searches in parallel (Bing + DuckDuckGo for each)
    with ThreadPoolExecutor(max_workers=min(len(platforms_to_search) * 2, 18)) as executor:
        futures = {executor.submit(search_one_platform, p): p for p in platforms_to_search}

        for future in as_completed(futures):
            platform_name, p_results = future.result()
            added = 0
            for item in p_results:
                url = item.get('url', '')
                if url and url not in seen_urls and len(all_items) < 300:
                    seen_urls.add(url)
                    all_items.append(item)
                    added += 1
            print(f"  [{platform_name}] Added {added} results (total: {len(all_items)})")

    print(f"\n  After platform search: {len(all_items)} unique results")

    # General Bing search (no site: operator) - get results from other sources
    if not site and len(all_items) < 300:
        print(f"\n  Step 2: General Bing search...")
        try:
            general_results = search_bing_general(query, max_results=20)
            added = 0
            for item in general_results:
                url = item.get('url', '')
                if url and url not in seen_urls and len(all_items) < 300:
                    seen_urls.add(url)
                    all_items.append(item)
                    added += 1
            print(f"  [general] Added {added} results (total: {len(all_items)})")
        except Exception as e:
            print(f"  General search error: {e}")

    # Step 3: Sort by relevance (exact match first), then by date
    print(f"\n  Step 3: Sorting {len(all_items)} results by relevance...")
    all_items.sort(key=lambda x: (get_relevance_score(query, x), -parse_date(x.get("date", ""))))

    # Log sorting results
    score_counts = {0: 0, 1: 0, 2: 0}
    for item in all_items:
        score = get_relevance_score(query, item)
        score_counts[score] = score_counts.get(score, 0) + 1

    print(f"  Sorting complete:")
    print(f"    - Exact match (score 0): {score_counts[0]} results")
    print(f"    - Partial match (score 1): {score_counts[1]} results")
    print(f"    - No match in title/snippet (score 2): {score_counts[2]} results")

    # Step 4: Save results
    print(f"\n  Step 4: Saving {len(all_items)} results...")
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    data = {
        "query": query,
        "time_range": time_range,
        "sort": sort_by,
        "update_time": now,
        "count": len(all_items),
        "results": all_items[:300],
        "search_sources": ["Bing", "DuckDuckGo"],
        "platforms_searched": list(PLATFORM_SITES.keys())
    }

    filepath = os.path.join(DATA_DIR, "search-results.json")
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"  Search complete: {len(all_items)} results saved")

    # Save to cache (5-minute expiry)
    save_search_cache(query, time_range, sort_by, all_items[:300], len(all_items))

    return len(all_items)


def parse_date(date_str):
    """Parse various date formats to timestamp for sorting."""
    if not date_str:
        return 0
    try:
        import datetime
        for fmt in ["%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"]:
            try:
                return datetime.datetime.strptime(date_str, fmt).timestamp() * 1000
            except:
                pass
        if date_str.isdigit():
            ts = int(date_str)
            if ts > 1e12:
                return ts
            return ts * 1000
    except:
        pass
    return 0


def fetch_uapis(platform_type):
    """Fetch hot list from uapis.cn."""
    url = f"https://uapis.cn/api/v1/misc/hotboard?type={platform_type}"
    data = fetch_url(url)
    data = json.loads(data.decode("utf-8"))
    raw_list = data.get("list", [])
    items = []
    for item in raw_list:
        items.append({
            "title": item.get("title", ""),
            "url": item.get("url", ""),
            "hot_value": str(item.get("hot_value", "")),
            "index": item.get("index", len(items) + 1),
        })
    return items


def run_hot_update():
    """Fetch hot lists from all platforms."""
    PLATFORMS = [
        ("weibo", "weibo热搜"),
        ("zhihu", "知乎热榜"),
        ("douyin", "抖音热搜"),
        ("bilibili", "B站热搜"),
        ("xiaohongshu", "小红书热搜"),
        ("kuaishou", "快手热搜"),
        ("baidu", "百度热搜"),
        ("toutiao", "今日头条"),
        ("thepaper", "澎湃新闻"),
    ]

    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    meta = {"update_time": now, "platforms": []}
    success_count = 0
    fail_count = 0

    for platform_type, name in PLATFORMS:
        try:
            print(f"  Fetching {name}...", end=" ", flush=True)
            items = fetch_uapis(platform_type)
            items = items[:30]

            data = {
                "platform": platform_type,
                "name": name,
                "update_time": now,
                "count": len(items),
                "list": items,
            }

            filepath = os.path.join(DATA_DIR, f"hot-{platform_type}.json")
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)

            meta["platforms"].append({
                "type": platform_type,
                "name": name,
                "count": len(items),
            })

            print(f"OK ({len(items)} items)")
            success_count += 1

        except Exception as e:
            print(f"FAILED ({e})")
            meta["platforms"].append({
                "type": platform_type,
                "name": name,
                "count": 0,
                "error": str(e),
            })
            fail_count += 1

        time.sleep(1.5)

    meta_path = os.path.join(DATA_DIR, "meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print(f"\n{'='*50}")
    print(f"Done! {success_count} ok, {fail_count} failed")
    print(f"Updated at: {now}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--search", type=str, default="", help="Search query")
    parser.add_argument("--site", type=str, default="", help="Search within site (comma-separated)")
    parser.add_argument("--time-range", type=str, default="", help="Time range filter")
    parser.add_argument("--sort", type=str, default="", help="Sort order")
    args = parser.parse_args()

    os.makedirs(DATA_DIR, exist_ok=True)

    if args.search:
        do_search(args.search, args.site or None, args.time_range, args.sort)
        if not os.environ.get("SEARCH_ONLY"):
            run_hot_update()
    else:
        run_hot_update()


if __name__ == "__main__":
    main()
