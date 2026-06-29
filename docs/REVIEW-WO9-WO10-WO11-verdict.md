# 评审复验 — WO-9 / WO-10 / WO-11（dev 9508fa7 + 关联 WO-7 9/9 96aac2a · WO-0 783f393）

> **角色**（铁律0.5）：审核方独立真跑（**拓扑序重建**+真启动+真 curl），非信单测/「✅」。
> **核发**：**WO-9 ✅ · WO-10 ◐（①闭 ②实质半截未落）· WO-11 ❌ 未开发**。附 WO-7 9/9 / WO-0 / WO-7-FIX 交叉核（均真）。

## WO-9 · A3 发布类型自动建 coverage 切片（9508fa7）= 闭合 ✅
- **真跑**：`GET /a/v1/ontology/slices` → **35 个 `coverage_<type>` 根切片**（coverage_base/arinvoice/.../**labtest**），一类型一切片，含新增 LabTest——即所有经建模链发布的类型（demo 种子走 `viaModelingChain:true`）都自动获 R12 反向闭包根切片。
- 单测 `modeling.test WO-9`（发布前无→发布后有·幂等不重复）绿。机制真生效、非写死。

## WO-10 · Eval 真打 LLM + 空用例不报满分（9508fa7）= ◐（①闭·②未落·实质半截）
- **① 空用例不报满分 ✅（真跑）**：`POST /b/v1/evals/run {空套件}` → **passRate:0·total:0**（非旧 bug 的 1）。代码 `total===0?1`→`?0`（含 intentAccuracy/toolCorrectness 同改）。假阳性消。
- **② REST 透传 llmMode + 真打 LLM ❌ 未落（实质半截·审核方真跑+对码坐实）**：
  - REST 处理器 `server.ts:1746` 仅 parse `suite`+`agentKey`，**不接 llmMode** → 真跑响应恒 `llmMode:MOCK`；
  - 服务层 `evals.run` 虽支持 `opts.llmMode:"MOCK"|"REAL"`（evals.ts:132），但**无任何 REST/代码路径能触发 REAL**（全仓 grep `llmMode:LIVE/REAL` 触发点为空）；
  - 即 WO-10 判据 ②「`evals/run{agent_quality,llmMode:LIVE}`→真打 Kimi、对路径B 真故障能红」**不可达**。
  - **这恰是 WO-10 的实质价值**（破「mock eval 谐振·绿测试≠能用制度化」、让 eval 能发现 WO-1 类路径B真故障）——**未交付**。commit 标题只提「空用例不满分」，确只做了 ①。
- **判**：① 闭、② 未落 → WO-10 ◐。**②需补**：REST 透传 llmMode + 真打 LLM eval 模式（且统一枚举：判据写 LIVE、代码是 REAL）。

## WO-11 · UX/语义裂缝合集（5 子项）= ❌ 未开发
- 全仓无 WO-11 提交（git log 无）。5 子项（data-health 徽章矛盾 / schema 裸500 / llm-bindings add-only 无解绑 / 深链 F5 掉登录 / query-history 孤儿页）**一条未动**。

---

## 交叉核（顺带真跑·均真）
- **WO-7-FIX（契约 members/objectCount）= 已做 ✅**：`packages/contracts/src/planviews.ts:245-248` 已加 members/objectCount；`pnpm -r build`（拓扑序·先 contracts）**全绿 0 tsc 错**。
  > **审核方自纠（FDE 诚实）**：我初测 `pnpm --filter datacore build` 单跑仍报 `datahealth.ts:76 members TS2353`，一度误判「WO-7-FIX 未做/构建红」——实为**我自己第三次撞 stale-dist**（没先重建 contracts 的 .d.ts）。这正是 dev **WO-0** 要修的坑（gates 链首建 contracts）。拓扑序重建即绿，WO-7-FIX 确已落。**教训刻进 SOP：monorepo 必 `pnpm -r build` 或先建 contracts。**
- **WO-7 9/9（选 A·LabTest）= 真 ✅**：`LabTest` **20 真对象**（lab_al_foil_b0…）·`data-health` LIMS **objectCount 24**·**9/9 业务源全非 0**——经合成正门真建、非伪造（我拍板 A 已落实）。
- **WO-0 冒烟门 = 真有效 ✅**：`seed-demo-smoke:check` 真起 `SEED_DEMO=1` datacore 监听成功（挡 WO-4 类启动崩）；并入 gates。

## 待 dev（更新）
- **WO-10-②（补·实质半截）**：REST 透传 llmMode + 真打 LLM eval（agent_quality LIVE 能红 WO-1 类路径B故障）+ 统一 LIVE/REAL 枚举。
- **WO-11（P3·5 子项·未开发）**：按 buildorders §WO-11 逐条。
- 原 WO-Q1（增量1 已起·待整体）/ 1C / A6-T2 不变。**已闭**：WO-1/2/3/4(+FIX)/5/6/7(+FIX+9/9)/8/9 + WO-0 + lastmile + A6尾巴① + 四链路 + 结构化接入臂。
