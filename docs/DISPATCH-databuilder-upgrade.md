# 派单 · 数据构建发动机升级战役（审核方出·2026-07-11）

> **定位**：本文是**派单编排层**，落 AUDIT-databuilder-genuine-construction-DELTA.md（洞A-E）+ WO-DB-LLM-REQUIRED-NO-FLOOR.md 的施工序。**不重写引擎**（H3 红线）——皆"接线/硬化/去兜底"。三路独立复验已闭环（真 Kimi 双路逐值坐实 5 洞 + 全仓摸底红线范围 + 在建交互排序）。

## 本体引用与影响（铁律 0）
- **对象类型**（§2）：`BuildPlan/ClosureReport/SliceSpec/Rule/ValidationTrace/StoryBuildRun`（§2.B）· B 栈 `Intent/Workflow/Skill/Agent`（§2.H）· 沙盘配套 `propagation_rule/state_var`（§2.I·S0 已入 `contracts/databuilder.ts:437`）。
- **链路**（§3/§10.3 数据构建链）：故事→comprehend→BuildPlan→transform→closure→publish。断点在"派生真实性"接缝。
- **不变量**（§5）：**KILL-MOCK-RED**（核心·空壳冒充真派生=红）· **R11 全链闭包/R12 双向闭包**（被空壳满足）· **R13 溯源**（ValidationTrace 盖章）· **R6**（确定性·地板真但语义错）· **RL9**（additive·去兜底须留 flag 路）。
- **断点**（§8·落地后回写）：**G-BUILD-SHELL**（闭包只验 domain·CLOSURE-HARDEN 闭）· **G-BUILD-VERIFY**（ValidationTrace 写死 PASS·CLOSURE-HARDEN 闭）· **G-COMPREHEND-FLOOR**（地板静默降级·NO-FLOOR 闭）。
- **回写**：每单落地登 §8 对应断点标闭·§7 登新 green→red 门·跑 `pnpm ontology:slices`。

## 复现坐实（真 Kimi moonshot-v1-32k · 地板 vs 真 LLM 双路 · 5 洞 CONFIRMED）
| 洞 | 结论 | 关键锚点 |
|---|---|---|
| A 规则预制 | 仅地板成立·LLM 路真派生（4h→真规则） | `comprehend.ts:486-490` RULES 写死表 |
| B B栈模板 fan-out | 地板/LLM workflow 逐字节同构(仅solverKey异) | `comprehend.ts:283-295` deriveBStack |
| **C 闭包空壳判绿（最深）** | closure 只读 domain·切片恒 hops:[]·真跑 resolve 零 FK 穿越仍 gatePassed=true·**green→red 已自证** | `closure.ts:27`·`service.ts:1225` |
| D verify 假绿 | ValidationTrace 逐条写死 PASS·NUMERIC_PROVENANCE 从不看 answer·crossValidation 同义反复(负时长判 CONSISTENT) | `service.ts:629-632/646` |
| E 链路不稳+无兜底+gap不报 | 无确定性 FK 兜底·gapReport 不检测空切片/断链·链路无论派生与否均被下游丢弃(结构恒成立·比随机更严重) | `comprehend.ts:284/654`·`selfcheck.ts:12-78` |

## 你的红线范围（全仓摸底·17 入口）
**"所有推演/模拟数据入口无 LLM 不降级"真正要堵的只有 databuilder comprehend 一处**（`service.ts:86-102` 主 + `:952` 次）。其余 15 入口（A18.2/A3/A2/A7/QOS分类/沙盘装配/Path B/工作流/L1-A·L1-B/provider/自成长/记忆/求解器优化/A8时钟）**均已诚实**（无 LLM→抛 UNBOUND/标 FAILED·PARTIAL·DEFERRED/合成物诚实标 SYNTHETIC）。垃圾只在"调用方 try/catch 吞 LLM 错再套地板"处·全仓仅 databuilder 这么干。诚实样板：`solvers/service.ts:270 if(!this.llm) throw`。

## WO 集（6 单·一期一单·每单 green→red 自证·回写母体）

