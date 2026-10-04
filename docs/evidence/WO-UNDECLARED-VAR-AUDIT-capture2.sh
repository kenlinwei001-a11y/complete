#!/usr/bin/env bash
# WO-UNDECLARED-VAR-AUDIT · 判决实验第二版（修正第一版的两个工具缺陷，读数不重复使用）
#
# ══════════════════════════════════════════════════════════════════════════════
# 第一版（capture.sh）的两个缺陷，先记账再修：
#  缺陷① 臂间比的是 **tick0 世界** —— 而扰动在 tick0 之后才落地 ⇒ 差分恒 0。
#         形态：「我用『扰动记录写进去了』当作『扰动改变了世界』的证据。」修法：比 **tick3 终态**。
#  缺陷② 判据用了 disclose 的 `rules.items[].fired` —— 实测三臂**全部 54/54 fired**，
#         该字段不具鉴别力（源非 0 且系数非 0 就 true）⇒ 拿它当"这条边活了"的证据是**常量读数**。
#         形态：「我用『fired 为真』当作『这条边的贡献方向被检验过』的证据。」
#         修法：改用**逐格世界态差分**（谁动了、往哪个方向动）。
# ══════════════════════════════════════════════════════════════════════════════
#
# 【预言 · 写于本版取数之前】
#   P1（主线索的可达性判决）：
#     臂 Z（零扰动）与臂 F（30 张 PO 的 procurementDelay 全 set 成 +3）各推 3 拍，比**终态**：
#     预言 —— 臂 F 的 `Material.shortageRisk` 相对臂 Z **升高**（该边系数 +0.07928545 × drive 由负翻正）。
#     证伪 —— 两臂断 shortageRisk 逐格相同 ⇒ 该边结构性死的（裁决相反）。
#   P2（方向计数，照 P1 判决实验的 0/N 形态）：
#     预言 —— 臂 Z 里「相对各自 tick0 升高的 `Material.shortageRisk` 格」= 少（该边只能下压）；
#             臂 F 里 = 多（该边可上抬）。两数之差就是这条边**方向**的证据。
#   P3（H7 的杀手读数 · chain-loss 叠加）：
#     预言 —— 臂 Z 的 chain-loss-matrix.simContext.appliedSteps 里 `material.in_transit` 一项为
#             `stateVar=procurementDelay`、`stateValue<0`、`deltaDays=0`；
#             臂 F 同一项 `stateValue>0`、`deltaDays>0`。
#     ⇒ 证明 `Math.max(0,cell)` **是活的**（随输入变），不是死代码；
#        同时证明**今天的种子世界里那一格恒 0**（被加项装饰品）。
#   P4（coverDays 的对照臂，修正为 delta +50 —— 原版 set 10 可能反而降低）：
#     预言 —— 臂 C 的 `Model.demandLoad` 相对臂 Z **更低**（系数 −0.00698967，覆盖天数↑ ⇒ 需求负载↓）。
#     证伪 —— 两臂 demandLoad 逐格相同 ⇒ 该边不通。
# ══════════════════════════════════════════════════════════════════════════════
set -u
EV="$(cd "$(dirname "$0")" && pwd)"
BASE="http://127.0.0.1:4511"
AUTH='X-Debug-User: demo:admin:admin'
H=(-H "Content-Type: application/json" -H "$AUTH")
j() { curl -s "${H[@]}" "$@"; }

mk() { # mk <名字> <结果文件>
  j -X POST "$BASE/a/v1/sim/sessions" -d '{}' -o "$EV/WO-UNDECLARED-VAR-AUDIT-sess$1.json" -w "sess$1 HTTP=%{http_code}\n"
  node -e 'console.log(require(process.argv[1]).id)' "$EV/WO-UNDECLARED-VAR-AUDIT-sess$1.json"
}
perturb_all() { # perturb_all <会话id> <对象前缀> <状态量> <幅度> <模式> <落盘名>
  local ID="$1" PFX="$2" VAR="$3" MAG="$4" MODE="$5" OUT="$6"
  rm -f /tmp/uv-ids.txt; : > "$EV/$OUT"
  node -e '
    const fs=require("fs");
    const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    console.log(Object.keys(s.baseSnapshot).filter(o=>o.startsWith(process.argv[2])).sort().join("\n"));
  ' "$EV/WO-UNDECLARED-VAR-AUDIT-sess${ID##*_}.json" > /tmp/uv-ids.txt 2>/dev/null || true
  local N=0
  while read -r O; do
    [ -z "$O" ] && continue
    j -X POST "$BASE/a/v1/sim/sessions/$ID/perturbations" \
      -d "{\"perturbation\":{\"targetObjectId\":\"$O\",\"targetStateVar\":\"$VAR\",\"magnitude\":$MAG,\"mode\":\"$MODE\"}}" >> "$EV/$OUT"
    echo >> "$EV/$OUT"; N=$((N+1))
  done < /tmp/uv-ids.txt
  echo "  perturbed $N objects -> $OUT"
}

