set -e
AC=http://127.0.0.1:4032
DBG=$(python3 -c "import urllib.parse;print(urllib.parse.quote('demo:user-planner:planner'))")
H=(-H "x-debug-user: $DBG" -H "content-type: application/json")
# ③ Model 载荷形态（GET Model/* 无 objectId 字段）：chip 长 id obj_model_2170-NCM + 澄清补 demandDelta
T3=$(curl -s "${H[@]}" -X POST $AC/api/v1/queries -d '{"packageId":"pkg_battery_manufacturing","query":"4680-NCM 加 20% 六周能不能接？","context":{"view":"plan","selectedObjects":[{"objectType":"Model","objectId":"obj_model_2170-NCM","label":"2170 三元圆柱"}],"filters":{}}}' | python3 -c "import sys,json;print(json.load(sys.stdin)['taskId'])")
echo "task3=$T3"; sleep 1
S=$(curl -s "${H[@]}" $AC/api/v1/queries/$T3 | python3 -c "import sys,json;print(json.load(sys.stdin)['status'])")
echo "pre: $S"
if [ "$S" = "AWAITING_CLARIFICATION" ]; then
  curl -s "${H[@]}" -X POST $AC/api/v1/queries/$T3/clarification -d '{"kind":"SLOT_FILLING","slotValues":{"demandDelta":0.2}}' >/dev/null; sleep 1.5
fi
curl -s "${H[@]}" $AC/api/v1/queries/$T3 > s02c-task3.json
python3 - <<'PY'
import json
t = json.load(open('s02c-task3.json'))
print('status:', t['status'])
print('slots.model:', json.dumps(t.get('slots',{}).get('model'), ensure_ascii=False))
text = "\n".join(b.get('markdown','') for b in (t.get('answer') or {}).get('blocks',[]) if b.get('type')=='text')
print('answer text:', text[:300])
assert t['status']=='COMPLETED'
assert t['slots']['model']['objectId']=='2170-NCM', f"got {t['slots']['model']['objectId']}"
print('OK-3: Model 载荷形态（无 objectId 字段）→ 长id chip 规范化 2170-NCM → COMPLETED')
PY
