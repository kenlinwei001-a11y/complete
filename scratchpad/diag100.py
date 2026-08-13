#!/usr/bin/env python3
"""
WO-DIAG-100Q · 自由深问 100 题真测脚本。
绑定真实 LLM（Kimi 2.6），走 QOS 全链，记录每题 route/status/answer/provenance/耗时。
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:4002"
HEADERS = {
    "Content-Type": "application/json",
    "X-Debug-User": "demo:admin:admin|planner|catalog_admin",
}
TIMEOUT = 180
POLL_INTERVAL = 1.0

ROOT = Path(__file__).resolve().parent.parent
WO_FILE = ROOT / "docs" / "WO-DIAG100Q.md"
OUT_JSON = ROOT / "scratchpad" / "diag100-results.json"
OUT_MD = ROOT / "docs" / "DIAG-100Q-RESULTS.md"


def api(method: str, path: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    url = f"{BASE}{path}"
    data = json.dumps(payload).encode("utf-8") if payload else None
    req = urllib.request.Request(url, data=data, headers=HEADERS, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def parse_questions(path: Path) -> List[Dict[str, Any]]:
    text = path.read_text(encoding="utf-8")
    blocks = re.split(r"\n(?=###\s+[A-Z]\.\s)", text)
    questions: List[Dict[str, Any]] = []
    for block in blocks:
        section_match = re.search(r"###\s+([A-Z])\.\s+(.+?)\s*（(\d+)", block)
        section = section_match.group(2).strip() if section_match else "未知"
        for m in re.finditer(
            r"(?m)^(?P<num>\d+)\.\s+(?P<question>.+?)\s*【(?P<anchor>[^】]+)】\s*(?P<probe>[^\n]*?)$",
            block,
        ):
            q = m.group("question").strip()
            q = re.sub(r"\s+", " ", q)
            raw_probe = m.group("probe").strip()
            if not raw_probe:
                probe = "正常"
            elif "gap-data" in raw_probe:
                probe = "gap-data"
            elif "gap-route" in raw_probe:
                probe = "gap-route"
            elif "gap-orch" in raw_probe:
                probe = "gap-orch"
            elif "gap-agent" in raw_probe:
                probe = "gap-agent"
            elif raw_probe.startswith("◐"):
                probe = "◐"
            elif raw_probe.startswith("⏱"):
                probe = "⏱"
            else:
                probe = raw_probe.split()[0].strip("(")
            questions.append({
                "num": int(m.group("num")),
                "section": section,
                "question": q,
                "anchor": m.group("anchor").strip(),
                "probe": probe,
            })
    questions.sort(key=lambda x: x["num"])
    return questions


def submit_query(question: str) -> Dict[str, Any]:
    payload = {
        "packageId": "pkg_battery_manufacturing",
        "query": question,
        "context": {
            "view": "cockpit",
            "selectedObjects": [],
            "filters": {},
            "pageContext": {
                "view": "cockpit",
                "entities": [],
                "selection": [],
                "drillPath": [],
                "actions": [],
                "focus": {},
            },
        },
    }
    return api("POST", "/b/v1/queries", payload)


def poll_until_done(task_id: str) -> Dict[str, Any]:
    start = time.time()
    while True:
        elapsed = time.time() - start
        if elapsed > TIMEOUT:
            return {"status": "TIMEOUT", "elapsed": elapsed, "error": f">{TIMEOUT}s未终态"}
        try:
            r = api("GET", f"/b/v1/queries/{task_id}")
        except Exception as e:
            return {"status": "FAILED", "elapsed": elapsed, "error": str(e)}
        status = r.get("status", "UNKNOWN")
        if status in ("COMPLETED", "FAILED", "ERROR", "CANCELLED"):
            r["elapsed"] = elapsed
            return r
        time.sleep(POLL_INTERVAL)


def extract_answer_text(answer: Any) -> str:
    if isinstance(answer, dict):
        if "summary" in answer:
            return str(answer["summary"])
        if "text" in answer:
            return str(answer["text"])
        if "answer" in answer:
            return str(answer["answer"])
        return json.dumps(answer, ensure_ascii=False)
    return str(answer) if answer is not None else ""


def has_provenance(r: Dict[str, Any]) -> bool:
    for k in ("provenance", "trace", "sources"):
        if k in r and r[k]:
            return True
    ans = r.get("answer", {})
    if isinstance(ans, dict):
        for k in ("provenance", "trace", "sources", "solver", "route"):
            if k in ans and ans[k]:
                return True
    return False


def classify(r: Dict[str, Any]) -> str:
    status = r.get("status", "")
    if status == "TIMEOUT":
        return "⏱"
    if status in ("FAILED", "ERROR"):
        return "✗"
    if status == "COMPLETED":
        ans_text = extract_answer_text(r.get("answer"))
        # 探索模式未能产出 = 硬失败（WO 枚举）
        if "探索模式未能产出" in ans_text or "未能产出回答" in ans_text:
            return "✗"
        if not ans_text or len(ans_text) < 20 or "不知道" in ans_text:
            return "◐"
        if has_provenance(r):
            return "✅"
        return "◐"
    return "✗"


def extract_route(r: Dict[str, Any]) -> str:
    # top-level path (AGENT / WORKFLOW / etc.)
    if "path" in r:
        return str(r["path"])
    ans = r.get("answer", {})
    if isinstance(ans, dict):
        for k in ("route", "solver", "solverKey", "path"):
            if k in ans:
                return str(ans[k])
        if "inferenceProcess" in ans:
            return "inference-process"
    trace = r.get("trace", {})
    if isinstance(trace, dict):
        return str(trace.get("route", trace.get("path", "unknown")))
    return "unknown"


def run() -> None:
    questions = parse_questions(WO_FILE)
    print(f"解析到 {len(questions)} 题")
    if len(questions) != 100:
        print(f"WARN: 期望 100 题，实际 {len(questions)}")
        missing = set(range(1, 101)) - {q["num"] for q in questions}
        if missing:
            print(f"缺失题号: {sorted(missing)}")

    results: List[Dict[str, Any]] = []
    if OUT_JSON.exists():
        results = json.loads(OUT_JSON.read_text(encoding="utf-8"))
        done_nums = {r["num"] for r in results if r.get("status") not in ("", "PENDING")}
        print(f"已存在结果，跳过 {len(done_nums)} 题")
    else:
        done_nums = set()

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)

    for q in questions:
        if q["num"] in done_nums:
            continue
        print(f"\n[{q['num']:03d}/100] {q['question'][:60]}...")
        t0 = time.time()
        try:
            submit = submit_query(q["question"])
            task_id = submit.get("taskId")
            if not task_id:
                rec = {"num": q["num"], "status": "FAILED", "error": "无 taskId", "elapsed": 0}
            else:
                rec = poll_until_done(task_id)
                rec["taskId"] = task_id
        except Exception as e:
            rec = {"status": "FAILED", "error": str(e), "elapsed": time.time() - t0}

        record = {
            "num": q["num"],
            "section": q["section"],
            "question": q["question"],
            "anchor": q["anchor"],
            "probe": q["probe"],
            "status": rec.get("status", ""),
            "route": extract_route(rec),
            "elapsed": round(rec.get("elapsed", 0), 2),
            "verdict": classify(rec),
            "answer": rec.get("answer") if isinstance(rec.get("answer"), (dict, list, str)) else str(rec.get("answer", "")),
            "error": rec.get("error", ""),
            "raw": rec,
        }
        results.append(record)
        results.sort(key=lambda x: x["num"])
        OUT_JSON.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  -> {record['status']} | {record['verdict']} | route={record['route']} | {record['elapsed']}s")

    generate_report(results)


def generate_report(results: List[Dict[str, Any]]) -> None:
    counts = {"✅": 0, "◐": 0, "◑": 0, "✗": 0, "⏱": 0}
    for r in results:
        counts[r.get("verdict", "✗")] = counts.get(r.get("verdict", "✗"), 0) + 1

    lines = [
        "# WO-DIAG-100Q · 自由深问 100 题真测结果台账",
        "",
        f"> 基线：canonical `claude/vigilant-knuth-b1nmxn` @ e99f23c3",
        f"> 测试时间：{time.strftime('%Y-%m-%d %H:%M:%S')}",
        f"> LLM：Kimi 2.6（真实 LLM·非 mock）",
        "",
        "## 汇总统计",
        "",
        f"- ✅ 真接地：{counts.get('✅', 0)} 题",
        f"- ◐ 绿但薄：{counts.get('◐', 0)} 题",
        f"- ◑ 绿但错：{counts.get('◑', 0)} 题",
        f"- ✗ 硬失败：{counts.get('✗', 0)} 题",
        f"- ⏱ 超时：{counts.get('⏱', 0)} 题",
        f"- 总计：{len(results)} 题",
        "",
        "## 100 题结果",
        "",
        "| 序号 | 问句 | 锚实体 | 探针 | 实际 route | 状态 | 判定 | 耗时(s) | 卡点归类 | 修路径 |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in results:
        q = r["question"].replace("|", "\\|")
        anchor = r["anchor"].replace("|", "\\|")
        route = str(r.get("route", "")).replace("|", "\\|")[:40]
        status = r.get("status", "")
        verdict = r.get("verdict", "")
        elapsed = r.get("elapsed", 0)
        gap = r.get("gap_class", "待分类")
        fix = r.get("fix_path", "")
        lines.append(f"| {r['num']} | {q} | {anchor} | {r.get('probe','')} | {route} | {status} | {verdict} | {elapsed} | {gap} | {fix} |")

    lines += [
        "",
        "## 卡点归类汇总",
        "",
        "（待跑完后按 6 类框架补全）",
        "",
        "## Top-10 最该修",
        "",
        "（待跑完后按影响面排序）",
    ]
    OUT_MD.parent.mkdir(parents=True, exist_ok=True)
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n报告已生成：{OUT_MD}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="WO-DIAG-100Q runner")
    parser.add_argument("--parse-only", action="store_true", help="只解析问题清单，不调用服务")
    parser.add_argument("--report-only", action="store_true", help="根据已有 JSON 生成报告")
    args = parser.parse_args()

    if args.parse_only:
        qs = parse_questions(WO_FILE)
        print(f"解析到 {len(qs)} 题")
        for q in qs[:5]:
            print(q)
        sys.exit(0)

    if args.report_only:
        if not OUT_JSON.exists():
            print("无结果文件可生成报告")
            sys.exit(1)
        results = json.loads(OUT_JSON.read_text(encoding="utf-8"))
        generate_report(results)
        sys.exit(0)

    run()
