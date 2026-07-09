# UPG-L0-PREANALYSIS · FDE 真跑证据（铁律0.4·不作假）

真起双服务（内存模式·SEED_DEMO）· datacore:4051 · agentcore:4052（DATACORE_BASE_URL 指向 4051·SERVICE_TOKEN 同值）。
认证走真 JWT（demo/admin/demo1234·RS256）——暗发门只有真 JWT 链路才生效（X-Debug-User 无 token → FeatureGate
对 DataCore features 拉取失败即 fail-open ALL，不能演示暗发；故本证据用真 JWT）。

## C3 回退演练（暗发 defaultOn:false·关=改造前系统）
- override `growth.pre_analysis=false` → invalidate FeatureGate 缓存 → submit query → `GET /b/v1/growth/pre-analysis/:taskId`
  → **HTTP 404 `{"error":{"code":"FEATURE_NOT_FOUND"}}`**（关时后台不起、端点不存在·旧路径零变化）。

## C2 真跑（flag ON）
- override `growth.pre_analysis=true`+`databuilder.registry-snapshot=true` → invalidate → 提交 in-catalog 问句
  「常州基地的瓶颈根因是什么」→ 后台预分析产 PreAnalysisReport（status=DONE）。
- 引擎**真组两侧 existing 并调共享 diffGap**（@platform/contracts）：
  - A 栈经 `GET /a/v1/databuilder/registry-snapshot`（SERVICE_TOKEN·6 类·snapshot solver=49/slice=48/rule=45）
  - B 栈查 agentcore repos（intent/skill/agent）
  - 该问句 classify→`risk_root_cause`，其 MaterializedIntent.bindings 展开：
    rule C06/C11=EXISTS · slice slice_risk_root_cause=EXISTS · solver risk_timeline=EXISTS ·
    intent risk_root_cause=EXISTS · skill skl_risk_diagnosis=EXISTS · agent agt_risk=EXISTS
  - **totalGaps=0 · coverageScore=1.0**（demo 是全闭合系统·所有绑定真存在·诚实"无缺口"·非假绿）。
- **R6 同 query 双跑字节一致**：两个 taskId 的 `gapAnalysis`(去 generatedAt)+`summary` `JSON.stringify` 全等 → **true**。
- **R2 跨租户隔离**：tenantB 取 demo 的 taskId → **HTTP 404 PRE_ANALYSIS_NOT_FOUND**；owner(demo) 同 taskId → 200。

## 缺口分支（TO_CREATE/MISSING/WARNING/DEVELOP）证明
demo 为全闭合系统，任何 in-catalog 问句的绑定都真存在 → 自然无缺口（诚实）。缺口分支由单测
`apps/agentcore/test/pre-analyze.test.ts` 用**同一真 diffGap + 真内存 repos** 覆盖：
solver 未命中→MISSING(severity WARNING·remediation DEVELOP·§10 永不 BLOCKER)、intent 未发布→TO_CREATE、
A 栈快照不可达→诚实降级不诊断该侧（不造假缺口）、R6 注入 generatedAt 字节一致。

## 门禁（C4）
ontology(55/55 事件·49/49 solver) ✓ · retention-coverage ✓ · no-fake-done ✓ · prd:check ✓ · ontology-slices ✓ ·
contracts test 24 ✓ · agentcore pre-analyze(4)+endpoint(3) ✓ · 三包 build ✓。

进程按 PID kill（非 pkill）。无任何密钥落盘（SERVICE_TOKEN/CREDENTIAL_KEY 仅 env·本文件不含明文）。
