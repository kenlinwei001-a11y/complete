#!/usr/bin/env bash
# WO-UNDECLARED-VAR-AUDIT · capture3 的尾巴（capture3 在链损一节的 eval 变量名上挂在 set -u）
# 记账：capture3.sh 里 `eval "ID=\$ID$A"` 展开成 `IDZ3`，而变量叫 `IDZ` ⇒ unbound ⇒ set -u 中断。
# 且当时用 `bash capture3.sh | tail -40; echo $?` 取到的是 **tail 的 rc=0** —— 又是一次假绿读数，
# 本脚本改为**落文件 + 显式捕获 rc**。
set -u
EV="$(cd "$(dirname "$0")" && pwd)"
BASE="http://127.0.0.1:4511"
AUTH='X-Debug-User: demo:admin:admin'
H=(-H "Content-Type: application/json" -H "$AUTH")
j() { curl -s "${H[@]}" "$@"; }
sid() { node -e 'console.log(require(process.argv[1]).id)' "$EV/WO-UNDECLARED-VAR-AUDIT-sess$1.json"; }
RC=0
for A in Z3 F3 C3 L3; do
  ID=$(sid "$A")
  j -X POST "$BASE/a/v1/sim/chain-loss-matrix" -d "{\"sessionId\":\"$ID\"}" -o "$EV/WO-UNDECLARED-VAR-AUDIT-cl$A.json" -w "  cl$A($A=$ID) HTTP=%{http_code}\n" || RC=1
  j "$BASE/a/v1/sim/sessions/$ID/perturbations" -o "$EV/WO-UNDECLARED-VAR-AUDIT-plist$A.json" -w "  plist$A n=%{size_download} HTTP=%{http_code}\n" || RC=1
done
j -X POST "$BASE/a/v1/sim/chain-loss-matrix" -d '{}' -o "$EV/WO-UNDECLARED-VAR-AUDIT-clNONE.json" -w "  clNONE HTTP=%{http_code}\n" || RC=1
echo "CAPTURE3B_RC=$RC"
exit $RC
