#!/usr/bin/env python3
"""
Fetch hot search data from multiple platforms + handle search queries.
Runs on GitHub Actions every 30 minutes, or on-demand for search.
"""

import argparse
import json
import os
import time
import urllib.request
import urllib.error

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


def fetch_url(url, timeout=15):
    """Fetch JSON from URL."""
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json, text/html, */*",
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_post(url, data, timeout=20):
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


def do_search(query, site=None, time_range="", sort_by=""):
    """Search via uapis.cn search API, save results to JSON.
    
    Searches across multiple platforms and aggregates results.
    Each platform returns up to 25 results.
    
    Args:
        query: Search keyword
        site: Optional site restriction (comma-separated for multiple)
        time_range: Time filter (d/day, w/week, m/month, y/year)
        sort_by: Sort order (date for newest first, or empty for relevance)
    """
    print(f"\n  Searching: {query}")
    if time_range:
        print(f"  Time range: {time_range}")
    if sort_by:
        print(f"  Sort: {sort_by}")
    
    # Define 9 major platforms to search
    PLATFORM_SITES = [
        "zhihu.com",
        "weibo.com", 
        "bilibili.com",
        "xiaohongshu.com",
        "douyin.com",
        "toutiao.com",
        "thepaper.cn",
        "douban.com",
        "ifeng.com",
    ]
    
    all_items = []
    seen_urls = set()
    
    # If specific site is requested, only search that site
    if site:
        sites_to_search = [s.strip() for s in site.split(",")]
    else:
        sites_to_search = PLATFORM_SITES
    
    print(f"  Searching {len(sites_to_search)} platforms...")
    
    for platform_site in sites_to_search:
        try:
            payload = {"query": query}
            if platform_site:
                payload["site"] = platform_site
            if time_range:
                payload["time_range"] = time_range
            if sort_by:
                payload["sort"] = sort_by
            
            result = fetch_post(UAPIS_SEARCH, payload)
            items = result.get("results", [])
            
            # Deduplicate by URL
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
            time.sleep(0.5)  # Be nice to the API
            
        except Exception as e:
            print(f"    {platform_site}: FAILED - {e}")
    
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
    
    print(f"  Search done: {len(all_items)} results saved (deduplicated from {len(seen_urls)} unique URLs)")
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
