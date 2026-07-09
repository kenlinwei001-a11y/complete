# UPG-L0-CLASSIFY-FUSE · 真跑证据（fuseClassification 确定性 ⊕ LLM 融合）

PRD: docs/PRD-upstream-classify-precision.md §4 (A1)。暗发开关 `QOS_CLASSIFY_FUSE`（defaultOn:false·RL2）。

## 环境（真起双服务·内存模式·无真 LLM provider）
- datacore: PORT=4001 SEED_DEMO=1 SERVICE_TOKEN=svc（node apps/datacore/dist/server.js）
- agentcore: PORT=4102 DATACORE_BASE_URL=http://127.0.0.1:4001 SERVICE_TOKEN=svc（node apps/agentcore/dist/main.js）
- 查询：POST /api/v1/queries · packageId=pkg_battery_manufacturing · query=「常州物料齐套为什么这天越线」
  · context={view:risk,selectedObjects:[],filters:{}} · x-debug-user=demo:user-planner:planner

## C2 · QOS_CLASSIFY_FUSE=1（融合 ON）
- taskId: task_01KX3QE08B8ME3BGN3N41CNWDN
- status: AWAITING_CLARIFICATION   path: (未落 agent·非 Path B)
- classification: {"candidates":[{"intentKey":"risk_root_cause","confidence":1}],"outOfCatalog":false,"model":"deterministic:example-match"}
- 说明：无真 LLM → classify 返 null → 融合 ① 分支（纯确定性 deterministicClassifyFromScores）命中 Path-A 意图 risk_root_cause
  → 澄清（索要槽位），**未**兜底落 Path B agent。qos_classifier_errors_total=1（LLM 失败恒计数）。
  qos_classify_fuse_rescued_total=0（① 分支无 LLM 不计"救回"；救回=②LLM present-but-weak，见单测/应用级测）。

## C3 · 回退演练（QOS_CLASSIFY_FUSE 未设·融合 OFF）
- taskId: task_01KX3QF56T7RXP1VQETK02AVY9
- status: AWAITING_CLARIFICATION   path: (非 Path B)
- classification: {"candidates":[{"intentKey":"risk_root_cause","confidence":1}],"outOfCatalog":false,"model":"deterministic:example-match"}
- qos_classify_fuse_rescued_total=0
- **等价结论**：OFF 与 ON 对同输入产出**逐字段一致**（risk_root_cause conf1·deterministic:example-match·AWAITING_CLARIFICATION）。
  无 LLM 时融合 ① 退化 == 现行 `llmClassification ?? deterministicClassify` → 关闸=改造前系统（RL2 暗发·可证回退）。

## 融合价值增量（rescue）由测试承重（真起服务无真 LLM 无法造 present-but-weak）
- test/router-classify-fuse.test.ts：
  · ① LLM 无 → 纯确定性；② 救回（det≥0.5 补入·rescued=true·脱离 Path B）；③ 一致性加成 ×(1+β)；④ 冲突不硬塞（维持 LLM 澄清）；
  · R6 同输入字节一致；关闸等价（no-op fuse == 输入 llm 逐字段）。
  · 应用级：QOS_CLASSIFY_FUSE=1 + LLM outOfCatalog + det 强命中 → qos_classify_fuse_rescued_total 0→1 且落澄清（非 agent）；
    关闸同问句 → 救回指标不动（改造前系统）。
