set -e
AC=http://127.0.0.1:4032
DBG=$(python3 -c "import urllib.parse;print(urllib.parse.quote('demo:user-planner:planner'))")
H=(-H "x-debug-user: $DBG" -H "content-type: application/json")
# ② 候选回填/页面选中长 id 形态（live 断点 b 的确切形状）：chip objectId=obj_base_hefei
T2=$(curl -s "${H[@]}" -X POST $AC/api/v1/queries -d '{"packageId":"pkg_battery_manufacturing","query":"影响哪些订单？","context":{"view":"risk","selectedObjects":[{"objectType":"Base","objectId":"obj_base_hefei","label":"合肥"}],"filters":{}}}' | python3 -c "import sys,json;print(json.load(sys.stdin)['taskId'])")
echo "task2=$T2"; sleep 1.5
curl -s "${H[@]}" $AC/api/v1/queries/$T2 > s02c-task2.json
python3 - <<'PY'
import json
t = json.load(open('s02c-task2.json'))
print('status:', t['status'])
print('slots.base:', json.dumps(t.get('slots',{}).get('base'), ensure_ascii=False))
text = "\n".join(b.get('markdown','') for b in (t.get('answer') or {}).get('blocks',[]) if b.get('type')=='text')
print('answer text:', text[:300])
assert t['status']=='COMPLETED'
assert t['slots']['base']['objectId']=='hefei', f"got {t['slots']['base']['objectId']}"
assert '基地=合肥' in text
print('OK-2: 长id obj_base_hefei chip → 规范化 hefei → COMPLETED · 答案含合肥（live 断点b 形状闭合）')
PY
# ③ Model 载荷形态（无 objectId 字段）：澄清注入裸串 CJK 型号名（仅在 props.name）
T3=$(curl -s "${H[@]}" -X POST $AC/api/v1/queries -d '{"packageId":"pkg_battery_manufacturing","query":"新增需求产能可行吗","context":{"view":"plan","selectedObjects":[],"filters":{}}}' | python3 -c "import sys,json;print(json.load(sys.stdin)['taskId'])")
echo "task3=$T3"; sleep 1
curl -s "${H[@]}" $AC/api/v1/queries/$T3 | python3 -c "import sys,json;t=json.load(sys.stdin);print('status(pre):',t['status']);print('intent:',t.get('classification',{}).get('candidates'))"
