#!/usr/bin/env python3
"""
Enhanced multi-source search with site-specific scraping.

Strategy:
1. Use uapis.cn API for initial results
2. Use DuckDuckGo site: search for each platform
3. Aggregate and deduplicate
"""

import argparse
import json
import os
import time
import urllib.request
import urllib.parse
import re
from datetime import datetime

# Platform site mappings (for site: search)
PLATFORM_SITES = {
    "weibo": "weibo.com",
    "zhihu": "zhihu.com",
    "douyin": "douyin.com",
    "bilibili": "bilibili.com",
    "xiaohongshu": "xiaohongshu.com",
    "kuaishou": "kuaishou.com",
    "baidu": "baidu.com",
    "toutiao": "toutiao.com",
    "thepaper": "thepaper.cn",
}

# Reverse mapping (domain -> platform)
SITE_TO_PLATFORM = {v: k for k, v in PLATFORM_SITES.items()}

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(REPO_ROOT, "data")

UAPIS_SEARCH = "https://uapis.cn/api/v1/search/aggregate"

# Cache settings
CACHE_FILE = os.path.join(DATA_DIR, "search-cache.json")
CACHE_DURATION = 86400  # 24 hours


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


def search_uapis(query, site=None, time_range="", max_results=100):
    """Search via uapis.cn API."""
    print(f"    [uapis.cn] Searching for '{query}'...")
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
        with urllib.request.urlopen(req, timeout=15) as resp:
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


def search_duckduckgo_site(query, site_domain, max_results=30):
    """Search via DuckDuckGo HTML API with site: operator.
    
    This gets results SPECIFICALLY from the given site domain.
    """
    print(f"    [DuckDuckGo] Searching site:{site_domain} for '{query}'...")
    try:
        # Construct site: search query
        site_query = f"site:{site_domain} {query}"
        url = f'https://html.duckduckgo.com/html/?q={urllib.parse.quote(site_query)}&kl=wt-wt'
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        }
        
        html = fetch_url(url, timeout=15, headers=headers).decode('utf-8')
        
        results = []
        
        # Parse DuckDuckGo HTML results
        # Results are in <div class="result__body">
        result_pattern = r'<div class="result__body">(.*?)</div>\s*</div>'
        result_blocks = re.findall(result_pattern, html, re.DOTALL)
        
        for block in result_blocks[:max_results]:
            # Extract title and URL
            title_match = re.search(r'<a[^>]*class="result__a"[^>]*>([^<]*)</a>', block, re.DOTALL)
            url_match = re.search(r'<a[^>]*class="result__a"[^>]*href="([^"]*)"', block)
            snippet_match = re.search(r'<a[^>]*class="result__snippet"[^>]*>([^<]*)</a>', block, re.DOTALL)
            
            if title_match and url_match:
                title = re.sub(r'<[^>]+>', '', title_match.group(1)).strip()
                url = url_match.group(1).strip()
                
                # Decode DuckDuckGo redirect URLs
                if url.startswith('//duckduckgo.com/l/?'):
                    actual_url_match = re.search(r'uddg=(.*?)&', url)
                    if actual_url_match:
                        url = urllib.parse.unquote(actual_url_match.group(1))
                
                # Remove DuckDuckGo proxy URLs
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
    """Check if we have cached results for this query."""
    if not os.path.exists(CACHE_FILE):
        return None
    
    try:
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            cache = json.load(f)
        
        # Check if query matches
        if cache.get("query") != query:
            return None
        
        # Check if time_range matches
        if cache.get("time_range") != time_range:
            return None
        
        # Check if cache is still valid
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
        }
        
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache_data, f, ensure_ascii=False, indent=2)
        
        print(f"  Cache saved: {count} results")
        
    except Exception as e:
        print(f"  Cache save failed: {e}")


def do_search(query, site=None, time_range="", sort_by=""):
    """Enhanced multi-source search.
    
    Strategy:
    1. Check cache first
    2. Search uapis.cn (primary source)
    3. For each platform, search via DuckDuckGo site: operator
    4. Aggregate and deduplicate
    """
    print(f"\n  🔍 Enhanced search: {query}")
    if time_range:
        print(f"  Time range: {time_range}")
    
    # Check cache first
    cached = check_search_cache(query, time_range, sort_by)
    if cached:
        filepath = os.path.join(DATA_DIR, "search-results.json")
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(cached, f, ensure_ascii=False, indent=2)
        print(f"  Using cached results: {cached['count']} items")
        return cached['count']
    
    all_items = []
    seen_urls = set()
    
    # Step 1: Search uapis.cn
    print(f"\n  Step 1: Searching uapis.cn...")
    uapis_results = search_uapis(query, site, time_range)
    for item in uapis_results:
        url = item.get('url', '')
        if url and url not in seen_urls:
            seen_urls.add(url)
            all_items.append(item)
    
    print(f"  After uapis.cn: {len(all_items)} unique results")
    
    # Step 2: Search each platform via DuckDuckGo site: operator
    if len(all_items) < 100:  # Only if we need more results
        print(f"\n  Step 2: Searching each platform via DuckDuckGo...")
        
        # Determine which platforms to search
        if site:
            # Search only specified platform
            platforms_to_search = [s.strip() for s in site.split(",")]
        else:
            # Search all 9 platforms
            platforms_to_search = list(PLATFORM_SITES.keys())
        
        print(f"  Will search {len(platforms_to_search)} platforms...")
        
        for i, platform in enumerate(platforms_to_search):
            if platform not in PLATFORM_SITES:
                print(f"  Skipping unknown platform: {platform}")
                continue
            
            site_domain = PLATFORM_SITES[platform]
            
            # Check if we already have enough results
            if len(all_items) >= 200:
                print(f"  Already have {len(all_items)} results, skipping remaining platforms")
                break
            
            # Be polite: delay between requests
            if i > 0:
                time.sleep(3)
            
            try:
                ddg_results = search_duckduckgo_site(query, site_domain, max_results=30)
                for item in ddg_results:
                    url = item.get('url', '')
                    if url and url not in seen_urls:
                        seen_urls.add(url)
                        all_items.append(item)
                
                print(f"  Progress: {len(all_items)} total results after {platform}")
                
            except Exception as e:
                print(f"  Error searching {platform}: {e}")
                continue
        
        print(f"\n  After DuckDuckGo site: search: {len(all_items)} unique results")
    
    # Step 3: Sort by date (newest first)
    print(f"\n  Step 3: Sorting results...")
    all_items.sort(key=lambda x: parse_date(x.get("date", "")), reverse=True)
    
    # Step 4: Save results
    print(f"\n  Step 4: Saving {len(all_items)} results...")
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    data = {
        "query": query,
        "time_range": time_range,
        "sort": sort_by,
        "update_time": now,
        "count": len(all_items),
        "results": all_items[:300],  # Cap at 300 results
        "search_sources": ["uapis.cn", "DuckDuckGo"],
        "platforms_searched": list(PLATFORM_SITES.keys())
    }
    
    filepath = os.path.join(DATA_DIR, "search-results.json")
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"  ✅ Search complete: {len(all_items)} results saved")
    
    # Save to cache
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
        ("weibo", "微博热搜"),
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
