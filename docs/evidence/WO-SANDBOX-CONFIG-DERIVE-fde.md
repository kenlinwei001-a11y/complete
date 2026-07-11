# WO-SANDBOX-CONFIG-DERIVE · propagation_rule/state_var need 从需求图传导语义真派生 — FDE

> 铁律 0.4：真派生·确定性 R6（LLM mock）·绝不 stub/mock 冒充。补 S0 §3.4 悬置接缝（comprehend 把两 kind 的推导 punt 给 RG/S1·= Dev-1）。
> 域划界：落点 agentcore `growth/pre-analyze.ts`（我域）+ contracts；⛔ 未碰 databuilder `comprehend.ts`/`service.ts`/`closure.ts`（Dev-2）。与 BSTACK-DERIVE 划界：BSTACK 绝不碰 propagation_rule/state_var·本单专责这两 kind。

## 接缝（不碰 comprehend·从我域喂覆盖引擎）

`deriveSandboxConfigNeeds`（`packages/contracts/src/sandbox-config-derive.ts`·纯函数 R6）消费**已构 RequirementGraph 的传导语义**（`HiddenReqGraph.edges` 真 LinkType·扰动事件·affects 边），沿真链路产 `propagation_rule`/`state_var` need（每 need 引真本体类型/链路·零幽灵·同 requirement-graph:check 白名单纪律）。接线在 `growth/pre-analyze.ts` `preAnalyzeQuery`——把派生的两 kind need 并入 `required`，S0 的覆盖/gap 引擎照旧 diff EXISTS/MISSING（comprehend 现空数组由我侧喂满·未改 comprehend）。**暗发 `growth.sandbox_config_derive`**（双注册 datacore features.ts + agentcore registry.ts·defaultOn:false·feature-parity 门守）——关闸 = 只诊断意图静态声明的配套（S0 原行为字节一致·NG6）；开闸才沿传导语义派生。

## green→red 齿（`apps/agentcore/test/sandbox-config-derive.test.ts`·8 齿）

- **T1 green→red**：含传导语义故事「设备故障导致产线停机20%，传导到订单交付延期」→ `deriveSandboxConfigNeeds` 沿真链路（Equipment→Line→Order）产 `propagation_rule` + `state_var` need。**S0 前该数组恒空 = 红**；本单派生非空 = 绿。
- **T2 no-false-positive**：纯查询（无扰动事件/无 affects 边）→ 零派生（绝不凭空报配套需求·不假阳）。
- **T3 affects 边触发**：链路语义「影响」（传导本身·无显式扰动事件）→ 亦触发（传导即需配套）。
- 其余齿：每 need 引真本体类型/链路（越界丢弃）· R6 双跑字节一致 · 关闸零派生。

## 验证

- `pnpm --filter @platform/contracts build` + `agentcore` + `datacore` build 绿。
- 齿 `sandbox-config-derive.test.ts` **8/8 绿**（T1 green→red + T2 无假阳 + T3 affects + R6）。
- **双注册**：`growth.sandbox_config_derive` 在 agentcore registry.ts + datacore features.ts 各恰一次·`feature-parity:check` EXIT=0（漏一即红）。
- `ontology-writeback:check` + `ontology-slices:check` 绿（§2.I 传导派生回写·母体 hash 3950adef）。
- agentcore 全量测试绿（含新 8 齿·零回归）。
- ⛔ comprehend/service/closure 未改（Dev-2 域安全）·关闸 = S0 原行为字节一致（NG6）。

## 诚实边界

- 派生器确定性 R6（LLM mock per 铁律0.4）——传导语义识别走 RequirementGraph 已构的真 LinkType/扰动事件（结构化·非 LLM 现编）。Kimi LLM 理解层可选真跑但非本单核心（deriver 是确定性结构派生）。
- 本单只做**推导侧**（产 need）；need 落 EXISTS/MISSING 的覆盖判定 + provisioner 归 S0（已 DONE）。传导规则的系数/formula 仍 autoCreatable:false（MISSING→工单·领域判断·诚实）。
