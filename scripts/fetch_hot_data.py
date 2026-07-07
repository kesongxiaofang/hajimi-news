#!/usr/bin/env python3
"""
V10.1: Fast multi-source search using Bing + DuckDuckGo + uapis.cn (parallel).

Strategy:
1. Search Bing site: for each of 9 platforms + general (parallel)
2. Search DuckDuckGo site: for each platform (parallel)
3. Search uapis.cn general (parallel, as fallback/supplement)
4. Aggregate and deduplicate
5. Sort by relevance

All sources run in parallel. Bing/DuckDuckGo are fast (~2-5s),
uapis.cn is slow (~30s) but provides additional results.
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
from urllib.parse import urlparse

# Platform site mappings
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

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(REPO_ROOT, "data")

UAPIS_SEARCH = "https://uapis.cn/api/v1/search/aggregate"

CACHE_FILE = os.path.join(DATA_DIR, "search-cache.json")
CACHE_DURATION = 300  # 5 minutes
CACHE_VERSION = "v10.1"


def fetch_url(url, timeout=10, headers=None, data=None):
    """Fetch URL and return response as bytes."""
    if headers is None:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        }
    req = urllib.request.Request(url, headers=headers, data=data)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


# ============================================================
# Bing HTML parsing (robust, handles multiple HTML structures)
# ============================================================

BING_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
}

def parse_bing_html(html, site_domain=None, max_results=20):
    """Parse Bing HTML results with robust position-based extraction."""
    results = []
    
    # Find all <li class="b_algo"> positions for block extraction
    algo_starts = [m.start() for m in re.finditer(r'<li class="b_algo"', html)]
    
    if not algo_starts:
        # Fallback: try alternative patterns
        algo_starts = [m.start() for m in re.finditer(r'<li class="b_algo ', html)]
    
    for i, start in enumerate(algo_starts):
        if len(results) >= max_results:
            break
        
        # Extract block: from this <li> to the next <li> or end
        end = algo_starts[i + 1] if i + 1 < len(algo_starts) else len(html)
        # Also try to find </ol> as end marker
        ol_end = html.find('</ol>', start)
        if ol_end > 0 and ol_end < end:
            end = ol_end
        block = html[start:end]
        
        title = ""
        url = ""
        
        # Method 1: Look for <h2> tag with <a> inside
        h2_match = re.search(r'<h2[^>]*>(.*?)</h2>', block, re.DOTALL)
        if h2_match:
            h2_content = h2_match.group(1)
            # Find <a> with http href inside h2
            a_match = re.search(r'<a[^>]*href="(https?://[^"]*)"[^>]*>(.*?)</a>', h2_content, re.DOTALL)
            if a_match:
                url = a_match.group(1)
                title = re.sub(r'<[^>]+>', '', a_match.group(2)).strip()
        
        # Method 2: Fallback - find any <a> with http href and meaningful text
        if not url:
            for a_match in re.finditer(r'<a[^>]*href="(https?://[^"]*)"[^>]*>(.*?)</a>', block, re.DOTALL):
                href = a_match.group(1)
                text = re.sub(r'<[^>]+>', '', a_match.group(2)).strip()
                # Skip CSS, JS, Bing internal links, and short text
                if href.endswith('.css') or href.endswith('.js'):
                    continue
                if 'bing.com' in href or 'microsoft.com' in href or 'go.microsoft' in href:
                    continue
                if not text or len(text) < 3:
                    continue
                url = href
                title = text
                break
        
        if not url or not title:
            continue
        
        # Skip Bing-internal URLs
        if 'bing.com' in url or 'microsoft.com' in url:
            continue
        
        # Extract snippet
        snippet = ""
        # Try b_caption
        cap_match = re.search(r'<div class="b_caption"[^>]*>(.*?)</div>', block, re.DOTALL)
        if cap_match:
            snippet = re.sub(r'<[^>]+>', '', cap_match.group(1)).strip()
        # Try b_lineclamp
        if not snippet:
            line_match = re.search(r'<p class="b_lineclamp[^"]*"[^>]*>(.*?)</p>', block, re.DOTALL)
            if line_match:
                snippet = re.sub(r'<[^>]+>', '', line_match.group(1)).strip()
        # Try any <p> tag
        if not snippet:
            p_match = re.search(r'<p[^>]*>(.*?)</p>', block, re.DOTALL)
            if p_match:
                snippet = re.sub(r'<[^>]+>', '', p_match.group(1)).strip()
        
        # Determine source domain
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        if domain.startswith("www."):
            domain = domain[4:]
        
        results.append({
            "title": title,
            "url": url,
            "snippet": snippet[:300],
            "source": site_domain if site_domain else domain,
            "date": "",
            "search_source": "Bing"
        })
    
    return results


def search_bing_site(query, site_domain, max_results=20):
    """Search via Bing with site: operator."""
    print(f"    [Bing] site:{site_domain} '{query}'...")
    try:
        site_query = f"site:{site_domain} {query}"
        url = f'https://www.bing.com/search?q={urllib.parse.quote(site_query)}&count={max_results}&setmkt=zh-CN&setlang=zh-CN'
        html = fetch_url(url, timeout=15, headers=BING_HEADERS).decode('utf-8', errors='ignore')
        results = parse_bing_html(html, site_domain=site_domain, max_results=max_results)
        print(f"    [Bing] Found {len(results)} from {site_domain}")
        return results
    except Exception as e:
        print(f"    [Bing] Error for {site_domain}: {e}")
        return []


def search_bing_general(query, max_results=20):
    """Search via Bing without site: operator."""
    print(f"    [Bing] General '{query}'...")
    try:
        url = f'https://www.bing.com/search?q={urllib.parse.quote(query)}&count={max_results}&setmkt=zh-CN&setlang=zh-CN'
        html = fetch_url(url, timeout=15, headers=BING_HEADERS).decode('utf-8', errors='ignore')
        results = parse_bing_html(html, site_domain=None, max_results=max_results)
        print(f"    [Bing] Found {len(results)} general results")
        return results
    except Exception as e:
        print(f"    [Bing] General error: {e}")
        return []


# ============================================================
# DuckDuckGo HTML parsing (robust)
# ============================================================

def parse_duckduckgo_html(html, site_domain, max_results=10):
    """Parse DuckDuckGo HTML results."""
    results = []
    
    # Find all result blocks
    # DuckDuckGo uses <div class="result__body"> or similar
    result_starts = [m.start() for m in re.finditer(r'class="result__body"', html)]
    
    for i, start in enumerate(result_starts):
        if len(results) >= max_results:
            break
        
        # Extract block
        block_start = html.rfind('<div', 0, start)
        end = result_starts[i + 1] if i + 1 < len(result_starts) else len(html)
        block = html[block_start:end]
        
        # Find title and URL
        title = ""
        url = ""
        
        # Look for result__a link
        a_match = re.search(r'<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)</a>', block, re.DOTALL)
        if not a_match:
            a_match = re.search(r'<a[^>]*class="result-link"[^>]*href="([^"]*)"[^>]*>(.*?)</a>', block, re.DOTALL)
        if not a_match:
            # Fallback: any <a> with http href
            a_match = re.search(r'<a[^>]*href="(https?://[^"]*)"[^>]*>(.*?)</a>', block, re.DOTALL)
        
        if a_match:
            url = a_match.group(1)
            title = re.sub(r'<[^>]+>', '', a_match.group(2)).strip()
            
            # Decode DuckDuckGo redirect URLs
            if 'duckduckgo.com/l/' in url:
                uddg_match = re.search(r'uddg=([^&]*)', url)
                if uddg_match:
                    url = urllib.parse.unquote(uddg_match.group(1))
        
        if not url or not title:
            continue
        if not url.startswith('http'):
            continue
        
        # Extract snippet
        snippet = ""
        sn_match = re.search(r'class="result__snippet"[^>]*>(.*?)</a>', block, re.DOTALL)
        if not sn_match:
            sn_match = re.search(r'class="result__snippet"[^>]*>(.*?)</div>', block, re.DOTALL)
        if sn_match:
            snippet = re.sub(r'<[^>]+>', '', sn_match.group(1)).strip()
        
        results.append({
            "title": title,
            "url": url,
            "snippet": snippet[:300],
            "source": site_domain,
            "date": "",
            "search_source": "DuckDuckGo"
        })
    
    return results


def search_duckduckgo_site(query, site_domain, max_results=10):
    """Search via DuckDuckGo with site: operator."""
    print(f"    [DDG] site:{site_domain} '{query}'...")
    try:
        site_query = f"site:{site_domain} {query}"
        url = f'https://html.duckduckgo.com/html/?q={urllib.parse.quote(site_query)}&kl=wt-wt'
        html = fetch_url(url, timeout=15, headers=BING_HEADERS).decode('utf-8', errors='ignore')
        results = parse_duckduckgo_html(html, site_domain, max_results)
        print(f"    [DDG] Found {len(results)} from {site_domain}")
        return results
    except Exception as e:
        print(f"    [DDG] Error for {site_domain}: {e}")
        return []


# ============================================================
# uapis.cn search (slow but reliable fallback)
# ============================================================

def search_uapis(query, site=None, time_range="", max_results=100):
    """Search via uapis.cn API (slow ~30s, but provides additional results)."""
    print(f"    [uapis.cn] Searching '{query}'...")
    try:
        payload = {"query": query}
        if site:
            payload["site"] = site
        if time_range:
            payload["time_range"] = time_range
        
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            UAPIS_SEARCH,
            data=data,
            headers={
                "User-Agent": "Mozilla/5.0",
                "Content-Type": "application/json",
            }
        )
        with urllib.request.urlopen(req, timeout=45) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        
        items = result.get("results", [])
        search_items = []
        for item in items:
            search_items.append({
                "title": item.get("title", ""),
                "url": item.get("url", ""),
                "snippet": (item.get("snippet") or "")[:300],
                "source": item.get("domain", "unknown"),
                "date": item.get("publish_time", ""),
                "search_source": "uapis.cn"
            })
        
        print(f"    [uapis.cn] Found {len(search_items)} results")
        return search_items
    except Exception as e:
        print(f"    [uapis.cn] Error: {e}")
        return []


# ============================================================
# Cache
# ============================================================

def check_search_cache(query, time_range="", sort_by=""):
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
            return None
        update_time = cache.get("update_time", "")
        if update_time:
            try:
                update_dt = datetime.strptime(update_time, "%Y-%m-%dT%H:%M:%SZ")
                age = (datetime.utcnow() - update_dt).total_seconds()
                if age > CACHE_DURATION:
                    return None
            except:
                return None
        print(f"  Cache hit! {cache.get('count', 0)} results")
        return cache
    except Exception as e:
        print(f"  Cache check failed: {e}")
        return None


def save_search_cache(query, time_range, sort_by, results, count):
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


# ============================================================
# Relevance scoring
# ============================================================

def get_relevance_score(query, item):
    query_lower = query.lower()
    title = (item.get('title', '') or '').lower()
    snippet = (item.get('snippet', '') or '').lower()
    
    if query_lower in title or query_lower in snippet:
        return 0
    
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


# ============================================================
# Main search function
# ============================================================

def do_search(query, site=None, time_range="", sort_by=""):
    """V10.1: Parallel multi-source search.
    
    Runs Bing (fast), DuckDuckGo (fast), and uapis.cn (slow) all in parallel.
    Results are combined as they arrive.
    """
    print(f"\n  === V10.1 Parallel Search: {query} ===")
    
    # Check cache
    cached = check_search_cache(query, time_range, sort_by)
    if cached:
        filepath = os.path.join(DATA_DIR, "search-results.json")
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(cached, f, ensure_ascii=False, indent=2)
        print(f"  Using cached results: {cached['count']} items")
        return cached['count']

    all_items = []
    seen_urls = set()

    if site:
        platforms_to_search = [s.strip() for s in site.split(",")]
    else:
        platforms_to_search = list(PLATFORM_SITES.keys())

    # Build all search tasks
    search_tasks = []
    
    # Bing site: search for each platform
    for p in platforms_to_search:
        if p in PLATFORM_SITES:
            search_tasks.append(("bing_site", p, PLATFORM_SITES[p]))
    
    # Bing general search
    search_tasks.append(("bing_general", None, None))
    
    # DuckDuckGo site: search for each platform
    for p in platforms_to_search:
        if p in PLATFORM_SITES:
            search_tasks.append(("ddg_site", p, PLATFORM_SITES[p]))
    
    # uapis.cn general search (slow, but parallel)
    search_tasks.append(("uapis_general", None, None))
    
    print(f"\n  Running {len(search_tasks)} searches in parallel...")
    print(f"  (Bing+DDG ~5s, uapis.cn ~30s - all parallel)")

    def run_search_task(task):
        task_type, platform_name, site_domain = task
        
        if task_type == "bing_site":
            results = search_bing_site(query, site_domain, max_results=20)
            return platform_name, "bing", results
        elif task_type == "bing_general":
            results = search_bing_general(query, max_results=20)
            return "general", "bing", results
        elif task_type == "ddg_site":
            results = search_duckduckgo_site(query, site_domain, max_results=10)
            return platform_name, "ddg", results
        elif task_type == "uapis_general":
            results = search_uapis(query, site=None, time_range=time_range)
            return "uapis", "uapis", results
        return None, None, []

    # Run ALL searches in parallel
    with ThreadPoolExecutor(max_workers=min(len(search_tasks), 20)) as executor:
        futures = {executor.submit(run_search_task, t): t for t in search_tasks}
        
        for future in as_completed(futures):
            try:
                platform_name, source_type, p_results = future.result()
                added = 0
                for item in p_results:
                    url = item.get('url', '')
                    if url and url not in seen_urls and len(all_items) < 300:
                        seen_urls.add(url)
                        all_items.append(item)
                        added += 1
                if added > 0:
                    print(f"  [{platform_name}/{source_type}] +{added} (total: {len(all_items)})")
            except Exception as e:
                print(f"  Search task error: {e}")

    print(f"\n  Total unique results: {len(all_items)}")

    # Sort by relevance
    print(f"  Sorting by relevance...")
    all_items.sort(key=lambda x: (get_relevance_score(query, x), -parse_date(x.get("date", ""))))
    
    score_counts = {0: 0, 1: 0, 2: 0}
    for item in all_items:
        score = get_relevance_score(query, item)
        score_counts[score] = score_counts.get(score, 0) + 1
    print(f"    Exact: {score_counts[0]}, Partial: {score_counts[1]}, Other: {score_counts[2]}")

    # Save results
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    data = {
        "query": query,
        "time_range": time_range,
        "sort": sort_by,
        "update_time": now,
        "count": len(all_items),
        "results": all_items[:300],
        "search_sources": ["Bing", "DuckDuckGo", "uapis.cn"],
        "platforms_searched": list(PLATFORM_SITES.keys())
    }

    filepath = os.path.join(DATA_DIR, "search-results.json")
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"  Saved {len(all_items)} results")
    save_search_cache(query, time_range, sort_by, all_items[:300], len(all_items))
    return len(all_items)


def parse_date(date_str):
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


# ============================================================
# Hot data (unchanged)
# ============================================================

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
                "type": platform_type, "name": name, "count": len(items),
            })
            print(f"OK ({len(items)} items)")
            success_count += 1
        except Exception as e:
            print(f"FAILED ({e})")
            meta["platforms"].append({
                "type": platform_type, "name": name, "count": 0, "error": str(e),
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
    parser.add_argument("--search", type=str, default="")
    parser.add_argument("--site", type=str, default="")
    parser.add_argument("--time-range", type=str, default="")
    parser.add_argument("--sort", type=str, default="")
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
