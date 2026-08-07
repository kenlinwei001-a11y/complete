#!/usr/bin/env bash
# WO-SANDBOX-G1 · 推演沙盘系列**收口总门**（一条命令跑完端到端 SEAM 的两半）。
#
# ── 为什么是两个文件而不是一个 ────────────────────────────────────────────────
# 「数据半 × 引擎半」跑在 datacore（node 环境，能起真 Fastify + 真合成种子）；
# 「前端半」跑在 frontend-shell（jsdom 环境，能真渲染 React）。
# 跨包同文件做不到：`contracts-only-shared` 禁止前端 import datacore 源码，
# 且两包 vitest 环境不同。**本脚本就是把两半焊成一条门的那个焊点** ——
# 单独跑任一半都只是半条判据。
#
# ── 退出码纪律（本仓真实事故的直接对策）──────────────────────────────────────
# 一律 `out="$(cmd 2>&1)"; rc=$?`。**禁止** `cmd | tail -n; echo "EXIT=$?"` ——
# `$?` 取的是管道末端 `tail` 的退出码（恒 0），本仓曾据此把一个 agentcore 编译失败的
# commit 判成"BUILD 通过"并入正线，直到部署方 build 失败才暴露。
#
# 用法：bash scripts/gate-sandbox-g1.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

FAILED=()

run() {
  local name="$1"; shift
  echo "───── ${name} ─────"
  local out rc
  out="$("$@" 2>&1)"; rc=$?          # ★ 先执行、显式捕获退出码，绝不经管道取 $?
  if [ $rc -eq 0 ]; then
    echo "$out" | tail -6
    echo "✅ ${name} RC=0"
  else
    # 失败时打印**原文**（断言消息 / TS 错误 / 未捕获异步），不许只 tail 几行把错误挤掉。
    echo "$out" | grep -E "error TS|FAIL|✗|AssertionError|Error:|ERR_|Unhandled|caught after|→ expected|^\s+at .*\.(ts|tsx):[0-9]+" | head -60
    echo "…（尾部上下文）"
    echo "$out" | tail -40
    echo "❌ ${name} RC=${rc}"
    FAILED+=("${name}")
  fi
}

echo "══ WO-SANDBOX-G1 收口总门（数据半 × 引擎半 × 前端半）══"

run "G1 · 数据半 × 引擎半（datacore）" \
  pnpm --filter datacore exec vitest run test/sandbox-g1-seam.test.ts --reporter=basic

run "G1 · 前端半（frontend-shell）" \
  pnpm --filter frontend-shell exec vitest run test/sandbox-g1-views.seam.test.tsx --reporter=basic

echo "──────────────────────────────────────────────"
if [ ${#FAILED[@]} -eq 0 ]; then
  echo "✅ G1 总门全绿（两半都过）"
  exit 0
fi
echo "❌ G1 总门失败：${FAILED[*]}"
echo "   —— 提醒：任一半绿都不算过。本门的判据是**接缝驱动通**，不是各半 unit 绿。"
exit 1
