# START HERE · 开发 agent 单一入口

> 你是**实现/开发 agent**：照本文指向的施工合同**写代码、commit、push**。
> 写 PRD/SPEC 与**评审**由审核方负责——**你不改 PRD、不自评"可合"**；有歧义先问，别擅自扩大范围。
> 分支：所有改动**只**推 `claude/vigilant-knuth-b1nmxn`（不开新分支、不开 PR）。

---

## 0. 铁律 0（违反即返工）

**动手前先完整读 `docs/SYSTEM-ONTOLOGY.md`**（系统自我元模型 = 接线单一来源）。改了链路/事件/对象类型/不变量(R1–R17)/门禁 → **必须回写本体对应章节**。命名禁用外部产品名，用平台自有术语。

---

## 1. 按序读这些（canonical · 别跳）

| 顺序 | 文档 | 读它干嘛 |
|---|---|---|
| ① | `docs/SYSTEM-ONTOLOGY.md` | 系统大脑：对象类型/链路(§3)/不变量 R1–R17(§5)/门禁(§7)/断点 G-1…G-11(§8)。**铁律0** |
| ② | `docs/COMPLETION-LEDGER.md` | 全局目标真相表（~680 验收点/27 域）。**看清你这块在全局的位置**——但**别照它 680 点盲建**（见 §3 警告） |
| ③ | 你这轨的 HANDOFF（见 §2） | 你的施工合同：增量顺序 + 每增量 DoD + 红线 + 评审协议，**自洽，照它建** |
| ④ | `CLAUDE.md`（仓库根） | 架构地图/常用命令/关键约定（contracts-only/tenant_id/entitlement/确定性/错误信封/双仓储） |
| ⑤ | `.claude/skills/fde-delivery`（FDE 纪律） | **"绿测试≠能用"**：任何"完成"结论必须有"以用户身份亲手跑一遍"的证据 |

---

## 2. 现在该建什么（两条已就绪的轨 · 按指派选）

**7 条已就绪轨**（每份 HANDOFF 自带《源↔现状↔设计》§1 追溯表 + 增量/红线/双轴评审。按指派认领一条）：

| 轨 | 项目 | 施工合同 `docs/` | 优先级 | 一句话（含关键红线） |
|---|---|---|---|---|
| **A** | 推演沙盘 UI 收口 | `HANDOFF-sandbox-build-and-review-contract.md`（活在 §6.1.A） | **P0 北极星** | 后端 0-4 齐、UI 仅~30-40%；**前端砌齐+demo 种数据，别重写后端**（采纳→Action/分支对比/向导/就绪面板/双雷达） |
| **B** | 优化求解器融合 | `HANDOFF-optimization-fusion-build-and-review-contract.md` | P1 | 零代码开工，先增量0；**许可证红线：不训练上游/不碰 Gurobi/CDLA 只取 Results**（`THIRD-PARTY-NOTICES`） |
| **C** | 数据构建发动机收尾 | `HANDOFF-comprehend-engine-build-and-review-contract.md` | **P0 北极星** | 引擎主体已建；收 3 断点(用途→model 路由/域不变量/入启动器)；**§1 标「真实」13 项只接不重写**；增量0 先 FDE 真跑 |
| **D** | 闭环验证引擎 VLE 收尾 | `HANDOFF-vle-build-and-review-contract.md` | P1 | ~30-40%已建；补**参照实现双算**(核心可证)+CI 门+前端段级矩阵；**别重写七段框架** |
| **E** | 规则即一等 G-10 收尾(P3) | `HANDOFF-rules-firstclass-p3-build-and-review-contract.md` | P1 | 编辑器/版本/事件**已建**；补 **11/19 求解器 payload 映射**+6 入口 FDE；**别重写编辑器** |
| **F** | 场景发育 G-9 收尾(P3) | `HANDOFF-ontogenesis-p3-build-and-review-contract.md` | P1 | runGrowthLoop/planSlice/规则解析**函数都在**；只是 **wiring**(growScenario 调它们)+ADVISORY；**别重写函数** |
| **G** | 管理面闭合+AC8 | `HANDOFF-admin-console-closure-build-and-review-contract.md` | P2 | 41 页都在；补 3 页(求解器目录/切片编辑器/评测 CRUD)+引用控件闭合+AC8 死路；**别重写已建 38 页** |
| **H** | P3 收尾杂项（Pass-2 wave1+2 · 11 块） | `PASS2-wave1-finishing-tasks.md` + `PASS2-wave2-finishing-tasks.md` | P1-P2 | 11 块**全 60-95% 已建**（livedIn 已完工免动）；活是钩子接线/补前端页/加字段头/B侧对称（wave1 P0×8/P1×13 + wave2 P0×3/P1×11）；**已建主体别重写** |
| **I** | 驾驶舱数据层颗粒（唯一真半成品） | `PASS2-wave2-finishing-tasks.md §2` | P1（含高回归专项） | 25-30% 已建（求解器框架在）；缺八卡KPI数据源/八根因DAG/毛利勾稽；**三阶段必守：低回归先→中→高回归专项独立PR+FDE逐值核HTML过基线，别混 commit；求解器别重写** |

