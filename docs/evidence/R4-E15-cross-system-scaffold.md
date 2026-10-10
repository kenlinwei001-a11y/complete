# C·E15 跨系统 scaffold → QOS → 真推演 · 真跑实勘 + 修复 + 诚实边界

> 评审打回（REVIEW-VERDICT §1 轨C）："E15 ❌——scene 全 PENDING_BSTACK、DRAFT scene 从未真注册进 QOS 启动器、'点击推演'是 DataCore BUILD_STATIC 静态答没碰 agentcore"。
> 本文件是主线**亲手起双服务逐步实勘**的真相（比原结论更精确）+ 一处真修复 + 诚实边界。

## 1. 逐步真跑实勘（datacore:4001 ⊕ agentcore:4002，AGENTCORE_BASE_URL 互配）

| 步骤 | 真跑结果 |
|---|---|
| **未配 AGENTCORE_BASE_URL**（评审/默认态） | scaffold 不下发、inferenceProbe 兜底 → **BUILD_STATIC**（评审看到的"没碰 agentcore"= 此态） |
| **配 AGENTCORE_BASE_URL（wired）跑故事** | status SUCCEEDED · scaffold **18 项全 SCAFFOLDED**（非 PENDING_BSTACK）· inferenceEvidence=**RUNTIME_PROBE**（真碰 agentcore QOS） |
| scaffold 是否真建 DRAFT 对象 | **是**——`/b/v1/internal/scaffold` 真 createPlan/createIntent/scenarios.upsert(DRAFT)：实测 `scene_shared_bottleneck`（intent_shared_bottleneck/targetView risk/status DRAFT）真存在 |
| 启动 DRAFT 场景 | `/launch` 返 **INVALID_STATE「场景未发布（DRAFT），不可启动」**（launcher 只放 PUBLISHED）→ 评审"未注册进启动器"= 此（DRAFT 不进 launcher 目录） |
| **修复前** grow DRAFT 场景 | 报 `query: Too small`——**scaffold 建的场景 triggerQuestion 为空**（`server.ts:1868 triggerQuestion:""`）→ 无问可跑、断链 |

## 2. 真修复（本次返工）：scaffold 场景带触发问句
**改 3 处**（故事即问句，"建出来的域真能答这条故事吗"）：
- `contracts/databuilder.ts PlanSceneNeedSchema += triggerQuestion?`
- `databuilder/comprehend.ts`（两条 deriveBStack 路径）：sceneNeed.triggerQuestion = script（截 500）
- `agentcore server.ts` scaffold handler：`scene.triggerQuestion = sn.triggerQuestion ?? ""`

**修复后真跑**（同故事重跑）：
- scaffolded `scene_shared_bottleneck.triggerQuestion` = "某条化成工序共享一台瓶颈设备……" ✅（不再空）
- grow 该 DRAFT 场景 → `verification.status=NOT_RUN, gapCode=**INTENT_NOT_PUBLISHED**, disposition=AUTO_DERIVE`，
  detail「意图 intent_shared_bottleneck 未绑定执行计划（workflow）」，rings{data:false, ontology:true, capability:false}。

## 3. 诚实结论（E15 = ◐，非 ✅ 非 ❌）
- **✅ 已坐实可用**：跨系统 scaffold 真下发并材化 DRAFT 场景+意图+计划（18 SCAFFOLDED）；inferenceProbe 真碰 agentcore QOS（RUNTIME_PROBE，非 BUILD_STATIC）；本次修复让 DRAFT 场景**可 grow/verify**（带问句）；grow **诚实门**给出精确缺口 `INTENT_NOT_PUBLISHED`（非静默、非假答、disposition AUTO_DERIVE）。
- **❌ 未达**：「末步重跑**真出答案**」——freshly-scaffolded 的 DRAFT 意图**未发布、未绑定已发布计划** → grow 的 capability 环 false → 跑不出答案。**这是与 F·O9 同一道 RL4 墙**：要真出答案须把意图+计划**发布**（R4 门控动作），不能自动发布（违 RL4 放水）。
- **评审结论校正**：评审"没碰 agentcore/PENDING_BSTACK"是**未配 AGENTCORE_BASE_URL** 的默认态；wired 后 scaffold/RUNTIME_PROBE 真生效，真正的墙是 `INTENT_NOT_PUBLISHED`（R4），非"没碰 agentcore"。
- **E15 处置**：本体 §8 G-8 由 ❌ 校正为 **◐**（scaffold+RUNTIME_PROBE+可 grow 的诚实门已落；真出答案受 R4 所限，与 O9 同墙，待真人/code-agent 经正门发布意图+计划后下次 grow 可 GOVERNED）。

## 4. 复现
```bash
PORT=4001 ... SERVICE_TOKEN=svc AGENTCORE_BASE_URL=http://127.0.0.1:4002 node apps/datacore/dist/server.js &
PORT=4002 DATACORE_BASE_URL=http://127.0.0.1:4001 SERVICE_TOKEN=svc node apps/agentcore/dist/main.js &
curl -s -X POST :4001/a/v1/databuilder/runs -H X-Debug-User:demo:admin:admin -d '{"script":"某条化成工序共享一台瓶颈设备…","seed":42,"inference":true}'  # → 18 SCAFFOLDED / RUNTIME_PROBE
curl -s :4002/b/v1/scenarios/scene_shared_bottleneck -H X-Debug-User:demo:admin:admin   # → triggerQuestion 非空
curl -s -X POST :4002/b/v1/scenarios/scene_shared_bottleneck/grow -H X-Debug-User:demo:admin:admin -d '{}'  # → gapCode INTENT_NOT_PUBLISHED（诚实门）
```