echo "── 臂 Z2（零扰动参照，重取一次以与 F2/C2 同批同版本）"
IDZ=$(mk Z2 | tail -1); echo "ID_Z2=$IDZ"
j "$BASE/a/v1/sim/sessions/$IDZ/world" -o "$EV/WO-UNDECLARED-VAR-AUDIT-worldZ2-tick0.json" -w "worldZ2 HTTP=%{http_code}\n"
j -X POST "$BASE/a/v1/sim/sessions/$IDZ/tick?disclose=1" -d '{"n":3}' -o "$EV/WO-UNDECLARED-VAR-AUDIT-ticksZ2.json" -w "ticksZ2 HTTP=%{http_code}\n"

echo "── 臂 F2（30 张 PO 的 procurementDelay set 成 +3：负→正翻转）"
IDF=$(mk F2 | tail -1); echo "ID_F2=$IDF"
j "$BASE/a/v1/sim/sessions/$IDF/world" -o "$EV/WO-UNDECLARED-VAR-AUDIT-worldF2-tick0.json" -w "worldF2 HTTP=%{http_code}\n"
node -e '
  const fs=require("fs");
  const w=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  console.log(Object.keys(w.state).filter(o=>o.startsWith("obj_purchaseorder_")).sort().join("\n"));
' "$EV/WO-UNDECLARED-VAR-AUDIT-worldF2-tick0.json" > /tmp/uv-po2.txt
: > "$EV/WO-UNDECLARED-VAR-AUDIT-perturbF2.jsonl"
while read -r O; do
  [ -z "$O" ] && continue
  j -X POST "$BASE/a/v1/sim/sessions/$IDF/perturbations" \
    -d "{\"perturbation\":{\"targetObjectId\":\"$O\",\"targetStateVar\":\"procurementDelay\",\"magnitude\":3,\"mode\":\"set\"}}" >> "$EV/WO-UNDECLARED-VAR-AUDIT-perturbF2.jsonl"
  echo >> "$EV/WO-UNDECLARED-VAR-AUDIT-perturbF2.jsonl"
done < /tmp/uv-po2.txt
echo "  PO perturbed = $(grep -c . "$EV/WO-UNDECLARED-VAR-AUDIT-perturbF2.jsonl")"
j -X POST "$BASE/a/v1/sim/sessions/$IDF/tick?disclose=1" -d '{"n":3}' -o "$EV/WO-UNDECLARED-VAR-AUDIT-ticksF2.json" -w "ticksF2 HTTP=%{http_code}\n"

echo "── 臂 C2（18 个 FGI 的 coverDays delta +50 —— 保证是**上抬**）"
IDC=$(mk C2 | tail -1); echo "ID_C2=$IDC"
j "$BASE/a/v1/sim/sessions/$IDC/world" -o "$EV/WO-UNDECLARED-VAR-AUDIT-worldC2-tick0.json" -w "worldC2 HTTP=%{http_code}\n"
node -e '
  const fs=require("fs");
  const w=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  console.log(Object.keys(w.state).filter(o=>o.startsWith("obj_finishedgoodsinventory_")).sort().join("\n"));
' "$EV/WO-UNDECLARED-VAR-AUDIT-worldC2-tick0.json" > /tmp/uv-fgi2.txt
: > "$EV/WO-UNDECLARED-VAR-AUDIT-perturbC2.jsonl"
while read -r O; do
  [ -z "$O" ] && continue
  j -X POST "$BASE/a/v1/sim/sessions/$IDC/perturbations" \
    -d "{\"perturbation\":{\"targetObjectId\":\"$O\",\"targetStateVar\":\"coverDays\",\"magnitude\":50,\"mode\":\"delta\"}}" >> "$EV/WO-UNDECLARED-VAR-AUDIT-perturbC2.jsonl"
  echo >> "$EV/WO-UNDECLARED-VAR-AUDIT-perturbC2.jsonl"
