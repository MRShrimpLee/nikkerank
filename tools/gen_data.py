# -*- coding: utf-8 -*-
"""
从 GameKee 社区百科（胜利女神：NIKKE）生成排序器所需的角色数据集。

数据来源：
    https://www.gamekee.com/nikke/second/64599        「妮姬图鉴 → 角色图鉴」目录（205 个角色条目）
    https://www.gamekee.com/v1/entry/treesByPid      接口：条目列表（含名字、头像、content_id）
    https://api-cdn.gamekee.com/wiki2.0/pro/1253/content/<content_id>.json
                                                     接口：角色结构化资料（稀有度/职业/企业/阶段/武器/属性/部队…）

用法：
    python tools/gen_data.py            # 首次会下载 205 份角色资料（约 35MB，缓存在 tools/.cache/）
    python tools/gen_data.py --offline  # 只用本地缓存

输出：
    js/data.js          —— 站点直接 <script> 引用的数据文件（同时兼容 Node require）
    tools/characters.json / tools/report.json —— 中间产物与统计报告
"""
import argparse
import concurrent.futures as cf
import gzip
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(ROOT, "tools", ".cache")
CONTENT_CACHE = os.path.join(CACHE_DIR, "content")
ENTRIES_CACHE = os.path.join(CACHE_DIR, "entries_64599.json")
OUT_DATA = os.path.join(ROOT, "js", "data.js")

GAME_ALIAS = "nikke"
ENCYCLOPEDIA_NODE = "64599"          # 妮姬图鉴 → 角色图鉴
API = "https://www.gamekee.com"
CDN = "https://api-cdn.gamekee.com/wiki2.0/pro/1253/content/%s.json"

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-cn",
    "Referer": "https://www.gamekee.com/",
    "Origin": "https://www.gamekee.com",
    "game-alias": GAME_ALIAS,
    "X-Requested-With": "XMLHttpRequest",
}

# 字段名 -> 数据键（来自角色资料 baseData 里的中文标签）
FIELD_LABELS = {
    "角色名称": "name",
    "稀有度": "rarity",
    "CV": "cv",
    "实装日期": "release",
    "namecode": "code",
    "企业": "company",
    "部队": "squad",
    "阶段": "burst",
    "属性": "element",
    "职业": "cls",
    "武器": "weapon",
    "武器（名）": "weaponName",
    "简介": "intro",
}

# 联动角色：按 GameKee 的「部队」字段识别（这些部队名只出现在联动角色上）
COLLAB_SQUADS = {
    "寄叶": "NieR:Automata",
    "恶魔猎人": "电锯人",
    "NERV": "新世纪福音战士",
    "NERV部队": "新世纪福音战士",
    "WILLE": "新世纪福音战士",
    "WILLE部队": "新世纪福音战士",
    "莉可莉可咖啡厅": "Lycoris Recoil",
    "爱蜜莉雅阵营": "Re:从零开始的异世界生活",
    "B.S.T": "生化危机",
    "心之怪盗团": "女神异闻录5",
    "特别课外活动部": "女神异闻录3",
    "自称特别搜查队": "女神异闻录4",
}
# 数据规整：个别条目的写法与全局取值不一致，统一到规范值
COMPANY_FIX = {"米西利斯（超标准）": "米西利斯", "极乐净土（超标准）": "极乐净土",
               "泰特拉（超标准）": "泰特拉"}
ELEMENT_FIX = {"雷电": "电击"}     # 妮姬只有 5 种属性，GameKee 该条目用了别名
CLASS_FIX = {"支援型": "辅助型"}    # 百科筛选器只有 火力/防御/辅助 三类，个别条目写成「支援型」

# 「异格 / 换皮」角色：同名角色的另一个版本（如 阿妮斯：超级巨星、拉毗：小红帽）。
# 命名规律是「本体名：后缀」，用全角冒号分隔；另有少数特例单列。
VARIANT_SEP = "："
VARIANT_BASE_ALIAS = {
    "安妮": "N102",      # 安妮是 N102 的本名，「安妮：奇迹仙女」的对应本体是 N102
}
EXTRA_VARIANTS = {
    "零 (暂称)": "零",   # 括号写法，本体是 零
}