> ⚠ **每条轨摸底都翻案过——真代码比文档建得多得多**。所以每份 HANDOFF §1 都标死"哪些已建只接不重写、哪些才真建"。**照文档/TODO 从零重写=红线打回。**
> ⚠ **别同时铺多轨**——一轨一轨来，每增量一组 commit、跑通再下一个。**先读你那轨 HANDOFF §1 追溯表**再动手。
> ⚠ **全局路线图**见 `docs/HANDOFF-ROADMAP.md`（A8时序/M11校准等待 Pass-2 定级再配 HANDOFF——**没出 HANDOFF 的别动**）。

---

## 3. ⚠ 关于 COMPLETION-LEDGER 的警告（别盲建）

`COMPLETION-LEDGER.md` 里 ~679 点是 **"待真跑"**，**不是"待建"**——其中很多**很可能已经能用，只是没被真跑核实过**。**照它 680 点逐条建 = 重建已能用的东西、白费力、还可能砸坏现成的。**

正确分工：**审核方先做 Pass-2 真跑定级**（起真系统逐条验，判 ✅/◐/❌），把"待真跑"收敛成**精确的"❌真缺/◐真半通"队列**，再交给你建。**你现在的确定性工作就是 §2 两份 HANDOFF**；其余等 Pass-2 出队列再说。**看到 ⬜未跑别自己去建。**

---

## 4. 同分支协同纪律（多 agent 同推此分支 · 违反=评审打回）

1. **不开新分支、不开 PR**：每增量 = 直接 commit + push 到 `claude/vigilant-knuth-b1nmxn`。
2. **每次 push 前先 rebase**：`git fetch origin claude/vigilant-knuth-b1nmxn && git rebase origin/claude/vigilant-knuth-b1nmxn`（多 agent 同推，不 rebase 必非 fast-forward）。冲突自解、解完复跑 `pnpm -r build && pnpm -r test && pnpm gates` 再 push。
3. **三类高冲突文件改动须在 commit 描述单独点名**：`packages/contracts/**` · `package.json`（新门并入 `pnpm gates`）· `docs/SYSTEM-ONTOLOGY.md`（本体回写）。

---

## 5. 红线速查（越线即停）

- **十红线**（沙盘落地纪律，见本体 §5）：RL1 本体先行 · RL2 暗发(defaultOn:false) · RL3 单一来源(不重写校验/不重算) · **RL4 走正门**(采纳才经 R4 写真值，模拟态不写真值) · RL5 零业务常数(换租户=换配置，`debattery:check` 守) · RL6 确定性(无 Date.now/random，同输入同输出) · RL7 CLI 先于 UI · RL8 倒序长出 · RL9 additive 可回退 · RL10 不与在建分叉。
- **关键约定**（CLAUDE.md）：跨包只依赖 `@platform/contracts`；所有读写/事件/缓存键带 `tenantId`；功能关=404 `FEATURE_NOT_FOUND`（entitlement 先于 authz）；凭据 AES-GCM 落库**不回显明文**；错误信封 `{error:{code,message,requestId}}`；新表四处同改(migrations+pg+memory+repo 接口)。
- **融合专属**：`THIRD-PARTY-NOTICES.md` 三条——不训练上游内容 / 不碰 Gurobi / CDLA 只取派生 Results。
- **提交物洁净**：**模型标识符不得出现在任何提交物**（commit message / PR / 代码注释）。commit co-author 用 `Claude <noreply@anthropic.com>`。

