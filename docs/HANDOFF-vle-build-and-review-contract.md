# HANDOFF · 闭环验证引擎 VLE 收尾 · 开工与评审合同

> **这是 H4**（见 `HANDOFF-ROADMAP.md`）。VLE = "模拟真值数据 → 全链正门流转 → 独立预言机双算 → 工程验证度可量化"的自动闭环验证引擎。**它本身就是"如何量化系统完成度/零遗漏"的系统级答案**——把"验证了多少"从主观评分变成 `validation_runs` 报告里的一个分数。
>
> ⚠️ **特殊背景（防白干）**：`COMPLETION-LEDGER D24` 标 VLE「❌ 未见实现」**是错的（stale）**。2026-06 真代码摸底：`apps/datacore/src/vle.ts` 已有**七段 runner + 三覆盖率 + 工程验证度评分 + 一次性隔离租户 + VL1–VL8 测试**，约 **30-40% 已建**。**H4 不是从零建，是收尾：补齐"参照实现双算"（核心可证底线）+ CI 门（现在拦不住合并）+ 前端段级矩阵。照"从零建"重写 vle.ts = 红线打回。**

---

## 0. 先读这些（按序）

| 顺序 | 文档/锚点 | 读它干嘛 |
|---|---|---|
| ① | `docs/SYSTEM-ONTOLOGY.md` | 铁律0；VLE 触及 R11(全链闭包)/R4(行动)/R6(确定性) |
| ② | `docs/START-HERE-dev-agent.md` | 角色边界 + 同分支纪律 + 通用红线 |
| ③ | `docs/PRD-addendum-validation-loop.md` | VLE **目标**规格（七段/三类预言机/断言矩阵/SMOKE-FULL-SOAK/工程验证度/CI门/VL1–VL8） |
| ④ | 本文件 §1《源↔现状↔设计》追溯表 | **核心**：每个 VLE 元素 → 真代码现状（真实/桩/缺+锚点）→ H4 处置 |
| ⑤ | `.claude/skills/fde-delivery` | 完成=亲手真跑出报告，不是测试绿 |

---

## 1. 《源↔现状↔设计》追溯表（防遗漏的绑定清单 · H4 宪法）

> 规则：每个 VLE 元素必有一行；标「真实」的**只接不重写**，「桩/缺」的才是 H4 范围。评审逐行核（无映射=遗漏，打回）。锚点为 2026-06 摸底实勘。

| # | VLE 元素（源：addendum §1-7） | 真代码现状（真实/桩/缺 · 锚点） | H4 处置 |
|---|---|---|---|
| V1 | 端点 POST/GET/:id `/a/v1/validation/runs` | **真实** `app.ts:1088/1099/1106`（profile+seed，admin/catalog_admin） | 不建 |
| V2 | 七段 runner（①接入②建模③聚合派生④规则⑤推演⑥行动⑦校准） | **真实** `vle.ts:57-205`（顺序执行+逐段断言，仅 S 规模） | 不建（增量4 扩 FULL 规模） |
| V3 | 预言机·构造真值（GenSpec 已知值解析） | **真实** `vle.ts:42-43,66-77,129-137` | 不建 |
| V4 | 预言机·不变量（聚合守恒/引用完整/确定性/epoch 单调…） | **真实** `vle.ts:89-112,181-201`（6 条） | 不建 |
| **V5** | **预言机·参照实现（第二套独立代码双算五求解器 P50/P90/IRR…）** | **🔴 桩** `vle.ts:139-151` ⑤仅验"负载>0"，无独立参照算法 | **增量2（P1·可证底线）** |
| V6 | 报告 `validation_runs` 表+repo+report JSONB | **真实** `migrations/012:24` + `domain.ts` + `repo/pg.ts`（R9 四处） | 不建 |
| V7 | 三覆盖率 + 工程验证度评分 `0.5×模块+0.3×断言+0.2×闭环` | **真实** `vle.ts:303-307,318`（assertion=已覆盖段/7，诚实非硬编码1） | 不建 |
| V8 | 一次性隔离租户（origin=VALIDATION→执行→销毁） | **真实** `vle.ts:54,204`（try-finally destroyTenant） | 不建 |
| V9 | 静态独立性（VLE/参照实现不 import 被测 service/repo） | **真实(测试)** `vle-acceptance.test.ts:61-66`；**🔴 无 CI 门**（只在单测里） | **增量1 并入门** |
| **V10** | **CI 门 `validation:check`（SMOKE 红阻断合并）** | **🔴 缺** `package.json` gates 无 VLE 检查 | **增量1（P0）** |
| **V11** | **前端段级红绿矩阵 + 失败 diff 下钻 + 同 seed 复跑单段** | **🔴 缺** `ValidationPage.tsx` 仅历史列表，无矩阵/下钻 | **增量3（P1）** |
| V12 | profile 分支驱动（FULL 365-tick 回放 / SOAK 性能采集） | **🔴 桩** `vle.ts:45-50` 参数收但不分支，仅 SMOKE | **增量4（P2）** |
| V13 | 断言矩阵形式化 + 注册表（动态登记，逐工单接入） | **桩** `vle.ts:8` 硬编码 7 段 + 9 断言（~40% 矩阵），无 AssertionRegistry | **增量4（P2）** |
| V14 | 混沌注入·Saga kill 重入（VL5：中段 kill→重入→终态=基线） | **缺** 仅测试专用故障注入（dangling_link/broken_aggregate），未对接回放编排器 | **增量5（P3·依赖回放编排器）** |
| V15 | VL1–VL8 验收测试 | **真实** `vle.test.ts`(VL1/3/6/8)+`vle-acceptance.test.ts`(VL2/4/5/7) | 不建（增量2 后 VL2 才真有效） |

