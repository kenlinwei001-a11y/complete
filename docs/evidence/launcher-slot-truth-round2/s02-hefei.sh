set -e
AC=http://127.0.0.1:4032
DBG=$(python3 -c "import urllib.parse;print(urllib.parse.quote('demo:user-planner:planner'))")
H=(-H "x-debug-user: $DBG" -H "content-type: application/json")
# ① 问「合肥」（无 chip·真管线：确定性分类 extractedSlots={} → base 缺 → 澄清 → HTTP 级注入本轮显式「合肥」= 复刻抽取形态）
T1=$(curl -s "${H[@]}" -X POST $AC/api/v1/queries -d '{"packageId":"pkg_battery_manufacturing","query":"合肥基地停产影响哪些订单？","context":{"view":"risk","selectedObjects":[],"filters":{}}}' | python3 -c "import sys,json;print(json.load(sys.stdin)['taskId'])")
echo "task1=$T1"; sleep 1
curl -s "${H[@]}" $AC/api/v1/queries/$T1 | python3 -c "import sys,json;t=json.load(sys.stdin);print('status(pre-clarify):',t['status']); print('clarify:',json.dumps(t.get('clarification'),ensure_ascii=False)[:200])"
curl -s "${H[@]}" -X POST $AC/api/v1/queries/$T1/clarification -d '{"kind":"SLOT_FILLING","slotValues":{"base":"合肥"}}' > /dev/null; sleep 1.5
curl -s "${H[@]}" $AC/api/v1/queries/$T1 > s02c-task1.json
python3 - <<'PY'
import json
t = json.load(open('s02c-task1.json'))
print('status:', t['status'])
print('slots.base:', json.dumps(t.get('slots',{}).get('base'), ensure_ascii=False))
text = "\n".join(b.get('markdown','') for b in (t.get('answer') or {}).get('blocks',[]) if b.get('type')=='text')
print('answer text:', text[:400])
assert t['status']=='COMPLETED', 'NOT COMPLETED'
assert t['slots']['base']['objectId']=='hefei', 'objectId not vocab PK'
assert '合肥' in text and '基地=合肥' in text
print('OK-1: 问合肥 → COMPLETED · slots.base.objectId=hefei · 答案含合肥')
PY
