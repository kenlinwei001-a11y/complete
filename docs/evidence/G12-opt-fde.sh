#!/usr/bin/env bash
# G-12/G-5 收口 last-mile FDE：真 CP-SAT 活系统全链（非 mock/非 skip/非 graceful-400）。
# 前置：① PORT=4003 python3 services/optimizer/server.py &  ② datacore 起于 :4001（SEED_DEMO=1 SEED_OPT_INDUSTRY=1 OPTIMIZER_BASE_URL=http://127.0.0.1:4003）
set -u
DC=${DC:-http://127.0.0.1:4001}
TMP=$(mktemp -d)
DEMO='X-Debug-User: demo:usr_demo_admin:admin'
LOGI='X-Debug-User: logi:usr_logi_admin:admin'
J(){ python3 -c "import sys,json;print(json.dumps(json.load(sys.stdin),ensure_ascii=False))"; }
hr(){ echo "------------------------------------------------------------"; }

cat > $TMP/bind-battery.json <<'EOF'
{"family":"facility_location","seed":42,"binding":{"id":"bind_battery_fl","tenantId":"demo","templateKey":"facility_location","coeffSource":"property","status":"PUBLISHED","scope":{},
 "roleBindings":[{"role":"facility","bind":{"kind":"objectType","ref":"Base"}},{"role":"client","bind":{"kind":"objectType","ref":"DemandSegment"}},
 {"role":"open_cost","bind":{"kind":"property","ref":"Base.formationCapDaily"}},{"role":"assign_cost","bind":{"kind":"property","ref":"Base.util"}}]}}
EOF
cat > $TMP/bind-logi.json <<'EOF'
{"family":"facility_location","seed":42,"binding":{"id":"bind_logi_fl","tenantId":"logi","templateKey":"facility_location","coeffSource":"property","status":"PUBLISHED","scope":{},
 "roleBindings":[{"role":"facility","bind":{"kind":"objectType","ref":"Warehouse"}},{"role":"client","bind":{"kind":"objectType","ref":"Store"}},
 {"role":"open_cost","bind":{"kind":"property","ref":"Warehouse.openCost"}},{"role":"assign_cost","bind":{"kind":"property","ref":"Warehouse.serveCost"}}]}}
EOF

echo "##### 0. health #####"; curl -s $DC/readyz; echo; curl -s http://127.0.0.1:4003/healthz; echo
hr; echo "##### 1. R3 暗发：未开 opt 租户 → 404 #####"
curl -s -o /dev/null -w "other /opt/templates HTTP=%{http_code}\n" -H 'X-Debug-User: other:u:admin' $DC/a/v1/opt/templates
hr; echo "##### 2. 增量A：demo 电池 facility_location → 真 CP-SAT OPTIMAL #####"
curl -s -H "$DEMO" -H 'content-type: application/json' -X POST $DC/a/v1/opt/solve -d @$TMP/bind-battery.json | J
hr; echo "##### 3. 增量B：非电池 logi provision-world 真物化 #####"
curl -s -H "$LOGI" -X POST $DC/a/v1/growth/provision-world -H 'content-type: application/json' -d '{"scale":"S","seed":42}' | J
hr; echo "##### 4. 增量D：logi 同模板 → 真 CP-SAT（不同最优·R14） #####"
curl -s -H "$LOGI" -H 'content-type: application/json' -X POST $DC/a/v1/opt/solve -d @$TMP/bind-logi.json | J
hr; echo "##### 5. whatif 真重解（改选中设施开仓成本→Δ） #####"
curl -s -H "$LOGI" -H 'content-type: application/json' -X POST $DC/a/v1/opt/whatif -d '{"family":"facility_location","seed":42,"binding":{"id":"b","tenantId":"logi","templateKey":"facility_location","coeffSource":"property","status":"PUBLISHED","scope":{},"roleBindings":[{"role":"facility","bind":{"kind":"objectType","ref":"Warehouse"}},{"role":"client","bind":{"kind":"objectType","ref":"Store"}},{"role":"open_cost","bind":{"kind":"property","ref":"Warehouse.openCost"}},{"role":"assign_cost","bind":{"kind":"property","ref":"Warehouse.serveCost"}}]},"perturbations":[{"kind":"data_override","target":"facilities.WH-002.openCost","value":9999}]}' | J
hr; echo "##### 6. 增量E：绑定落库 + create→solve 闭环 + DF.8 reject #####"
BID=$(curl -s -H "$LOGI" -H 'content-type: application/json' -X POST $DC/a/v1/opt/bindings -d '{"templateKey":"facility_location","coeffSource":"property","status":"PUBLISHED","scope":{},"roleBindings":[{"role":"facility","bind":{"kind":"objectType","ref":"Warehouse"}},{"role":"client","bind":{"kind":"objectType","ref":"Store"}},{"role":"open_cost","bind":{"kind":"property","ref":"Warehouse.openCost"}},{"role":"assign_cost","bind":{"kind":"property","ref":"Warehouse.serveCost"}}]}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "binding id=$BID"; curl -s -H "$LOGI" -H 'content-type: application/json' -X POST $DC/a/v1/opt/solve -d "{\"family\":\"facility_location\",\"bindingId\":\"$BID\"}" | J
curl -s -o /dev/null -w "GhostType 落库 HTTP=%{http_code}\n" -H "$LOGI" -H 'content-type: application/json' -X POST $DC/a/v1/opt/bindings -d '{"templateKey":"facility_location","coeffSource":"property","status":"DRAFT","scope":{},"roleBindings":[{"role":"facility","bind":{"kind":"objectType","ref":"GhostType"}},{"role":"client","bind":{"kind":"objectType","ref":"Store"}},{"role":"open_cost","bind":{"kind":"property","ref":"GhostType.x"}},{"role":"assign_cost","bind":{"kind":"property","ref":"GhostType.y"}}]}'
rm -rf $TMP; hr; echo DONE
