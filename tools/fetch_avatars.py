# -*- coding: utf-8 -*-
"""
下载角色头像（GameKee 的角色卡片图）到 assets/portraits/<entryId>.png

    python tools/fetch_avatars.py            # 增量下载
    python tools/fetch_avatars.py --workers 8

数据来源：GameKee 角色图鉴条目里的 icon 字段（cdnimg-v2.gamekee.com）
"""
import argparse
import concurrent.futures as cf
import json
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets", "portraits")
SRC = os.path.join(ROOT, "tools", "characters.json")

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"),
    "Accept": "image/avif,image/webp,image/png,image/*,*/*;q=0.8",
    "Referer": "https://www.gamekee.com/",
}


def fetch_one(ch):
    path = os.path.join(OUT_DIR, str(ch["entryId"]) + ".png")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return "skip", ch["name"], os.path.getsize(path)
    url = ch.get("icon") or ""
    if not url:
        return "nourl", ch["name"], 0
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=90) as r:
                data = r.read()
            if not data.startswith(b"\x89PNG"):
                return "bad", ch["name"], len(data)
            with open(path + ".part", "wb") as f:
                f.write(data)
            os.replace(path + ".part", path)
            return "ok", ch["name"], len(data)
        except urllib.error.HTTPError as e:
            last = "HTTP %s" % e.code
            if e.code == 404:
                break
            time.sleep(1.5 * (attempt + 1))
        except Exception as e:
            last = str(e)[:60]
            time.sleep(1.5 * (attempt + 1))
    return "fail:%s" % last, ch["name"], 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    chars = json.load(open(SRC, encoding="utf-8"))["characters"]
    os.makedirs(OUT_DIR, exist_ok=True)
    todo = [c for c in chars
            if not (os.path.exists(os.path.join(OUT_DIR, str(c["entryId"]) + ".png"))
                    and os.path.getsize(os.path.join(OUT_DIR, str(c["entryId"]) + ".png")) > 0)]
    print("角色 %d 名，已有头像 %d，待下载 %d" % (len(chars), len(chars) - len(todo), len(todo)), flush=True)

    stat, bad = {}, []
    done = 0
    if todo:
        with cf.ThreadPoolExecutor(args.workers) as ex:
            for kind, name, size in ex.map(fetch_one, todo):
                tag = kind.split(":")[0]
                stat[tag] = stat.get(tag, 0) + 1
                if tag not in ("ok", "skip"):
                    bad.append({"name": name, "kind": kind})
                done += 1
                if done % 40 == 0:
                    print("   进度 %d/%d" % (done, len(todo)), flush=True)

    total = 0
    sizes = []
    for c in chars:
        p = os.path.join(OUT_DIR, str(c["entryId"]) + ".png")
        if os.path.exists(p):
            total += 1
            sizes.append(os.path.getsize(p))
    print("下载结果：" + (", ".join("%s=%d" % kv for kv in sorted(stat.items())) or "无需下载"))
    print("头像文件：%d / %d，合计 %.1f MB，单张 %.0f KB ~ %.0f KB" %
          (total, len(chars), sum(sizes) / 1048576, min(sizes) / 1024, max(sizes) / 1024))
    if bad:
        print("有问题的条目：")
        for b in bad[:20]:
            print("   %s %s" % (b["kind"], b["name"]))
    json.dump(bad, open(os.path.join(ROOT, "tools", "missing_avatars.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
