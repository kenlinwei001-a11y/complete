# HANDOFF · 管理面引用闭合 + 编辑器补缺 + AC8 零代码自助 · 开工与评审合同

> **这是 H7**（见 `HANDOFF-ROADMAP.md`）。让 catalog_admin **零代码从零建场景→前台推演**全程不遇死路（AC8）。
>
> ⚠️ **特殊背景（防白干）**：addendum 列了"7 整页缺失/验收必修"。2026-06 摸底：**41 个 admin 页都在**(WorkflowsPage 编辑器/CatalogPage/DomainsPage/OpsSchedulePage/ScenesPage/Merge/Quarantine/Notifications 都已建)。**H7 真缺口是精确的少数：3 页真缺(求解器目录/切片编辑器/评测 CRUD) + 引用控件 5-7 处不闭合 + AC8 3-4 处死路。重写已建的 38 个页=红线打回。**

---

## 0. 先读：`PRD-addendum-admin-console-closure.md` · `PRD-addendum-admin-platform.md` · `SYSTEM-ONTOLOGY.md` · `START-HERE-dev-agent.md` · 本文件 §1 · fde-delivery。

## 1. 《源↔现状↔设计》追溯表（H7 宪法 · 防遗漏）

| # | 元素 | 现状(锚点) | H7 处置 |
|---|---|---|---|
| C1 | 41 admin 页(workflow/catalog/domains/scenes/ops-schedule/merge/quarantine/notifications/rules/perm/views/tenants/users/llm…) | **真实** `pages/admin/*`(40 完整) | 不建(只补下列控件) |
| C2 | WorkflowsPage 步骤编辑器 + TemplateValue 补全 + 发布校验定位 | **真实** `WorkflowsPage.tsx:183-478` | 不建 |
| C3 | CatalogPage 意图编辑 | **真实** `CatalogPage.tsx` | 不建(补 C11/C12) |
| C4 | DomainsPage 基础 CRUD | **真实** `DomainsPage.tsx:11-54` | 不建(可选补 owner 指派) |
| **C5** | **求解器目录页 /admin/solvers(只读发现)** | **🔴 缺** workflow solverKey 下拉无数据源 | **增量1（P0）** |
| **C6** | **12 引用控件闭合(＋新建/空态有路/可查看)** | **🔴 5-7 不闭合** agent↔skill/workflow/mcp/规则·workflow步↔agentKey/ruleIds·场景↔defaultAgent/intentFilter·策略↔role | **增量2（P0）** |
| **C7** | **/admin/slices 编辑器(root+hops 可视化+contractFixture+试切预览)** | **🔴 只读** `SlicesPage.tsx:8-43` 仅列表(AC8 步1 死路) | **增量3（P1）** |
| **C8** | **workflow 试运行面板 + render_answer 可视编排** | **🔴 缺** blocks 是 JSON 文本框(违 D-28)，无试运行(违 AC2) | **增量4（P1）** |
| **C9** | **/admin/evals 评测用例 CRUD** | **🟡 桩** `EvalsPage.tsx` 仅只读(阻 agent 发布门禁≥3 用例) | **增量5（P1）** |
| **C10** | **objectRef 槽位 refType 字段 + 分类测试** | **🔴 缺** `CatalogPage.tsx:194-230` 槽位无 refType(违 AC4)，无"试分类" | **增量5（P1）** |
| **C11** | **D-28 DSL 输入辅助(规则/权限 expression 补全+校验+dry-run)** | **🔴 裸文本框** `RulesPage`/`PermissionsPage` expression 无补全 | **增量6（P2）** |
| **C12** | **配置迁移工作台页** | **🔴 缺** Merge/Quarantine/Notifications 在，迁移页缺 | **增量6（P2）** |

> **不建（防重写 38 页）**：C1–C4。**H7 范围 = C5–C12(精确补缺)。**

## 2. 范围
**建**：求解器目录页(C5)·12 引用控件闭合(C6)·切片编辑器(C7)·workflow 试运行+render 可视(C8)·评测 CRUD(C9)·objectRef refType+分类测试(C10)·DSL 输入辅助(C11)·配置迁移页(C12)。**不建**：已建 38 页主体。**先验**：增量0 真走一遍 AC8 标死路。

