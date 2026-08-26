#!/usr/bin/env bash
# SessionStart 钩子：每会话把"系统本体大脑"的强制提醒 + **从本体动态抽取的**未修断点注入上下文。
# harness 自动运行（非 AI 自觉）；stdout 进入会话上下文。
# 设计：断点列表不再硬编码（避免"硬编码即漂移"）——直接从 docs/SYSTEM-ONTOLOGY.md §8
# 抽取"未标 ✅已修"的行；本体一更新，提醒自动跟随，结构上不可能漂。
set -euo pipefail
ONTO="docs/SYSTEM-ONTOLOGY.md"

echo "================ 系统本体「大脑」· 强制前置 ================"
if [[ -f "$ONTO" ]]; then
  ver="$(grep -m1 -oE '版本 v[0-9.]+' "$ONTO" 2>/dev/null || echo '版本 未知')"
  echo "已检出 $ONTO（$ver）。"
else
  echo "⚠ 未检出 $ONTO —— 从 GitHub 兜底拉取再分析；拉不到则明确告知用户结论可能与实际接线不符。"
fi
cat <<'EOF'

铁律 0（见 CLAUDE.md）：产出任何 PRD / 架构变更 / 跨模块改动，或回答
"改 X 会影响什么 / 为什么这里断了" 之前，必须先用 Read 完整读 docs/SYSTEM-ONTOLOGY.md
（或调用 /ontology skill），再按 read-first 协议分析。

read-first 协议：定位对象类型(§2) → 沿链路追全链(§3) → 查不变量(§5,R1-R12)
→ 走检测门禁(§7) → 看数据流(§4)。断点常在链路接缝；牢记"绿测试 ≠ 能用"。

产出要求：PRD/架构文档必须含《本体引用与影响》（对象类型/链路/事件/不变量/断点）；
改了链路/事件/对象类型/不变量/门禁 → 必须回写 docs/SYSTEM-ONTOLOGY.md。
EOF

# 未修断点：从本体 §8 动态抽取（不含"已修"的 G- 行），先查再下结论。
if [[ -f "$ONTO" ]]; then
  echo ""
  echo "未修断点（实时取自本体 §8，先查再下结论）："
  awk '/^## 8\./{f=1;next} /^## 9\./{f=0} f && /^\| G-/ && $0 !~ /已修/' "$ONTO" \
    | sed -E 's/^\| (G-[0-9]+) \|[[:space:]]*([^|]+)\|.*/  \1 \2/' \
    | sed -E 's/(\*\*|~~|`)//g' \
    | cut -c1-100 \
    | head -20
  echo "  （已修断点见 §8 全表）"
fi
echo "=========================================================="