> **明确不建（防重写已建 30-40%）**：V1/V2/V3/V4/V6/V7/V8/V15。**H4 范围 = V5/V10/V11（核心三缺）+ V9并门 + V12/V13/V14（递进）。**

---

## 2. 建什么（范围）

**建**：CI 门 validation:check（V10）+ 静态独立性并入门（V9）· 参照实现⑤双算（V5）· 前端段级矩阵+下钻（V11）· FULL 分支+断言注册表（V12/V13）· 混沌 Saga 重入（V14，依赖回放编排器）。
**先验后建**：增量0 真跑现有 SMOKE，贴报告，记当前工程验证度/三覆盖率 **baseline**。
**不建**：§1 标「真实」8 项。**重写 vle.ts 七段框架=红线打回。**

---

## 3. 怎么建（增量顺序 · 每增量 DoD）

| 增量 | 标题 | 做什么 | DoD（亲手真跑 + 门绿） |
|---|---|---|---|
| **0** | **真跑 SMOKE 定基线**（先于建设） | 起内存态 datacore → `POST /a/v1/validation/runs {profile:SMOKE}` → 抓报告 | **贴真报告**：七段 pass/fail、9 断言、三覆盖率、工程验证度分数。**诚实记 baseline**（哪段桩、参照实现是不是只验"负载>0"）。只看不改 |
| **1** | V10+V9 · CI 门 + 静态独立性（P0） | 新建 `scripts/check-validation.mjs`（跑 `vle SMOKE`，pass 且工程验证度≥baseline 才过；并静态扫 VLE/oracle 不 import 被测 `solvers/service`·`ruledsl`）→ 并入 `pnpm gates` | `pnpm validation:check` 绿；故意改坏一段→门红阻断（贴证据）；静态独立性违例→门红 |
| **2** | V5 · 参照实现⑤双算（P1·可证底线） | 在 VLE 内**独立**实现 `capacity_forecast` 的 P50/P90（**禁止 import `solvers/service`**，第二套代码）；⑤段加"求解值 vs 参照值"断言（容差表） | **VL2 真有效**：故意改坏求解器一个系数 `curveMult`→FULL/SMOKE 在⑤段红，diff 精确指出期望/实际/首个偏离对象（贴证据）；参照实现与被测零 import（门 V9 守） |
| **3** | V11 · 前端段级矩阵+下钻（P1） | 新增 `ValidationDetailPage`（`/admin/validation/:runId` 消费 `GET /:id`）：七段×断言逐条（段/point/oracle/pass/expected/actual/diff）+ 红绿行 + 失败下钻；列表页加链接 + "同 seed 复跑单段" | 起前端真点：列表→详情→看到段级红绿矩阵 + 失败项 diff（贴截图）；R14 零业务常数 |
| **4** | V12+V13 · FULL 分支 + 断言注册表（P2） | profile 驱动：FULL 扩规模+tick+**断言全集**；`AssertionRegistry` 类（动态登记 segment×point×oracle，逐工单接入而非硬编码 9 条）；断言覆盖率随登记真实上升 | FULL 真跑出更高断言覆盖率（贴前后对比）；新工单接入一条断言→注册表+1、覆盖率变化诚实 |
| **5** | V14 · 混沌 Saga 重入（P3·依赖回放编排器） | 对接回放/执行语义：VL5 随机点 kill（导入 Saga/派生/工作流）→重入→终态计数=不中断基线 | VL5 真验：中段 kill→重入补偿→终态=基线（贴证据）。**回放编排器未就绪则本增量挂起，诚实标依赖** |