---

## 6. 提交规范（让评审高效）

每 commit 描述按此模板：
```
增量N · <标题>
- 做了什么（对照 HANDOFF 增量N / §6.1.A 哪条）
- 复用了什么既有 PRD/代码（证不分叉）
- 本体回写：§? 改了什么
- 高冲突文件：contracts? / package.json? / SYSTEM-ONTOLOGY.md?（改了哪个点名）
- CLI：新增 platform ...（cli-parity 绿）
- 测试：命名门 + pnpm gates 输出（贴绿）
- FDE 亲手证据：CLI 输出 / 截图（不是只有单测绿）
- 北极星距离：还差___ · happy-path/合成的部分：___
- 回退：flag 关 / 迁移 down / 旧路径
```
push 前自检：**rebase 干净 ✓ 本体回写 ✓ CLI 注册 ✓ 命名门 ✓ pnpm gates ✓ 零业务常数 ✓ 暗发可回退 ✓ FDE 亲手 ✓ 北极星距离 ✓ 高冲突文件点名 ✓**。

---

## 7. 评审协议（审核方按此 review 你的 commit）

每增量逐项核对，**全过才"可合"，任一不过列具体红线/门打回**（详见 HANDOFF §5）：
① 十红线不违反 · ② `pnpm -r build && pnpm -r test && pnpm gates` + 该增量命名门全绿 · ③ 本体回写 · ④ CLI 对等 · ⑤ 不分叉 · ⑥ **FDE 亲手证据**（非只单测绿）· ⑦ PR 描述含"还差什么 + 哪些是 happy-path/合成" · ⑧ 可回退 · **⑨ UI 增量两轴核对**（轴1 对竞品 `GROUNDING §F` 逐元素 / 轴2 对设计 mockup 逐元素是否真实现 + 真启动 Playwright 实拍佐证——**只验功能不验设计完整性=打回**）。

---

## 8. 禁止清单（速查）

- ❌ 改 PRD/SPEC、自评"可合"、擅自扩范围（你建，审核方评）。
- ❌ 开新分支 / 开 PR / 推别的分支。
- ❌ 照 `COMPLETION-LEDGER` 680 点盲建（§3）。
- ❌ 碰 Gurobi 示例 / 把上游内容喂训练 / 原样转发 CDLA 数据文件。
- ❌ 删旧页 / 不可回退 / 用合成冒充真实数据源。
- ❌ 模型标识符进任何提交物。
- ❌ 用测试绿 + commit 冒充"完成"（FDE：完成=亲手用一遍能用）。

---

## 9. 第一步（建议立刻做）

**轨 A**：读 ①②③，跑 `pnpm install && pnpm -r build && pnpm -r test`（4 包应全绿）→ 起内存态双服务 + 前端真看一眼当前沙盘（`/v/sim-sandbox`，需开 `sim.*` entitlement）→ 照 HANDOFF §6.1.A 挑一个 **P0** 开做 → 按 §6 提交。
**轨 B**：读 ①②③ + `THIRD-PARTY-NOTICES` + `SPEC-optimization-template-pool` → 做增量 0（本体先行 + 许可证门，零业务代码）→ 提交。
**轨 C**：读 ①②③ + `HANDOFF-comprehend-engine §1 追溯表` → 做增量 0（起内存态 datacore，用一个**新颖故事**调 `runStory`，贴真输出坐实引擎能不能用，**只看不改**）→ 再动 3 断点。

有歧义、或发现要动红线级/架构级的东西 → **先问，别擅自决定**。