| # | WO | 治 | Lane | 改动面 | green→red | 依赖/风险 |
|---|---|---|---|---|---|---|
| 前置 | **WO-MERGE-03**（已 WIP@dev2） | — | datacore | service.ts/pipeline | — | **所有 DB 单等它 settle**（抢同引擎） |
| ① | **WO-DB-CLOSURE-HARDEN**（最痛·假绿·最高优先） | 洞C/D | datacore | closure.ts + service.ts(ValidationTrace) | 植入 domain有值·paths:[] 类型→闭包应报空/BUILD_STATIC无数字→NUMERIC NOT_PASS | 复用 `check-requirement-graph.mjs` 门模板；"切片非空判"link-无关部分**先落**；"按真链路生成 paths"部分**依赖②** |
| ② | **WO-DB-LINK-STABILIZE** | 洞E | datacore | comprehend.ts + 覆盖度门 | LLM 丢链→FK 补→门绿·关兜底→红 | 复用 `modeling.ts:24 detectFkCandidates`(uniqueRate≥0.95) + 接现成 `slice-planner.ts:69 planSlice`(真BFS多跳·H3复用非重写)·供① |
| ③ | **WO-DB-LLM-REQUIRED-NO-FLOOR** | G-COMPREHEND-FLOOR | datacore | service.ts+config.ts+app.ts+contracts+seed+**≥14测** | 改回地板→非电池故事产电池域→门红 | **硬前置：先跑测试 sweep 定 ≥14+ 测清单+CI/demo LLM绑定 airtight**（详下）·落地后 LLM-only 简化后续 |
| ④ | **WO-DB-BSTACK-DERIVE** | 洞B | datacore | comprehend.ts deriveBStack(可能扩 LlmComprehendSchema·additive) | 两复杂度悬殊故事→workflow.steps/agent.prompt 字节相同→红 | **沙盘划界：绝不派生 propagation_rule/state_var**（S0 §3.4 归 RG/S1·防双写 contracts:437） |
| ⑤ | **WO-DB-MODELING-WIRE**（可并行·最干净） | 上传数据未接 A3 | datacore | service.ts 故事路加调用点 | 上传数据→应从列/FK 派生类型；现不派生→红 | 纯复用 `modeling.ts:89 deriveModelingSuggestion`·与 MERGE"数据先行"对齐 |
| ⑥ | **WO-DB-FIVE-ACT-UX** | §3 五幕(暴露洞给人) | frontend | DataBuilderPage.tsx | 真浏览器验收(铁律0.4) | 须①③已落(要有诚实信号可显)·**撞 MERGE 前端**·垫后 |
| ~~descope~~ | ~~WO-DB-RULE-DERIVE~~ | 洞A | — | — | — | **NO-FLOOR 落地后地板路废→洞A失去对象**·§6.1 自证 LLM 已真派生规则·**降级并入 FLOOR 路质量·省一单** |

## 依赖序（结论先行）
```
前置: WO-MERGE-03(Dev-2 WIP) settle
━━ datacore Lane(Dev-2 串行主线·抢 service.ts/comprehend.ts/closure.ts)━━
①CLOSURE-HARDEN(验证硬化 link-无关先落·暴露真相)
②LINK-STABILIZE(稳定链路+FK兜底·供①的切片生成)   ⇒ ①②强耦合·②喂①
③NO-FLOOR(去地板·硬前置=测试sweep+CI/demo airtight)
④BSTACK-DERIVE(真workflow/agent·沙盘划界)
⑤MODELING-WIRE(接A3·可与④并行若第2只datacore手)
━━ frontend Lane ━━
⑥FIVE-ACT-UX(须①③已落·防撞MERGE前端)
━━ agentcore(Dev-1)全程不撞·继续脊柱 ━━
```

## "无 LLM 不降级" vs "暗发"张力（范畴级·须钉）
- 暗发=additive·关闸字节一致；NO-FLOOR=**故意删旧兜底·非additive**——方向相反。
- 兼顾（架构成立）：`DC_COMPREHEND_DETERMINISTIC` flag（默认 false·保留地板码满足 RL9）+ `comprehendedBy:"FLOOR"` 契约标注（诚实降级）。
- **两处硬伤（派单前必补）**：
  1. **测试破面（最大缺口）**：WO §3.3 只列 3 测·实测 `runStory/comprehend` 触达 **≥14+ datacore 测 + agentcore scaffold**（含"测地板本身"的 comprehend-floor-a2）。**NO-FLOOR 派单前必先跑全量 sweep 定测清单**·择"迁 ScriptedLlmClient(对·成本高)"或"flag+FLOOR标注断言"·否则一落地即破 4 包全绿（违交付底线）。
  2. **CI/demo/离线三态 airtight**：SEED_DEMO + docker-compose demo + 离线信创——出厂无 key 建域走 FLOOR 标注(诚实但仍电池味)或须绑 LLM；信创无网**丧失建域能力**（诚实报错·WO §4 承认必然结果·用户已择"诚实>可用"）。
- **判据**：③NO-FLOOR 落地前，CI/demo 的 LLM 绑定或 flag 接线必须先端到端验证 airtight。

## 沙盘划界（必钉·防双写 contracts/databuilder.ts）
S0(DONE) 已把 propagation_rule/state_var 加进 `contracts/databuilder.ts:437`。④BSTACK-DERIVE **绝不派生这两 kind**。"谁智能推导沙盘配套"是 S0 悬置接缝(punt RG/S1)——**潜在盲区·派单时明确归属**（不属本 6 单·另立或明归沙盘 Lane）。

## 与脊柱/沙盘关系
**零代码冲突·衬底增益**：CLOSURE-HARDEN 挡空壳域发布→改善 L2/L1.5/需求图输入质量。副作用：过去"假绿通过"的域现诚实报缺→**揭出此前隐藏的下游空洞**（KILL-MOCK-RED 预期效果·非回归·宜提前给 Dev-1/Dev-3 通气）。

## 复验（审核方=我）
每单 BUILT→独立真跑复验（真起服务·**真绑 Kimi**·地板 vs LLM 双路逐值·green→red 门有牙·回退演练）→ DONE 才派下一期。①②因强耦合可合并一次子系统复验。⑥须真浏览器逐值对照后端（铁律0.4）。
