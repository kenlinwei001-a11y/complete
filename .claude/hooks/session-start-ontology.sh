#!/usr/bin/env bash
# SessionStart 钩子：每会话把"系统本体大脑"的强制提醒 + 高价值核心段注入上下文。
# harness 自动运行（非 AI 自觉）；stdout 进入会话上下文。
# 维护：本脚本只注入提醒与 §8 断点；完整接线见 docs/SYSTEM-ONTOLOGY.md（强制读全文）。
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

已知断点（先查再下结论，详见 §8）：
  G-1 20场景仅4个端到端可跑(16无意图/计划)   G-2 affected_orders跨服务形状不匹配(mock藏住)
  G-3 无场景启动器/SceneEntry无presetContext  G-4 意图绑定执行计划无前端创建入口(裁决#27)
  G-5 应用层电池锁死/generic-inference不存在   G-6 Excel解析TODO/无数据模版/合成未并入连接器
  G-7 LLM用途枚举写死+矩阵model选不了          G-8 数据构建闭包仅DataCore栈、不验全链
==========================================================
EOF
