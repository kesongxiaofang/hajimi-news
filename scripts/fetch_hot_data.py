#!/usr/bin/env python3
"""
Enhanced search script with multiple free search sources.
Combines results from uapis.cn, DuckDuckGo, and Wikipedia to get more results.

Strategy:
1. Try uapis.cn first (primary source)
2. If results < 50, try DuckDuckGo HTML API
3. If still < 50, try Wikipedia API
4. Aggregate and deduplicate all results
"""

import argparse
import json
import os
import time
import urllib.request
import urllib.error
import re
from datetime import datetime, timedelta

# Platforms to fetch (all via uapis.cn)
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

# Resolve data directory (repo_root/data)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(REPO_ROOT, "data")

UAPIS_BASE = "https://uapis.cn/api/v1/misc/hotboard"
UAPIS_SEARCH = "https://uapis.cn/api/v1/search/aggregate"

# Cache settings
CACHE_FILE = os.path.join(DATA_DIR, "search-cache.json")
CACHE_DURATION = 86400  # 24 hours in seconds (longer cache to avoid rate limits)


def fetch_url(url, timeout=10, headers=None):
    """Fetch URL and return response as bytes."""
    if headers is None:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json, text/html, */*",
        }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def fetch_post(url, data, timeout=8):
    """POST JSON to URL and get response."""
    payload = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Content-Type": "application/json",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def search_uapis(query, site=None, time_range="", max_results=100):
    """Search via uapis.cn API."""
    print(f"    [uapis.cn] Searching for '{query}'...")
    try:
        payload = {"query": query}
        if site:
            payload["site"] = site
        if time_range:
            payload["time_range"] = time_range
        
        result = fetch_post(UAPIS_SEARCH, payload, timeout=15)
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
        
    except urllib.error.HTTPError as e:
        if e.code == 429:
            print(f"    [uapis.cn] Rate limited (429)")
        else:
            print(f"    [uapis.cn] HTTP Error {e.code}")
        return []
    except Exception as e:
        print(f"    [uapis.cn] Error: {e}")
        return []


def search_duckduckgo(query, max_results=50):
    """Search via DuckDuckGo HTML API (no API key required)."""
    print(f"    [DuckDuckGo] Searching for '{query}'...")
    try:
        url = f'https://html.duckduckgo.com/html/?q={urllib.request.quote(query)}&kl=wt-wt'
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        
        html = fetch_url(url, timeout=15, headers=headers).decode('utf-8')
        
        # Parse DuckDuckGo HTML results
        # Results are in <div class="result__body">
        results = []
        
        # Extract result blocks
        # Pattern: <div class="result__body">...</div>
        result_blocks = re.findall(r'<div class="result__body">(.*?)</div>\s*</div>', html, re.DOTALL)
        
        for block in result_blocks[:max_results]:
            # Extract title and URL
            title_match = re.search(r'<a[^>]*class="result__a"[^>]*>([^<]*)</a>', block)
            url_match = re.search(r'<a[^>]*class="result__a"[^>]*href="([^"]*)"', block)
            snippet_match = re.search(r'<a[^>]*class="result__snippet"[^>]*>([^<]*)</a>', block)
            
            if title_match and url_match:
                title = title_match.group(1).strip()
                url = url_match.group(1).strip()
                
                # Decode DuckDuckGo redirect URLs
                if url.startswith('//duckduckgo.com/l/?'):
                    # Extract actual URL from redirect
                    actual_url_match = re.search(r'uddg=(.*?)&', url)
                    if actual_url_match:
                        url = urllib.request.unquote(actual_url_match.group(1))
                
                snippet = snippet_match.group(1).strip() if snippet_match else ""
                
                results.append({
                    "title": title,
                    "url": url,
                    "snippet": snippet[:300],
                    "source": "duckduckgo",
                    "date": "",
                    "search_source": "DuckDuckGo"
                })
        
        print(f"    [DuckDuckGo] Found {len(results)} results")
        return results
        
    except Exception as e:
        print(f"    [DuckDuckGo] Error: {e}")
        return []


def search_wikipedia(query, max_results=50):
    """Search via Wikipedia API (no API key required)."""
    print(f"    [Wikipedia] Searching for '{query}'...")
    try:
        # Search Wikipedia
        url = f'https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={urllib.request.quote(query)}&srlimit={max_results}&format=json'
        headers = {
            'User-Agent': 'HajimiNews/1.0 (educational project; contact: example@example.com)'
        }
        
        data = json.loads(fetch_url(url, timeout=15, headers=headers).decode('utf-8'))
        search_results = data.get('query', {}).get('search', [])
        
        results = []
        for item in search_results:
            title = item['title']
            results.append({
                "title": title,
                "url": f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}",
                "snippet": re.sub(r'<[^>]+>', '', item.get('snippet', ''))[:300],
                "source": "wikipedia",
                "date": "",
                "search_source": "Wikipedia"
            })
        
        print(f"    [Wikipedia] Found {len(results)} results")
        return results
        
    except Exception as e:
        print(f"    [Wikipedia] Error: {e}")
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
        
        # Check if cache is still valid (within CACHE_DURATION)
        update_time = cache.get("update_time", "")
        if update_time:
            try:
                update_dt = datetime.strptime(update_time, "%Y-%m-%dT%H:%M:%SZ")
                age = (datetime.utcnow() - update_dt).total_seconds()
                if age > CACHE_DURATION:
                    print(f"  Cache expired ({age:.0f}s old, max {CACHE_DURATION}s)")
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
    """Multi-source search aggregation.
    
    Strategy:
    1. Check cache first
    2. Search uapis.cn (primary)
    3. If results < 50, search DuckDuckGo
    4. If still < 50, search Wikipedia
    5. Aggregate and deduplicate
    """
    print(f"\n  Multi-source search: {query}")
    if time_range:
        print(f"  Time range: {time_range}")
    
    # Check cache first
    cached = check_search_cache(query, time_range, sort_by)
    if cached:
        # Save cached results to search-results.json
        filepath = os.path.join(DATA_DIR, "search-results.json")
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(cached, f, ensure_ascii=False, indent=2)
        print(f"  Using cached results: {cached['count']} items")
        return cached['count']
    
    all_items = []
    seen_urls = set()
    
    # Strategy 1: Search uapis.cn
    print(f"\n  Step 1: Searching uapis.cn...")
    uapis_results = search_uapis(query, site, time_range)
    for item in uapis_results:
        url = item.get('url', '')
        if url and url not in seen_urls:
            seen_urls.add(url)
            all_items.append(item)
    
    print(f"  After uapis.cn: {len(all_items)} unique results")
    
    # Strategy 2: If results < 50, try DuckDuckGo
    if len(all_items) < 50:
        print(f"\n  Step 2: Searching DuckDuckGo (current: {len(all_items)} results)...")
        time.sleep(2)  # Be polite
        ddg_results = search_duckduckgo(query, max_results=50)
        for item in ddg_results:
            url = item.get('url', '')
            if url and url not in seen_urls:
                seen_urls.add(url)
                all_items.append(item)
        
        print(f"  After DuckDuckGo: {len(all_items)} unique results")
    
    # Strategy 3: If still < 50, try Wikipedia
    if len(all_items) < 50:
        print(f"\n  Step 3: Searching Wikipedia (current: {len(all_items)} results)...")
        time.sleep(2)  # Be polite
        wiki_results = search_wikipedia(query, max_results=50)
        for item in wiki_results:
            url = item.get('url', '')
            if url and url not in seen_urls:
                seen_urls.add(url)
                all_items.append(item)
        
        print(f"  After Wikipedia: {len(all_items)} unique results")
    
    print(f"\n  Total: {len(all_items)} unique results from {len(seen_urls)} URLs")
    
    # Sort by date (newest first)
    all_items.sort(key=lambda x: parse_date(x.get("date", "")), reverse=True)
    
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    data = {
        "query": query,
        "time_range": time_range,
        "sort": sort_by,
        "update_time": now,
        "count": len(all_items),
        "results": all_items[:300],  # Cap at 300 results (increased from 200)
        "search_sources": ["uapis.cn", "DuckDuckGo", "Wikipedia"]
    }
    
    filepath = os.path.join(DATA_DIR, "search-results.json")
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"  Search done: {len(all_items)} results saved (deduplicated)")
    
    # Save to cache
    save_search_cache(query, time_range, sort_by, all_items[:300], len(all_items))
    
    return len(all_items)


def parse_date(date_str):
    """Parse various date formats to timestamp for sorting."""
    if not date_str:
        return 0
    try:
        import datetime
        # Handle various formats
        for fmt in ["%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"]:
            try:
                return datetime.datetime.strptime(date_str, fmt).timestamp() * 1000
            except:
                pass
        # Try timestamp
        if date_str.isdigit():
            ts = int(date_str)
            if ts > 1e12:  # milliseconds
                return ts
            return ts * 1000  # seconds to milliseconds
    except:
        pass
    return 0


def fetch_uapis(platform_type):
    """Fetch hot list from uapis.cn."""
    url = f"{UAPIS_BASE}?type={platform_type}"
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
    for p in meta["platforms"]:
        status = "OK" if p["count"] > 0 else "FAIL"
        print(f"  [{status}] {p['name']}: {p['count']} items")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--search", type=str, default="", help="Search query")
    parser.add_argument("--site", type=str, default="", help="Search within site")
    parser.add_argument("--time-range", type=str, default="", help="Time range filter")
    parser.add_argument("--sort", type=str, default="", help="Sort order")
    args = parser.parse_args()

    os.makedirs(DATA_DIR, exist_ok=True)

    # If search mode
    if args.search:
        do_search(args.search, args.site or None, args.time_range, args.sort)
        # Still update hot data afterwards (for regular interval runs)
        if not os.environ.get("SEARCH_ONLY"):
            run_hot_update()
    else:
        run_hot_update()


if __name__ == "__main__":
    main()
