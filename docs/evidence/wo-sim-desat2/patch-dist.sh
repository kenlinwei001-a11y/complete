#!/usr/bin/env bash
# 实验脚手架（**不进产品**）：给已编译的 dist 引擎装一个 `DESAT_GAIN_SCALE` 旋钮，
# 等价于「把全表 50 条规则的 coefficient 同乘一个因子」，免去为做一次对照实验去改 50 处字面量。
# ⚠ 只用于本单的对照实验；产品侧的定标必须落在 `seed.ts`/`battery.ts` 的**有出处的参数**上。
set -euo pipefail
F="$(dirname "$0")/../../../apps/datacore/dist/sim/propagation.js"
if grep -q "DESAT_GAIN_SCALE" "$F"; then echo "already patched"; exit 0; fi
python3 - "$F" <<'EOF'
import sys
p = sys.argv[1]
s = open(p, encoding="utf8").read()
old = "    return rule.coefficient;\n}"
assert s.count(old) == 1, f"锚点命中 {s.count(old)} 次 ⇒ 抽取器坏了，别继续"
s = s.replace(old, "    return rule.coefficient * (Number(process.env.DESAT_GAIN_SCALE) || 1);\n}")
old2 = "        if (Number.isFinite(n))\n            return n;"
assert s.count(old2) == 1, f"锚点2 命中 {s.count(old2)} 次 ⇒ 抽取器坏了"
s = s.replace(old2, "        if (Number.isFinite(n))\n            return n * (Number(process.env.DESAT_GAIN_SCALE) || 1);")
open(p, "w", encoding="utf8").write(s)
print("patched")
EOF