done < /tmp/uv-fgi2.txt
echo "  FGI perturbed = $(grep -c . "$EV/WO-UNDECLARED-VAR-AUDIT-perturbC2.jsonl")"
j -X POST "$BASE/a/v1/sim/sessions/$IDC/tick?disclose=1" -d '{"n":3}' -o "$EV/WO-UNDECLARED-VAR-AUDIT-ticksC2.json" -w "ticksC2 HTTP=%{http_code}\n"

echo "── 臂 L2（Order.leadDays 的 23 格负值 delta +200 —— 逼它翻正）"
IDL=$(mk L2 | tail -1); echo "ID_L2=$IDL"
j "$BASE/a/v1/sim/sessions/$IDL/world" -o "$EV/WO-UNDECLARED-VAR-AUDIT-worldL2-tick0.json" -w "worldL2 HTTP=%{http_code}\n"
node -e '
  const fs=require("fs");
  const w=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  const bad=Object.keys(w.state).filter(o=>o.startsWith("obj_order_") && typeof w.state[o].leadDays==="number" && w.state[o].leadDays<0).sort();
  console.log(bad.join("\n"));
' "$EV/WO-UNDECLARED-VAR-AUDIT-worldL2-tick0.json" > /tmp/uv-ord2.txt
: > "$EV/WO-UNDECLARED-VAR-AUDIT-perturbL2.jsonl"
while read -r O; do
  [ -z "$O" ] && continue
  j -X POST "$BASE/a/v1/sim/sessions/$IDL/perturbations" \
    -d "{\"perturbation\":{\"targetObjectId\":\"$O\",\"targetStateVar\":\"leadDays\",\"magnitude\":200,\"mode\":\"delta\"}}" >> "$EV/WO-UNDECLARED-VAR-AUDIT-perturbL2.jsonl"
  echo >> "$EV/WO-UNDECLARED-VAR-AUDIT-perturbL2.jsonl"
done < /tmp/uv-ord2.txt
echo "  Order(负 leadDays) perturbed = $(grep -c . "$EV/WO-UNDECLARED-VAR-AUDIT-perturbL2.jsonl")"
j -X POST "$BASE/a/v1/sim/sessions/$IDL/tick?disclose=1" -d '{"n":3}' -o "$EV/WO-UNDECLARED-VAR-AUDIT-ticksL2.json" -w "ticksL2 HTTP=%{http_code}\n"

echo "── 链损叠加：四臂各取一次 simContext"
j -X POST "$BASE/a/v1/sim/chain-loss-matrix" -d "{\"sessionId\":\"$IDZ\"}" -o "$EV/WO-UNDECLARED-VAR-AUDIT-clZ2.json" -w "clZ2 HTTP=%{http_code}\n"
j -X POST "$BASE/a/v1/sim/chain-loss-matrix" -d "{\"sessionId\":\"$IDF\"}" -o "$EV/WO-UNDECLARED-VAR-AUDIT-clF2.json" -w "clF2 HTTP=%{http_code}\n"
j -X POST "$BASE/a/v1/sim/chain-loss-matrix" -d "{\"sessionId\":\"$IDC\"}" -o "$EV/WO-UNDECLARED-VAR-AUDIT-clC2.json" -w "clC2 HTTP=%{http_code}\n"
j -X POST "$BASE/a/v1/sim/chain-loss-matrix" -d "{\"sessionId\":\"$IDL\"}" -o "$EV/WO-UNDECLARED-VAR-AUDIT-clL2.json" -w "clL2 HTTP=%{http_code}\n"

echo "── 争用读数（chain-impediment 的 leadDays>0 守卫）：逐基地"
for B in changzhou jinhua hefei; do
  j "$BASE/a/v1/metrics/base-contention?baseId=$B" -o "$EV/WO-UNDECLARED-VAR-AUDIT-contention-$B.json" -w "contention[$B] HTTP=%{http_code}\n"
done

echo "DONE2"
