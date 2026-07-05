# QUERY30-RULES · FDE 证据（缺口② C34–C50 十七条入库·真接 evaluate_rules）

> 用户亲定铁律0.4：真实测试·前端看真值·不作假。本单为 datacore 规则层，FDE = 真起 datacore
> 内存模式 → 真 curl → 逐值对照裁决进求解器结论 + params 改值真生效 + S2 审批链真短路。

## 启动（真起服务·内存模式·seed=42）

```
PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs-q30 SEED_DEMO=1 CREDENTIAL_KEY=<64hex> node apps/datacore/dist/server.js
→ datacore listening :4001（SEED_DEMO 电池制造合成数据集就绪）
```

## 1. 17 条规则 RulesPage 可见 + params 参数化（GET /a/v1/rules）

```
$ curl -H 'X-Debug-User: demo:admin:admin' /a/v1/rules | filter C34–C50
count 17
C34 挤占优先级不变量   params={"maxDisplaceDays":5}     status=PUBLISHED
C35 重大变更须≥2方案   params={"minSchemes":2}          status=PUBLISHED
C36 锁价期现金敞口上限 params={"maxLockedExposure":200}  status=PUBLISHED
C37 违约金/毛利权衡线  params={"minNetGain":0}          status=PUBLISHED
… （C34–C50 全 17 条 PUBLISHED·各带命名阈值 params，RulesPage 可见可改）
```

## 2. 规则真进求解器裁决（灭卡面挂名·非只挂 SOLVER_RULE_REFS 标签）

C34 挤占优先级 → 经 affected_orders 真 invoke，evaluatedRules 出真裁决：

```
$ POST /a/v1/solvers/affected_orders/invoke  {"args":{"baseId":"常州","Displace":{"highPriDisplaceDays":8}}}
C34: {"outcome":"BLOCK","expression":"Displace.highPriDisplaceDays > maxDisplaceDays",
      "evidence":"命中违规条件（Displace.highPriDisplaceDays > maxDisplaceDays）"}     ← 8 > 5 触发 BLOCK

$ POST … {"args":{"baseId":"常州","Displace":{"highPriDisplaceDays":3}}}
C34: {"outcome":"PASS", "evidence":"通过（Displace.highPriDisplaceDays > maxDisplaceDays）"}  ← 3 ≤ 5 不触发
```

## 3. RulesPage 改 params 真生效（改 param 即改裁决）

把 C38 供应商集中度红线 `concentrationRedline` 0.6 → 0.8（POST /a/v1/rules 新版 + publish 200）：

```
改前：lta_gap invoke {Supplier:{concentrationPct:0.7}}  → C38 WARN（0.7 > 0.6）
改后（发布 0.8 版）：同输入 0.7               → C38 PASS（0.7 ≤ 0.8）   ← param 齿真生效
```

## 4. S2 审批链真短路（C42/C45/C50 · submit 预检 BLOCK）

```
$ POST /a/v1/action-drafts {"actionTypeKey":"信用额度上调","payload":{"customerId":"E","CreditUplift":{"upliftPct":0.2}}}
HTTP 400
err: "规则预检不通过: C42 信用上调审批链: 违反约束（CreditUplift.upliftPct > approvalThresholdPct）"  ← 0.2 > 0.1 拒
$ 同 actionType，upliftPct:0.05  → 过 C42 预检 → 进审批链（<300）
```

## 5. 诚实边界（RL5·不冒充 PASS）

measured 命名空间不在场（调用方未提供该规则输入）→ 该规则落 `NOT_APPLICABLE`（不注入阈值·不冒充 PASS）。
`test/query30-rules.test.ts` 末条断言 affected_orders 不传命名空间 → C34/C37/C49 全 NOT_APPLICABLE；
credit_exposure 既有 C13/C32 不受影响仍 PASS。

## 6. 齿（真跑·前台读 exit code）

- `test/query30-rules.test.ts`：42 断言全绿（17 条各触发/不触发对 + 17 条 params 改值翻转 + S2 三条 + 诚实边界 NA）。
- revert→红亲验：注释掉 `service.ts ruleEvalPayload` 的 `Object.assign(base, rule.params)` 阈值注入 → C38 触发用例由 WARN 掉成 PASS（`expected 'PASS' to be 'WARN'`）→ EXIT=1；恢复即绿。证明规则真评估依赖注入、非装饰。
- 回归：`rules-p3-payload.test.ts`(8) + `rules-p3-payload-11solvers.test.ts`(13) + `synthetic/solvers/dsl/object-change-action/sop-actions/admin-self-approval`(49) 全绿——既有规则/求解器/Action 不回退。
- 门：`rule-closure:check` 定义 45 · 引用 43 · 缺失 0 ✓（C34–C50 均一等定义，无悬空引用）。

## 诚实边界（分期）

- 本单规则挂**现有求解器**真评估（affected_orders/plan_generate/credit_exposure/lta_gap/… 13 个宿主）。
  DESIGN §2.5 的**新求解器**（what_if_displacement/multi_plan_compare/labor_balance/cash_projection/
  signal_propagation 等）属 **QUERY30-ORCH** 单——ORCH 落地后可把相应规则迁挂新求解器的原生口径
  （C34→what_if_displacement / C35→multi_plan_compare / C41→labor_balance …），measured 由新求解器真产出而非调用方 args。
- measured 值范式：同 C33 `destination` ——求解器不造 measured，由调用方真实业务输入或求解器真实产出（C35 方案数/C37 净增益）驱动；不哈希/不兜底冒充真值。