## 3. 增量（每增量 DoD：真浏览器点 + 门绿）

| 增量 | 做什么 | DoD |
|---|---|---|
| **0** 走 AC8 标死路 | 起前端,以 catalog_admin 真走"建切片→工作流→意图→agent→场景入口→前台推演",逐控件记死路 | 贴截图清单:哪步死路/半路/风险(对照摸底:步1 切片无入口·步2 缺试运行·步3 objectRef 缺 refType) |
| **1（P0）** C5 求解器目录页 | `/admin/solvers` 只读页(key/名/description/argHints,来自 SOLVER_KEYS);WorkflowsPage solverKey 改下拉引用此页+"查看"按钮 | 真点:workflow 步选 solverKey 从下拉选+可查看 schema;空态合法说明 |
| **2（P0）** C6 12 引用控件闭合 | 逐个补"＋新建(跳目标编辑器发布后回填)+空态有路+可查看":agent 编辑器 skills/workflow/mcp/规则·workflow 步 agentKey/ruleIds·场景 defaultAgent/intentFilter·策略 role | §5 逐控件核:12 个全部三态齐,无死路(真点每个＋新建可达) |
| **3（P1）** C7 切片编辑器 | `/admin/slices` 加 root+hops 可视化构建器 + contractFixture 录入 + 试切预览子图(复用 planSlice/resolveSlice) | 真建一张切片→试切出子图→入库(AC8 步1 通) |
| **4（P1）** C8 试运行 + render 可视 | WorkflowsPage 加"试运行"(调 `POST /b/v1/workflows/:id/run` 内嵌时间线+结果);render_answer 改 block 可视编排(text/table/kpi/rule_violation/action_draft 增删,绑 {{steps.*}}) | 编辑器内试运行所见即所得;render 不再裸 JSON(D-28 合规) |
| **5（P1）** C9+C10 评测 CRUD + objectRef refType + 分类测试 | EvalsPage 加用例 CRUD(input/expect)+从兜底/任务一键转;CatalogPage objectRef 槽位出"目标对象类型"下拉(不选发布拒)+"试分类"按钮 | agent 发布门禁(≥3 用例)可满足;objectRef 槽位闭合(AC4);改 examples 当场试分类命中 |
| **6（P2）** C11+C12 DSL 辅助 + 迁移页 | 规则/权限 expression 框加属性补全(Order.→联想)+实时校验+dry-run(裸框不通过 D-28);配置迁移工作台(导出/干跑 diff/应用) | DSL 框输"Order."弹补全;迁移页可导出 bundle+干跑 |
| **7** AC8/AC9 验收 | 真走 catalog_admin 从零建场景到前台推演全程;逐控件 AC9 巡检 | **亲手走通无死路**(贴全程截图);AC8 成立 |

## 4. 红线
十红线(尤 **RL3** 不重写 38 已建页 · **RL5** 零业务常数,目录/下拉来自注册表非写死 · **RL9** additive 可回退);**D-27**(引用控件三态:可达/空态有路/可查看) · **D-28**(DSL 禁裸文本框,必补全+校验+dry-run)。stale-source:以 §1 锚点为准。模型标识不进提交物。

## 5. 评审协议
①十红线+D-27/D-28 ②门全绿 ③本体回写(若新页/控件触本体) ④**§1 追溯表逐行核**(C1-C4 没重写、C5-C12 真补) ⑤**FDE 亲手证据**:增量0/7 必附**真浏览器走 AC8** 的截图(逐控件无死路)——不认 jsdom 测试绿(jsdom 测不出死按钮,见 G-4 教训) ⑥**12 引用控件逐一核**(轴2:每个＋新建可达+可查看,无死路) ⑦北极星距离(AC8 还差哪步)。

## 6/7. 提交按 `START-HERE §6`;起步=增量0(真走 AC8 标死路,贴截图)。push 前 rebase,只推 `claude/vigilant-knuth-b1nmxn`,co-author `Claude <noreply@anthropic.com>`。
