#!/usr/bin/env python3
"""
Fetch hot search data from multiple platforms via uapis.cn
and save as JSON files for GitHub Pages to serve.
"""

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


def fetch_url(url, timeout=15):
    """Fetch JSON from URL."""
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "application/json, text/html, */*",
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


def main():
    os.makedirs(DATA_DIR, exist_ok=True)

    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    meta = {"update_time": now, "platforms": []}

    success_count = 0
    fail_count = 0

    for platform_type, name in PLATFORMS:
        try:
            print(f"  Fetching {name}...", end=" ", flush=True)
            items = fetch_uapis(platform_type)

            # Keep top 30
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

        time.sleep(1.5)  # Be nice to the API

    # Save metadata
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
