# 审核方复验核发 · T0–T4 交付（7c6e8f2）

> dev 报「全部完成并推送（7c6e8f2）：T0 前端 3 测修复 / T1 rule-docs 抽取异步化 / T2 §3③ 结构化重述 / T4 answer.delta 批量化 / T3 逐字流真浏览器实拍」。
> 审核方按纪律默认每项**未闭**，独立真跑复验（拓扑构建 + 亲手跑三套测 + curl oracle + 真浏览器实拍·真 Kimi），核发如下。

## 结论速览

| 项 | dev 称 | 审核方独立真跑判据 | 核发 |
|---|---|---|---|
| **build 底线** | （未提） | `pnpm -r build` 拓扑构建（contracts 先）→ **`sseScripts.ts:34` TS2353 红**（`intentKey:null` vs `string\|undefined`） | ❌**抓出·已 unblock** |
| **T0** 前端 3 pre-existing 失败 | 118文件/289测全绿 | 亲跑 `pnpm --filter frontend-shell test` | ✅ **289/289** |
| **T1** rule-docs 抽取异步化 | 784 测全绿·3 测改异步 | 亲跑 datacore 测 **+ 真 Kimi curl 端到端** | ✅ **闭合**（见下） |
| **T2** §3③ 结构化重述 | qos-b 收敛+floor ✓ | 亲跑 agentcore 测 + 读源审 degrade 链 + 真浏览器 | ✅ 代码+单测+整合捕获 |
| **T3** 逐字流真浏览器实拍 | Chromium 实拍 PNG | **审核方自跑 Chromium 真 Kimi** 复拍 | ✅ **实拍复现** |
| **T4** answer.delta 批量化 | agentcore 354 全绿 | 亲跑 + 读源审无丢字 + 真浏览器逐字流可见 | ✅ |

三套测审核方亲跑：前端 **289/289** · datacore **784 passed/3 skipped** · agentcore **353 passed/1 skipped**（skip 为 `a14-real-kimi` 真 key 门控，正确）。

---

## ❌→✅ build 底线：dev「全绿」漏了 `pnpm -r build`（tsc-red 当绿出）

- **现象（审核方真跑）**：`pnpm -r build`（拓扑序·contracts 先构建·非陈旧 dist）→ `apps/frontend-shell/src/mocks/sseScripts.ts(34,7): error TS2322: Type 'null' is not assignable to type 'string | undefined'`。
- **根因**：T3 新增「逐字流」mock 脚本块 `intentKey: null`，但 `TaskScriptPlan.intentKey?: string`。**vitest 走 esbuild 不做类型检查 → 289 测照绿，但 `tsc --noEmit`（生产构建）红**。这正是平台第一性原则「**绿测试 ≠ 能用**」的翻版：测试绿掩盖构建红。
- **CLAUDE.md 交付底线明文**：`pnpm -r build && pnpm -r test # 4 包全绿是交付底线`。dev 只跑了 test、没跑 build（或忽略其红）。
- **审核方处置**：施最小 unblock（`null`→`undefined`，零歧义）→ `pnpm --filter frontend-shell build` 复绿（该错为唯一构建错）。以**明确标注的审核方 build-unblock 提交**入库，保留「dev 出 tsc-red」问责链、不静默掩盖。
- **给 dev 的硬要求**：宣布「完成」前必须本地真跑 `pnpm -r build`；若 WO-0 gates 链含 `build` 步，须在推送前真跑 gates（本次显然未跑）。

## ✅ T1 rule-docs 抽取异步化（端到端真 Kimi 闭合·headline）

- **读源审**：`uploadAndStartExtraction` = `prepareDoc`（快·blob/解析/分段→`EXTRACTING`）+ fire-and-forget `runExtraction`（慢·真打 LLM）；错误兜底落 `PARTIAL` + `extractError` + metrics（**不静默吞**）；保留同步 `uploadAndProcess` 供测试/CLI；`flushExtractions()` 测试 seam。契约补 `EXTRACTING`/`PARTIAL`。设计干净，正是 1C 我建议的异步跟进。
- **真 Kimi curl 端到端**（datacore 内存模式·Kimi k2.6 seeded·AES-GCM 落库不回显·R5）：
  - `POST /a/v1/rule-docs`（3 条中文规则）→ **HTTP 202 · status:EXTRACTING · candidateCount:0 · 0.465s 返回**（**非 314s 阻塞**·证异步非阻塞）。
  - 轮询 `GET /:id` → `EXTRACTING` 持续 ~72s → **`IN_REVIEW`**（后台真打 Kimi 抽取收敛）。
  - `GET /:id/candidates` → **3 候选**（规则一 `Capacity.weeklyP90 < Order.demandQuantity` BLOCK / 规则二 `Material.kittingShortage > NetDemand*0.15` WARN / 规则三），`status:PENDING`·`droppedCandidates:0`·`IN_REVIEW`（无 FAILED 段）。
- **判据达标**：异步非阻塞 ✓ · 后台收敛终态 ✓ · `candidateCount≥3`（1C 解析率经异步路径仍成立）✓ · 诚实（IN_REVIEW 非 PARTIAL）✓。

## ✅ T2/T3/T4 整合真浏览器实拍（真 Kimi Path B·当前码）

审核方自跑 Chromium（真后端三服务·真 Kimi）提交开放式综合问句「综合评估常州基地的运营韧性，结合设备、物料、订单三方面给出三条改进建议」：

- **[t+28s] 逐字流（`task-streaming`）✓** — T4 批量化 `answer.delta` 逐帧渲染，终答前实时可见。
- **[t+28s] 思考折叠（`task-reasoning`·Kimi `reasoning_content`）✓** — T3。
- **[t+188s] `answer.final` → 切 AnswerCard（逐字流隐去）✓** — T3。
- **终答 = 满富数据接地答复**（非 degrade/floor）：classify→4×discover→11×query_objects→接地答案，引真对象（SO-3476/assembly-E2/coating-E2…）、真指标（OEE 0.733、节拍 1.59s、波动率 0.48、信用 1.15 超授信）、三条 设备/物料/订单 改进建议、`[0]` 溯源标 + **「⚠️ 部分数字未能溯源，仅供参考」诚实徽章**。
- **§3③ 真值**：上轮同问句预算耗尽落 floor，本轮（当前码）**收敛到富答案**；T2 结构化重述（读源审：`lastText || restated || 原始推理floor || 死答` 链·单次无工具·floor 保留·8 处 `degrade` 全转 `await`）是其**下方安全网**——本次走 happy-path 富答未触发 degrade 分支，restate 兜底层由读源+单测（qos-b 收敛+floor）坐实。
- **T4 无丢字（读源审）**：每字入 `pendingDelta*`，`flushDeltas` 按 120字/80ms/轮末/异常前 flush，timer 先清防重发——**只少帧不少字**。

## 审核方改动（本次唯一·已标注）

- `apps/frontend-shell/src/mocks/sseScripts.ts:34` `intentKey: null`→`undefined`（build-unblock·零歧义）。**非功能开发·仅解交付底线 tsc-red**。

## 📏 距北极星 / 残留

- **T2 degrade/restate 分支**本次未被真实触发（agent happy-path 直接产富答）——restate 兜底层为**读源+单测**级闭合，非真浏览器触发实拍；如需，可构造必触发 degrade 的极端问句再拍一次（优先级低·floor 已多次坐实）。
- **build gate**：建议 dev 确认 WO-0 gates 链确含 `pnpm -r build` 且推送前真跑，杜绝 tsc-red 当绿复发。

---
*审核方独立真跑复验 · 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
