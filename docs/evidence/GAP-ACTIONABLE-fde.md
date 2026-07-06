# GAP-ACTIONABLE · FDE 真验记录（WO-3 · PRD-trustworthy-self-accounting §3.4 · 修 P3）

> 2026-07-06 · 直接复现用户实测痛点「常州基地的瓶颈是?」→ 工单页看不到补什么/在哪补。
> **无 LLM key 环境**：以 scripted classify 注入**真实 evidence**（orchestrator `sanitizeLlmAuthLeak`
> 在无 provider/密钥无效时归一的 `LLM_PURPOSE_UNBOUND` 错因串）复现终态 → 观察 `classifyGap` 真产出。
> 不作假：下列 JSON 全为 `apps/agentcore/dist/growth/probe.js` 编译产物的真实返回值，非手写。
> 诚实注：真起双服务 + 真 Kimi 端到端答出属**审核方复验环节**（本机无 key）；本记录锁定的是根因修复的确定性纯函数真值。

## 根因（PRD §3.4）

| 痛点 | 根因（file:line） |
|---|---|
| 工单页看不到补什么/在哪补 | `probe.ts` `codeFromError` 未映射 `LLM_PURPOSE_UNBOUND` → 拍 `OTHER` → `FILL.OTHER="人工核实内部错误"`（丢弃真实可行动错因） |
| 对象类型=dash | `scenario-grow.ts` `objectType \|\| view \|\| "Object"` + `server.ts` `refObjectTypes=[...ctxTypes, ...(view?[view]:[])]` 把**视图键**当对象类型泄漏进 DataRequest.typeKey / GrowthTicket.ontologyRefs.objectTypes |

## 修三处

1. **`probe.ts` 去 OTHER catch-all 丢真相**：`LLM_PURPOSE_UNBOUND`（含鉴权泄漏签名 `could not resolve authentication`/`x-api-key`…）
   **入正式缺口码表**（新增缺口码 · `codeFromError` 显式映射 · `gapDisposition=NEEDS_HUMAN` 穷尽 switch）；未映射码仍归 `OTHER` 但**保留 evidence 原文**。
   新增 `actionableFill(code,question)` 为**每个** finding 派生 `{what 缺什么 · where 补在哪 · acceptance 验收=本问句 NL 真跑 E2E 答出}`（`GapFinding` additive 三元）。
2. **`scenario-grow.ts` + `server.ts` 视图键泄漏**：`typeKey`/`ontologyRefs.objectTypes` 只收**显式声明的对象类型**（`selectedObjects[*].objectType`），缺失回落 `"Object"`——**绝不把视图键（dash/risk）冒充对象类型**。
3. **`FILL.OTHER` 改可行动导语**（据 evidence 原文定位）——**永不「人工核实内部错误」/「dash」**。

## 真验 ① · 「常州基地的瓶颈是?」→ actionable gap（非 OTHER）

注入真实 evidence（`LLM_PURPOSE_UNBOUND` 错因串）+ `context.view="dash"`（无显式对象类型），`classifyGap` 真产出：

```json
{
  "question": "常州基地的瓶颈是?",
  "verdict": "BLOCKED",
  "path": "WORKFLOW",
  "findings": [
    {
      "gapCode": "LLM_PURPOSE_UNBOUND",
      "atStep": "classify",
      "evidence": "LLM_PURPOSE_UNBOUND: LLM 用途未解析到可用 provider 或密钥无效——请在 设置→LLM 用途绑定 配置 provider 与密钥",
      "blocking": true,
      "what": "LLM 用途未解析到可用 provider 或密钥无效",
      "where": "设置→LLM 用途绑定（配置 provider 与有效密钥）",
      "acceptance": "验收=「常州基地的瓶颈是?」经 NL 真跑 E2E 答出真实承载数据（非空投影、过诚实门）",
      "suggestedFill": "缺什么：LLM 用途未解析到可用 provider 或密钥无效；补在哪：设置→LLM 用途绑定（配置 provider 与有效密钥）；验收=「常州基地的瓶颈是?」经 NL 真跑 E2E 答出真实承载数据（非空投影、过诚实门）"
    }
  ]
}
```

**核对**：`gapCode=LLM_PURPOSE_UNBOUND`（**非 OTHER**）· `what/where/acceptance` 三元齐 · `suggestedFill` 含真修法「设置→LLM 用途绑定」· 无「人工核实内部错误」· evidence 原文保留。

## 真验 ② · 未映射内部错误也 actionable（永不「人工核实内部错误」）

注入一个**未归类**的内部错误码（`WEIRD_X`），验证去 catch-all 后仍诚实可行动：

```
OTHER finding suggestedFill: 缺什么：未归类内部错误（真实 evidence 原文已保留）；补在哪：据 evidence 原文定位真实断点后补齐（非人工兜底占位）；验收=「常州基地的瓶颈是?」经 NL 真跑 E2E 答出真实承载数据（非空投影、过诚实门）
OTHER contains 人工核实内部错误? false
OTHER evidence preserved?   WEIRD_X: unexpected internal z
```

**核对**：即便落 `OTHER` 码，`suggestedFill` **不含「人工核实内部错误」** · evidence 原文（`WEIRD_X: unexpected internal z`）完整保留。

## 真验 ③ · 视图键 dash 不再冒充对象类型

`POST /api/v1/growth/run`（`context.view="dash"`, `selectedObjects=[]`）→ 工单 `ontologyRefs.objectTypes`
**不含 "dash"**（`growth-autofill.test.ts` 端点齿断言 `not.toContain("dash")` / `not.toContain("risk")`）。
此前 `refObjectTypes` 把 view 键混入 → 工单页「对象类型=dash」；修后仅显式对象类型（缺失则空/`"Object"`，诚实缺失）。

## 齿（revert → red）

| 齿测试 | 断言 | revert → red |
|---|---|---|
| `growth-probe.test.ts` | 注入 `LLM_PURPOSE_UNBOUND` evidence → `gapCode=LLM_PURPOSE_UNBOUND` + suggestedFill 含「设置→LLM 用途绑定」+ 非「人工核实内部错误」 | 注掉 `codeFromError` 映射 → 拍回 `OTHER` → **红**（已实测：`expected 'OTHER' to be 'LLM_PURPOSE_UNBOUND'`）|
| `growth-autofill.test.ts` | 工单 `ontologyRefs.objectTypes` **not.toContain** dash/risk | 恢复 `refObjectTypes=[...ctxTypes,...(view?[view]:[])]` → **红**（已实测：`expected [ 'dash' ] to not include 'dash'`）|
| `scenario-growth-loop.test.ts` | `gapDisposition` 遍历 `GapCodeSchema.options` 穷尽（新增 `LLM_PURPOSE_UNBOUND` 已分类） | 未分类新码 → 编译期 `never` 红 |

## 亲跑（EXIT=0）

```
npx vitest run test/growth-probe.test.ts test/growth-autofill.test.ts test/scenario-growth-loop.test.ts \
  test/growth-worklist-human-fill.test.ts test/ticket-center.test.ts test/boundary-guardrail.test.ts
→ Test Files 6 passed (6) · Tests 36 passed (36) · EXIT=0
pnpm --filter agentcore build → 0 err
```

## 本体回写

`docs/SYSTEM-ONTOLOGY.md §3`「launch 确定性链 + 缺口诚实处置链」`classifyGap → GapReport` 下新增 GAP-ACTIONABLE 三点
（去 OTHER catch-all + actionable 三元 + 视图键≠对象类型）；`pnpm ontology:slices` 已重生成 11 切片。
