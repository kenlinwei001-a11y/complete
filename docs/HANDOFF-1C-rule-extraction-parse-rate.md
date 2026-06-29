# HANDOFF · 1C — 规则文档抽取解析率（A2 extraction · Kimi 复杂 schema 保真）

> **来源**：WO-1（LLM 用途接缝根治）的 P2 次生项 1C，dev 已诚实标注**未闭**（`docs/evidence/WO-1-llm-seam-fde.md` §1C），由审核方据此独立开为**单张工单**，发开发 agent 实装。
> **角色**（铁律0.5）：本工单是审核方的**设计 + 验收基线**；dev 照它实装 + 自验贴证，审核方按 §真值判据**独立真跑复验**后核发闭合。
> **优先级**：P2（不阻断主链；但它是「真连接器接入臂」里**规则文档抽取那一条**真能用的前提）。
> **独立性**：与 WO-1 的接缝修复**互补不重叠**——WO-1 已解「未绑凭据→裸泄漏 SDK 串」（错误信封），本单解「绑了真 Kimi、调用成功，但**复杂抽取 schema 解析不出候选**（candidateCount=0）」。

## 1. 现象（真值·dev 已实测）

```
demo（已配 Kimi kimi-k2.6）POST /a/v1/rule-docs（3 条中文规则·真打 Kimi）
→ status=PARTIAL · candidateCount=0
→ 段 0 status=FAILED「LLM returned unparseable output」
```
即：A2 规则抽取臂在真 LLM 下**产不出任何规则候选** → 规则文档审核台（`/admin/rule-docs`）上传后永远空 → 「文档→规则候选→入规则库」这条正门断在第一跳。

## 2. 根因（对码定位·接缝在 LLM 适配器 parse 路径）

- 抽取走**原生结构化输出** `OpenAiLlmClient.parse()`（`packages/llm-adapters/src/openai.ts:294-319`）：
  `response_format: json_schema(strict:false)` + **单次** `JSON.parse(extractJsonText(content))` + **单次** `schema.safeParse` → 任一失败即 `return null` → 上层 `LlmParseError` → 段 FAILED。
  **关键：此路径无任何重试**（对比 `structuredOutput:false` 的 JSON-mode 降级路有 retry≤2，但据 dev 深扫该路对此 schema 亦 unparseable）。
- Kimi-k2.6 对**复杂嵌套抽取 schema**（规则候选数组：每条含 code/expression/scopeObjectTypes/severity/rationale…嵌套）的 `json_schema` 保真度不足 → 输出结构偏离 → `safeParse` 失败 → null。
- **非用途接缝问题**（WO-1 已证 classifier/agent 用同一 provider 真打 Kimi 正常）；是**该模型 × 该 schema 复杂度**的解析率问题。

**本体引用**（铁律0）：链路 `RuleDoc → (extraction 用途·LLM) → RuleCandidate → ExtractSegment → 入 Rule 库`（本体 §2 D3 规则域 · §「RuleDoc/RuleCandidate/ExtractSegment」· 用途绑定 `extraction`，本体 §6 LlmPurposeBinding）。本单**只改抽取解析鲁棒性，不改链路接线/对象/门禁** → 预计**不回写本体**（若改了 schema 形状或新增重试事件则回写 §2 对应段）。

## 3. 三个方向（审核方评估 · dev 据情择优组合，不强指定实现）

| 方向 | 评估 | 建议 |
|---|---|---|
| **① 降抽取 schema 复杂度** | 根因解之一：把「一次性产出完整嵌套候选数组」拆成**扁平/分步**（先抽 expression 文本 + type，再二跳结构化补 scope/severity），单跳 schema 越简单 Kimi 保真越高 | **主**（治本：复杂 schema 是解析失败主因） |
| **② 原生 parse 加重试** | `parse()` 当前**零重试**——加 retry≤2（safeParse 失败→带「上次输出不合 schema，请严格按 schema 重出」的纠错重提），与 JSON-mode 路对齐 | **主**（低成本兜底：单次失败概率高，重试显著拉升通过率） |
| **③ 强约束 prompt** | 抽取 prompt 加**少样例（few-shot）+ 字段级硬约束 + 「只输出 JSON、无围栏无解释」** | **辅**（提升单次保真，配合①②） |

> 审核方倾向 **①+②为主、③为辅** 的组合（治本 + 兜底）。**禁止**为过门把 candidateCount 造假/塞兜底假候选（dev 本就没造假，本单延续这条红线）。

## 4. 真值判据（FDE oracle · 审核方独立真跑复验）

起真服务（live datacore + 真 Kimi），**真 curl**（非 vitest mock）：
```bash
H='X-Debug-User: demo:admin:admin|planner|catalog_admin'
curl -H "$H" -X POST :4001/a/v1/rule-docs -d '{ <3 条中文业务规则文本> }'
```
- **判据①**：`candidateCount ≥ 3`（3 条规则各出 ≥1 候选）· 段 `status != FAILED`（不再「unparseable」）。
- **判据②**：候选**结构合法**——每条含可被规则库消费的 `expression`（本体口径 `Type.field <op> number` 可解析）+ scope，能**真进规则库**（`/admin/rules` 可见 / 被 evaluate_rules 引用）。
- **判据③ R6/诚实**：解析失败的段**如实报 FAILED 不静默塞假候选**（保留 WO-1 的诚实降级红线）；重试是确定性策略（不依赖 wall clock 随机）。
- **判据④ 不破坏既有**：`pnpm --filter datacore test` 仍全绿（classifier/modeling 用同一 parse 路不退化）；`pnpm -r build` 绿。
- **落点可见性**：上传 → 规则文档审核台真出候选列表（非空壳）→ 采纳 → 规则库可见（端到端 UI 真看，非仅 API）。

## 5. 边界（不在本单）

- 不改 QOS Path B 流式/延迟（那是 **WO-Q1**，另单）。
- 不要求换模型；若 dev 评估「Kimi-k2.6 对此类抽取天花板低」可在证据里诚实标注并建议（如抽取用途绑非推理快模型），但**本单先穷尽①②③再议换模型**。
- 不扩大到结构化连接器臂（CSV/Excel/HTML 原型 intake 那条本体记 G-6 ✅，由审核方另行真跑复验，与本单无关）。

## 6. 交付物（dev）

- 实装 ①②③ 的组合 + `docs/evidence/1C-extraction-fde.md`（真 curl 贴 candidateCount + 段状态 + 规则库落点截图/响应，FDE 逐条对判据）。
- 自验：判据①-④ 全过 + `pnpm -r build`/`--filter datacore test` 绿。
- 若改了抽取 schema 形状/新增事件 → 回写本体 §2 对应段。
