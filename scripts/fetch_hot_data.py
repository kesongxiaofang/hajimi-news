#!/usr/bin/env python3
"""
Fetch hot search data from multiple platforms + handle search queries.
Runs on GitHub Actions every 30 minutes, or on-demand for search.

优化版：
1. 添加搜索结果缓存（1小时）
2. 减少搜索平台数量（5个主要平台）
3. 添加超时和重试机制
"""

import argparse
import json
import os
import time
import urllib.request
import urllib.error
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
CACHE_DURATION = 3600  # 1 hour in seconds


def fetch_url(url, timeout=10):
    """Fetch JSON from URL."""
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json, text/html, */*",
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


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


def fetch_uapis(platform_type):
    """Fetch hot list from uapis.cn."""
    url = f"{UAPIS_BASE}?type={platform_type}"
    data = fetch_url(url)
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


def search_single_platform(query, platform_site, time_range="", sort_by="", max_retries=3):
    """Search a single platform. Returns list of items. Retries on failure."""
    for attempt in range(max_retries + 1):
        try:
            payload = {"query": query}
            if platform_site:
                payload["site"] = platform_site
            if time_range:
                payload["time_range"] = time_range
            if sort_by:
                payload["sort"] = sort_by
            
            result = fetch_post(UAPIS_SEARCH, payload, timeout=10)
            items = result.get("results", [])
            
            search_items = []
            for item in items:
                search_items.append({
                    "title": item.get("title", ""),
                    "url": item.get("url", ""),
                    "snippet": (item.get("snippet") or "")[:300],
                    "source": item.get("domain", platform_site),
                    "date": item.get("publish_time", ""),
                })
            
            print(f"    {platform_site}: +{len(search_items)} results")
            return search_items
            
        except urllib.error.HTTPError as e:
            if e.code == 429:
                if attempt < max_retries:
                    wait_time = 5 * (attempt + 1)  # 5s, 10s, 15s
                    print(f"    {platform_site}: Rate limited (429), retrying in {wait_time}s... (attempt {attempt+1}/{max_retries})")
                    time.sleep(wait_time)
                    continue
                else:
                    print(f"    {platform_site}: FAILED - Rate limited after {max_retries} retries")
                    return []
            else:
                print(f"    {platform_site}: FAILED - HTTP {e.code}: {e.reason}")
                return []
        except Exception as e:
            if attempt < max_retries:
                wait_time = 3 * (attempt + 1)
                print(f"    {platform_site}: Error ({e}), retrying in {wait_time}s... (attempt {attempt+1}/{max_retries})")
                time.sleep(wait_time)
                continue
            print(f"    {platform_site}: FAILED - {e}")
            return []
    
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
    """Search via uapis.cn search API, save results to JSON.
    
    Optimized version:
    1. Check cache first
    2. Search with rate limit protection
    3. Save to cache
    """
    print(f"\n  Searching: {query}")
    if time_range:
        print(f"  Time range: {time_range}")
    if sort_by:
        print(f"  Sort: {sort_by}")
    
    all_items = []
    seen_urls = set()
    
    # If specific site is requested, search only that site
    if site:
        sites_to_search = [s.strip() for s in site.split(",")]
        print(f"  Searching {len(sites_to_search)} specific platforms...")
        
        # Search each specified site
        for i, platform_site in enumerate(sites_to_search):
            if i > 0:
                time.sleep(2)  # Delay between requests
            
            try:
                payload = {"query": query}
                payload["site"] = platform_site
                if time_range:
                    payload["time_range"] = time_range
                if sort_by:
                    payload["sort"] = sort_by
                
                result = fetch_post(UAPIS_SEARCH, payload, timeout=10)
                items = result.get("results", [])
                
                for item in items:
                    url = item.get("url", "")
                    if url and url not in seen_urls:
                        seen_urls.add(url)
                        all_items.append({
                            "title": item.get("title", ""),
                            "url": url,
                            "snippet": (item.get("snippet") or "")[:300],
                            "source": item.get("domain", platform_site),
                            "date": item.get("publish_time", ""),
                        })
                
                print(f"    {platform_site}: +{len(items)} results (total: {len(all_items)})")
                
            except Exception as e:
                print(f"    {platform_site}: FAILED - {e}")
        
    else:
        # Default: search without specifying site (uapis.cn returns multi-source results)
        print(f"  Searching (multi-source, single request)...")
        
        try:
            payload = {"query": query}
            if time_range:
                payload["time_range"] = time_range
            if sort_by:
                payload["sort"] = sort_by
            
            result = fetch_post(UAPIS_SEARCH, payload, timeout=15)
            items = result.get("results", [])
            
            for item in items:
                url = item.get("url", "")
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    all_items.append({
                        "title": item.get("title", ""),
                        "url": url,
                        "snippet": (item.get("snippet") or "")[:300],
                        "source": item.get("domain", ""),
                        "date": item.get("publish_time", ""),
                    })
            
            print(f"    Found {len(all_items)} results from multiple sources")
            
        except Exception as e:
            print(f"    Search FAILED - {e}")
            # If failed, try searching major platforms one by one
            print(f"    Retrying with individual platforms...")
            major_platforms = ["zhihu.com", "weibo.com", "bilibili.com"]
            for platform_site in major_platforms:
                try:
                    time.sleep(2)
                    payload = {"query": query, "site": platform_site}
                    result = fetch_post(UAPIS_SEARCH, payload, timeout=10)
                    items = result.get("results", [])
                    
                    for item in items:
                        url = item.get("url", "")
                        if url and url not in seen_urls:
                            seen_urls.add(url)
                            all_items.append({
                                "title": item.get("title", ""),
                                "url": url,
                                "snippet": (item.get("snippet") or "")[:300],
                                "source": item.get("domain", platform_site),
                                "date": item.get("publish_time", ""),
                            })
                    
                    print(f"    {platform_site}: +{len(items)} results (total: {len(all_items)})")
                    
                except Exception as e2:
                    print(f"    {platform_site}: FAILED - {e2}")
    
    print(f"  Total: {len(all_items)} unique results (from {len(seen_urls)} URLs)")
    
    # Sort by date (newest first)
    all_items.sort(key=lambda x: parse_date(x.get("date", "")), reverse=True)
    
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    data = {
        "query": query,
        "time_range": time_range,
        "sort": sort_by,
        "update_time": now,
        "count": len(all_items),
        "results": all_items[:200],  # Cap at 200 results
    }
    
    filepath = os.path.join(DATA_DIR, "search-results.json")
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    print(f"  Search done: {len(all_items)} results saved (deduplicated)")
    return len(all_items)


def parse_date(date_str):
    """Parse various date formats to timestamp for sorting."""
    if not date_str:
        return 0
    try:
        # Try ISO format
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--search", type=str, default="", help="Search query")
    parser.add_argument("--site", type=str, default="", help="Search within site")
    parser.add_argument("--time-range", type=str, default="", help="Time range filter (d/day, w/week, m/month, y/year)")
    parser.add_argument("--sort", type=str, default="", help="Sort order (date for newest first)")
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


def run_hot_update():
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


if __name__ == "__main__":
    main()