def log(*a):
    print(*a, flush=True)


def http_get(url, timeout=90):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return raw.decode("utf-8", "replace")


def api(path, **params):
    url = API + path + ("?" + urllib.parse.urlencode(params) if params else "")
    return json.loads(http_get(url))


def fetch_entries(offline):
    """取角色图鉴下的全部条目"""
    if offline and os.path.exists(ENTRIES_CACHE):
        return json.load(open(ENTRIES_CACHE, encoding="utf-8"))
    if os.path.exists(ENTRIES_CACHE):
        log("使用本地缓存 %s" % ENTRIES_CACHE)
        return json.load(open(ENTRIES_CACHE, encoding="utf-8"))
    log("拉取角色图鉴目录 ...")
    d = api("/v1/entry/treesByPid", pid=ENCYCLOPEDIA_NODE)
    if d.get("code") != 0:
        raise SystemExit("接口返回异常：%s" % d.get("msg"))
    entries = [e for e in d["data"] if e.get("name") and e.get("content_id")]
    os.makedirs(CACHE_DIR, exist_ok=True)
    json.dump(entries, open(ENTRIES_CACHE, "w", encoding="utf-8"), ensure_ascii=False)
    log("  得到 %d 个角色条目" % len(entries))
    return entries


def fetch_profile(entry):
    """取单个角色的结构化资料（带缓存）"""
    cid = str(entry["content_id"])
    path = os.path.join(CONTENT_CACHE, cid + ".json")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return cid, "cached"
    os.makedirs(CONTENT_CACHE, exist_ok=True)
    last = None
    for attempt in range(3):
        try:
            raw = http_get(CDN % cid)
            data = json.loads(raw)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
            return cid, "ok"
        except Exception as e:
            last = str(e)[:60]
            time.sleep(1.5 * (attempt + 1))
    return cid, "fail:%s" % last