---

## 4. 红线（越线即停）

- **十红线**（本体 §5）：尤其 **RL3**（vle.ts 七段框架已建，**只接不重写**）· **RL6 确定性**（同 seed 两次 FULL 报告逐字段一致，VL8；无 Date.now/random）· **RL9 additive 可回退**。
- **VLE 正门红线（继承回放编排器铁律 · 静态门强制）**：VLE 只经**公开 API** 注入与读取；**断言比对时才允许直读 DB（读不写）**；**VLE 与参照实现包不得 import 任何被测 service/repo**（增量1 并入 CI 静态门 V9）。
- **参照实现必须真独立**：增量2 的 P50/P90 必须是**第二套独立推导**，不是 copy 被测代码、不是 import 它——否则"双算"形同虚设，评审重点核（见 §5）。
- **stale-source 红线**：以 §1 真代码锚点为准，不照 `COMPLETION-LEDGER D24`(标错❌) 或 `TODO.md`(虚标已补) 建。发现现状与 §1 不符→先回写本表+报告。
- **提交物洁净**：模型标识符不进任何提交物。

---

## 5. 评审协议（审核方按此 review）

每增量逐项核，全过才"可合"：
1. **十红线 + VLE 正门红线**（尤其参照实现真独立、不 import 被测）。
2. **门全绿**：`pnpm -r build && pnpm -r test && pnpm gates` + **新 `validation:check`**（增量1 起）。
3. **本体回写**：新门/对象 → 回写 §7/§8，`ontology:check` 绿。
4. **§1 追溯表逐行核（防遗漏轴1）**：标「真实」没被重写、标「缺/桩」真补了。
5. **FDE 亲手证据（防遗漏轴2 + L5 现实对位）**：增量0/2/3 必附**真跑 validation run 的报告/截图**——增量2 必附"植入 bug→⑤段红+diff"的证据（VL2 真有效），**不认"测试绿"，要"真报告里参照双算捕获了人造 bug"**。
6. **参照独立性专核**：读增量2 的参照实现，确认它是**独立第二套算法**而非被测代码的拷贝/导入（这是 VLE 可证性的命根）。
7. **CLI 对等 + 可回退 + 北极星距离**（PR 描述列"还差什么/哪些 happy-path"）。

> 评审产物：✅可合 / 🔴打回（列项+红线+建议）。**审核方不替实现，只评审 + 守纪律。**

---

## 6. 提交规范

按 `START-HERE-dev-agent §6` 模板（做了什么对照增量N/§1 哪个 V · 复用证不分叉 · 本体回写 · 高冲突文件点名[package.json 加门/SYSTEM-ONTOLOGY] · 测试贴绿 · **FDE 真报告证据** · 北极星距离 · 回退）。只 push `claude/vigilant-knuth-b1nmxn`，push 前先 rebase，co-author `Claude <noreply@anthropic.com>`，模型标识不进提交物。

---

## 7. 起步第一步（建议立刻做）

**增量 0（只看不改）**：读 §0①②③ + §1 追溯表 → `pnpm -r build && pnpm -r test`（含 vle 测试应绿）→ 起内存态 datacore → `POST /a/v1/validation/runs {profile:"SMOKE"}` → **贴真报告**（七段 pass、9 断言、三覆盖率、工程验证度分数）。**坐实"VLE 现在到底验证了多少、参照实现是不是桩"是后续一切的地基**（先认清现状，再补 V10/V5/V11）。有歧义先问。
