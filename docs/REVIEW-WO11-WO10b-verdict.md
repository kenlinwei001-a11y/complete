# 评审复验 — WO-11（UX 5 子项）+ WO-10②（真打 LLM eval）（dev 156e1aa）

> **角色**（铁律0.5）：审核方独立真跑（拓扑序重建·真 curl·真浏览器·真 Kimi），非信单测/截图。
> **核发**：**WO-11 = 闭合 ✅（5 子项逐条真验）· WO-10② = 机制闭合 ✅，但 dev 引用的「真分 0.90」未能独立复现（我干净 run=0.20）**。四包 `pnpm -r build` 全绿。

## WO-11 · UX/语义裂缝合集 5 子项 = 闭合 ✅

| 子项 | 真值判据 | 复验 |
|---|---|---|
| ①data-health 徽章一致 | 非 critical 源超阈不再「正常↔超阈」矛盾 | ✅ 真浏览器：LIMS(延迟246>阈120)·SRM(156>120) 现标 **「(非关键源·参考)」**——阈值对非关键源是参考口径、徽章「正常」一致（实拍 `wo11-1-sourceoverview.png`） |
| ②schema 外部失败可读 | 外部 4xx→可读非裸 500 | ✅ 真 curl：`/connections/{id}/schema` 外部 401 → **HTTP 502 `CONNECTOR_SCHEMA_DISCOVERY_FAILED`·「连接器『badapi』schema 发现失败…HTTP 401」**（含连接器名+原因·非 INTERNAL_ERROR） |
| ③llm-bindings 解绑 | PUT 幂等替换 + DELETE 解绑生效 | ✅ 真 curl：`DELETE /a/v1/llm-bindings/comprehend`→200→comprehend 移除·余 5 用途完整（幂等） |
| ④深链 F5 不掉登录 | F5 经 silentRefresh 续期·不跳登录 | ✅ **真浏览器（dev 只 vitest·审核方补实拍）**：深链 `/admin/object-types`→F5 reload→**仍停 /admin/object-types·已登录**（未跳 /login·实拍 `wo11-4-f5.png`） |
| ⑤query-history 孤儿页 | NAV 有入口·可达 | ✅ 真 curl：workspace.navigation 含 `query-history`（adminRegistry 登记入「编排与场景」组） |

5 子项全过。诚实边界（dev 自承·审核方采信）：前端全套仍余 3 pre-existing 失败（f43.admin-cluster×2 + vle-segment-matrix·VLE 运行历史·15s 超时），dev 两验 stash 干净基线同样失败、与本单无文件交集——属既存，另单核查。

## WO-10② · 真打 LLM eval = 机制闭合 ✅ / 引用真分 0.90 未复现 ⚠

- **机制（我此前标②未落·现已补）✅**：`server.ts:1749` REST 透传 `llmMode:z.enum(["MOCK","REAL"])`→run。真 curl `/b/v1/evals/run{suite:classifier,llmMode:REAL}`→**`llmMode=REAL·total=20`（播种 20 例真打 Kimi）·passRate<1**——不再恒 MOCK 假满分、真打能出真分暴露真故障。**WO-10② 的实质（透传+真打透明度）达成。**
- **⚠️ 引用真分未复现（审核方独立真跑）**：dev 证据 `WO-10b-real-eval-fde.md` 称 **passRate=0.90·intentAccuracy=0.95**；审核方两次独立真打：
  - 污染 run（我先 unbind 了 comprehend 测子项③）：0.05；
  - **干净 run（重启 datacore 恢复 comprehend 6 绑定·重播种 20 例）：passRate=0.20·intentAccuracy=0.20**。
  - 即 **dev 的 0.90 在我环境复不出来（干净 0.20）**。不影响 WO-10② 机制闭合（真分是 agent 质量·明确在 ② 范围外），但**「0.90」这个引用数字本身存疑**——真实分类器质量可能远低于 0.90（这反而更印证 WO-10② 让真 eval 暴露真缺陷的价值）。
  - **建议 dev 复核 0.90 证据**：可能是 cache/intent 目录加载态差异、Kimi 分类非确定性、或当时 run 非代表性。审核方采信「机制达成」，对「0.90 真分」标 **未独立复现**。

## 核发结论
- **WO-11 闭合**（5 子项真验·含 dev 点名要补的 ④F5 真浏览器）。
- **WO-10② 机制闭合**（REST 透传 llmMode→REAL 真打·我此前标的②已补），**但引用「真分 0.90」未独立复现（干净 0.20）·建议 dev 复核该数字**（不阻断机制闭合·真分属 agent 质量另议）。
- 开口（更新）：WO-Q1 增量3 · 1C · A6-T2 · 前端 3 测试超时（另单）· demo 分类器真分偏低（agent 质量·非工单）。
