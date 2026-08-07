#!/usr/bin/env bash
# G1 静态门取证（显式捕获退出码，逐门打印 RC）。跑完即删。
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" || exit 2
for g in "$@"; do
  echo "───── ${g} ─────"
  out="$(node "scripts/${g}" 2>&1)"; rc=$?
  echo "$out" | tail -12
  echo "RC=${rc}  (${g})"
done