def parse_profile(path):
    """把 content JSON 解析成 {标签: 值}"""
    d = json.load(open(path, encoding="utf-8"))
    inner = json.loads(d["content"]) if isinstance(d.get("content"), str) else d.get("content", {})
    out = {}
    for row in inner.get("baseData", []):
        if not isinstance(row, list):
            continue
        cells = [c.get("value") if isinstance(c, dict) else c for c in row]
        cells = [c for c in cells if isinstance(c, str) and c.strip() and not c.startswith("//")]
        if len(cells) >= 2:
            label, value = cells[0].strip(), cells[1].strip()
            if label and label not in out:
                out[label] = value
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="只用本地缓存")
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    entries = fetch_entries(args.offline)
    log("角色条目：%d" % len(entries))

    todo = [e for e in entries
            if not (os.path.exists(os.path.join(CONTENT_CACHE, str(e["content_id"]) + ".json")))]
    if todo and not args.offline:
        log("下载角色资料 %d 份 ..." % len(todo))
        stat = {}
        done = 0
        with cf.ThreadPoolExecutor(args.workers) as ex:
            for cid, kind in ex.map(fetch_profile, todo):
                tag = kind.split(":")[0]
                stat[tag] = stat.get(tag, 0) + 1
                if tag == "fail":
                    log("   失败 %s (%s)" % (cid, kind))
                done += 1
                if done % 40 == 0:
                    log("   进度 %d/%d" % (done, len(todo)))
        log("   下载结果：" + ", ".join("%s=%d" % kv for kv in sorted(stat.items())))

    chars = []
    for e in entries:
        cid = str(e["content_id"])
        p = os.path.join(CONTENT_CACHE, cid + ".json")
        if not os.path.exists(p):
            log("   跳过（无资料）：%s %s" % (cid, e["name"]))
            continue
        prof = parse_profile(p)
        icon = e.get("icon") or ""
        if icon.startswith("//"):
            icon = "https:" + icon
        item = {
            "entryId": e["id"],
            "contentId": e["content_id"],
            "name": prof.get("角色名称") or e["name"],
            "icon": icon,
            "rarity": prof.get("稀有度", ""),
            "cls": CLASS_FIX.get(prof.get("职业", ""), prof.get("职业", "")),
            "clsRaw": prof.get("职业", ""),
            "company": COMPANY_FIX.get(prof.get("企业", ""), prof.get("企业", "")),
            "companyRaw": prof.get("企业", ""),
            "overflow": "超标准" in prof.get("企业", ""),
            "burst": prof.get("阶段", ""),
            "element": ELEMENT_FIX.get(prof.get("属性", ""), prof.get("属性", "")),
            "elementRaw": prof.get("属性", ""),
            "weapon": prof.get("武器", ""),
            "weaponName": prof.get("武器（名）", ""),
            "squad": prof.get("部队", ""),
            "cv": prof.get("CV", ""),
            "release": prof.get("实装日期", ""),
            "code": prof.get("namecode", ""),
            "intro": re.sub(r"\s+", " ", prof.get("简介", ""))[:200],
        }
        collab = COLLAB_SQUADS.get(item["squad"])
        item["collab"] = bool(collab)
        item["collabName"] = collab or ""
        # 偏好分析用的标签：部队 / 企业 / 职业 / 武器 / 属性（引擎的 tagPreference 直接读 tags）
        item["tags"] = [t for t in (item["squad"], item["company"], item["cls"],
                                    item["weapon"], item["element"]) if t]
        chars.append(item)

    # 排序：稀有度（SSR→SR→R）→ 职业 → 企业 → 名字
    rarity_order = {"SSR": 0, "SR": 1, "R": 2}
    cls_order = {"火力型": 0, "防御型": 1, "辅助型": 2}
    chars.sort(key=lambda c: (rarity_order.get(c["rarity"], 9), cls_order.get(c["cls"], 9),
                              c["company"], c["release"], c["name"]))

    # 标记「异格 / 换皮」角色，并把本体名补全
    all_names = {c["name"] for c in chars}
    for c in chars:
        base = ""
        if VARIANT_SEP in c["name"]:
            base = c["name"].split(VARIANT_SEP)[0]
        elif c["name"] in EXTRA_VARIANTS:
            base = EXTRA_VARIANTS[c["name"]]
        base = VARIANT_BASE_ALIAS.get(base, base)
        c["variant"] = bool(base)
        c["baseName"] = base if base in all_names else ""
        c["baseNameRaw"] = base
    # 把本体 id 也挂上，方便结果页/统计引用
    for i, c in enumerate(chars, 1):
        c["id"] = i
    name_to_id = {c["name"]: c["id"] for c in chars}
    for c in chars:
        c["baseId"] = name_to_id.get(c["baseNameRaw"], 0) if c["variant"] else 0
        if not c["baseId"] and c["variant"]:
            log("   提示：换皮角色「%s」在库里找不到本体「%s」" % (c["name"], c["baseNameRaw"]))

    from collections import Counter
    def group(field, order=None):
        cnt = Counter(c[field] for c in chars if c[field])
        keys = order or sorted(cnt, key=lambda k: -cnt[k])
        return [{"value": k, "name": k, "count": cnt[k]} for k in keys if cnt.get(k)]

    payload = {
        "meta": {
            "game": "胜利女神：NIKKE",
            "version": "1.0.0",
            "source": "https://www.gamekee.com/nikke/second/64599",
            "total": len(chars),
        },
        "groups": {
            "rarity": group("rarity", ["SSR", "SR", "R"]),
            "cls": group("cls", ["火力型", "防御型", "辅助型"]),
            "company": group("company"),
            "burst": group("burst", ["一阶", "二阶", "三阶", "通用"]),
            "weapon": group("weapon"),
            "element": group("element"),
        },
        "collabSources": [{"name": n, "count": sum(1 for c in chars if c["collabName"] == n)}
                          for n in dict.fromkeys(c["collabName"] for c in chars if c["collab"])],
        "variantCount": sum(1 for c in chars if c["variant"]),
        "characters": chars,
    }
    # 与明日方舟版保持同样的字段名（app.js / engine.js 直接复用）
    payload["operators"] = payload["characters"]

    os.makedirs(os.path.dirname(OUT_DATA), exist_ok=True)
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    with open(OUT_DATA, "w", encoding="utf-8") as f:
        f.write("/* 由 tools/gen_data.py 自动生成，请勿手动修改。\n"
                "   数据来源：https://www.gamekee.com/nikke/second/64599 */\n")
        f.write("(function (root, data) {\n")
        f.write("  if (typeof module === 'object' && module.exports) module.exports = data\n")
        f.write("  else root.AK_DATA = data\n")
        f.write("})(typeof globalThis !== 'undefined' ? globalThis : this, ")
        f.write(body)
        f.write(");\n")

    json.dump(payload, open(os.path.join(ROOT, "tools", "characters.json"), "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))

    report = {
        "entries": len(entries),
        "characters": len(chars),
        "missingProfile": [e["name"] for e in entries
                           if not os.path.exists(os.path.join(CONTENT_CACHE, str(e["content_id"]) + ".json"))],
        "rarity": dict(Counter(c["rarity"] for c in chars)),
        "cls": dict(Counter(c["cls"] for c in chars)),
        "company": dict(Counter(c["company"] for c in chars)),
        "burst": dict(Counter(c["burst"] for c in chars)),
        "weapon": dict(Counter(c["weapon"] for c in chars)),
        "element": dict(Counter(c["element"] for c in chars)),
        "collab": [{"name": c["name"], "source": c["collabName"]} for c in chars if c["collab"]],
        "variants": {
            "count": sum(1 for c in chars if c["variant"]),
            "baseCount": sum(1 for c in chars if not c["variant"]),
            "withoutBase": [c["name"] for c in chars if c["variant"] and not c["baseId"]],
            "list": [{"name": c["name"], "base": c["baseNameRaw"]} for c in chars if c["variant"]],
            "nameCollision": [n for n, k in Counter(c["name"] for c in chars).items() if k > 1],
        },
        "normalized": {
            "company": [{"name": c["name"], "raw": c["companyRaw"]} for c in chars if c["overflow"]],
            "element": [{"name": c["name"], "raw": c["elementRaw"]} for c in chars
                        if c["elementRaw"] != c["element"]],
            "cls": [{"name": c["name"], "raw": c["clsRaw"]} for c in chars
                    if c["clsRaw"] != c["cls"]],
        },
        "noIcon": [c["name"] for c in chars if not c["icon"]],
        "emptyFields": {k: [c["name"] for c in chars if not c[k]][:10]
                        for k in ("rarity", "cls", "company", "burst", "element", "weapon", "squad")},
    }
    json.dump(report, open(os.path.join(ROOT, "tools", "report.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)

    log("")
    log("收录角色：%d 名" % len(chars))
    log("稀有度：" + "，".join("%s %d" % (g["value"], g["count"]) for g in payload["groups"]["rarity"]))
    log("职业：" + "，".join("%s %d" % (g["value"], g["count"]) for g in payload["groups"]["cls"]))
    log("企业：" + "，".join("%s %d" % (g["value"], g["count"]) for g in payload["groups"]["company"]))
    log("阶段：" + "，".join("%s %d" % (g["value"], g["count"]) for g in payload["groups"]["burst"]))
    log("武器：" + "，".join("%s %d" % (g["value"], g["count"]) for g in payload["groups"]["weapon"]))
    log("属性：" + "，".join("%s %d" % (g["value"], g["count"]) for g in payload["groups"]["element"]))
    log("联动：%d 名（%s）" % (len(report["collab"]),
        "、".join("%s %d" % (s["name"], s["count"]) for s in payload["collabSources"]) or "无"))
    log("异格/换皮：%d 名（本体 %d 名，找不到本体的 %d 名）" % (
        report["variants"]["count"], report["variants"]["baseCount"],
        len(report["variants"]["withoutBase"])))
    log("缺字段统计：%s" % {k: len(v) for k, v in report["emptyFields"].items()})
    log("已写出 %s" % OUT_DATA)
    return 0


if __name__ == "__main__":
    sys.exit(main())
