# WO-BEFE-A · 分诊表：41 条「后端注册了、前端零调用」端点（ontology / ontology-workflows / slices / meta）

> 实测日期 **2026-08-14** · 分支 `claude/handoff-wo-befe-a`（基于 `origin/claude/verify-reclaim-6` @ `36a7ffde`）
> 现跑清单命令（不许照抄）：
> ```bash
> node -e 'const B=require("./scripts/backend-frontend-seam-baseline.json");
> const s=e=>(/^\/(?:a|b|api)\/v1\/([^/*]+)/.exec(e.split(" ")[1]||"")||[])[1];
> const mine=B.endpoints.filter(e=>["ontology","ontology-workflows","slices","meta"].includes(s(e)));
> console.log(mine.length); mine.forEach(x=>console.log(" ",x));'
> ```
> 分诊**不靠端点名猜** —— 每条都追到路由处理函数，读它的鉴权与调用方（铁律 0.5）。

## 0 · 金丝雀（先自证工具，再信否定结论 · 铁律 0.6）

本分诊的核心否定结论是「这条端点前端零调用方」。报它之前先跑一个**已知有消费方**的端点同法查：

| 探针 | 期望 | 实测 |
|---|---|---|
| `GET /a/v1/ontology/object-types`（**已知有**消费方） | 命中 >0 | `endpoints.ts:200` `fetchObjectTypes` ✅ |
| `GET /a/v1/ontology/domains`（**已知有**） | 命中 >0 | `endpoints.ts:253` `fetchDomains` ✅ |
| `createLinkType` / `link-types`（**待证零**） | 0 | 修前 0 个生产文件 ✅ |
| `linkTypes`（**反向**：字段名有消费方，但全是**读**） | >0 且全为渲染 | 4 个文件，`MappingOverlay` / `SandboxView` / `ModelingPage` / mocks ✅ |

⇒ 工具有效；下面每条「零调用」才有资格被相信。
门自身的金丝雀：`node scripts/check-backend-frontend-seam.mjs` 报 **19/19 全中**。

## 1 · 分诊结果总表

三类：**(1) 真缺口**（租户/管理员该用的能力，今天只能 curl）· **(2) 设计上不该有前端** · **(3) 已有等价前端入口**。

### (2) 设计上不该有前端 —— 5 条（**服务间调用，B→A**）

判据不是端点名，是**调用方**：`apps/agentcore/src/tools/datacore-http.ts` 逐条 REST 调它们，
前端**不该**有第二条路（那会造出与 B 侧不同口径的第二真相源）。

| 端点 | 真调用方（file:line） | 说明 |
|---|---|---|
| `GET /a/v1/ontology/type-semantics` | `apps/agentcore/src/tools/datacore-http.ts:97` | 口径语义喂 B 的 LLM prompt；B 侧 TTL 60s 缓存 + 事件失效 |
| `POST /a/v1/ontology/resolve-ref` | `datacore-http.ts:156` | 槽位填充唯一入口（`tools/clients.ts:37` 注释明写） |
| `POST /a/v1/ontology/cross-validate` | `datacore-http.ts:202` | 推演结论 × 知识图谱交叉验证 |
| `POST /a/v1/ontology/validate-output` | `datacore-http.ts:208` | 工具/MCP 输出按本体 schema 强校验 |
| `GET /a/v1/meta/breakpoints/*` | `datacore-http.ts:214` | 断点详情，Agent 工具侧读 |

**处置：不接。** 建议在基线里给这 5 条加 `why`（不是删条目）—— 它们不是欠账，是设计。

### (2) 设计上不该有前端 —— 2 条（**内部编译/契约跑批**）

| 端点 | 鉴权 / 形态 | 理由 |
|---|---|---|
| `POST /a/v1/ontology/derivation-specs/compile` (`app.ts:3730`) | 无角色门，批量编译派生规格 + 写 `element_refs` 索引 | 是**建域流水线的一步**（`databuilder` / `ontology-core` 内部编排），不是人工操作面；给它按钮 = 让人手动触发一段本该由发布链自动跑的编译 |
| `POST /a/v1/ontology/slice-contracts/run` (`app.ts:2854`) | 无角色门，跑全部切片契约 | 注释自陈「发布门禁 + **CI 手动触发**」；它的正门是发布门与 CI，不是租户界面 |

### (3) 已有等价前端入口 —— 4 条

| 端点 | 等价入口（file:line） |
|---|---|
| `GET /a/v1/slices/*/references` (`app.ts:2838`) | 与 `GET /a/v1/ontology/slices/*/references` (`app.ts:2842`) **同一个 `governance.sliceReferences`**，纯别名；切片面在 `SliceInspector.tsx` / `SlicesPage.tsx` |
| `GET /a/v1/meta/*/*`（`invariants`/`events`/`domains`/`slices`/`object-types` 五段循环注册，`app.ts:2377`） | `MetaPage.tsx` 已消费 `GET /a/v1/meta/ontology`（总量 + byKind）与 `GET /a/v1/meta/impact`；逐节点详情是同一份元对象的下钻，属 MetaPage 增量而非独立缺口 |
| `POST /a/v1/ontology/publish` (`app.ts:2931`) | **故意不接**：等价治理入口是 `publish-requests` + `signoff`（全域 APPROVE 后 `app.ts:2891` 自动调 `publishVersion`）。直连它会**绕开域 owner 会签** ⇒ 违 R4。本单已接会签链；接缝测试 §③ 有一条专门断言页面**没有**这条 URL |
| `POST /a/v1/ontology/recompute` (`app.ts:3753`) | 前端已有等价出口 `POST /a/v1/inference/whatif`（`app.ts:3765`，同一个 `ontologyCore.recompute`，只是 `dryRun`）——被 `/v/what-if` 页消费。裸 `recompute` 会**真写派生值**，不该给前端裸按钮 |

### (1) 真缺口 —— 30 条

**本单已接（12 条，基线真降）**

| 端点 | 后端 file:line | 鉴权 | 前端落点 |
|---|---|---|---|
| `POST /a/v1/ontology/link-types` | `app.ts:2918` | 租户 ctx | 结构边「建」 |
| `POST /a/v1/ontology/links/*/deprecate` | `app.ts:2797` | 租户 ctx | 结构边「停用」 |
| `POST /a/v1/ontology/links/*/retire` | `app.ts:2802` | 租户 ctx（引用>0 → 409） | 结构边「下线」 |
| `POST /a/v1/ontology/types/*/deprecate` | `app.ts:2788` | 租户 ctx | 对象类型「停用」 |
| `POST /a/v1/ontology/types/*/retire` | `app.ts:2793` | 租户 ctx（引用>0 → 409） | 对象类型「下线」 |
| `GET /a/v1/ontology/references` | `app.ts:2808` | 租户 ctx | 「查引用」面板（下线前置检查） |
| `GET /a/v1/ontology/versions` | `app.ts:2932` | 租户 ctx | 已发布版本号 + **唯一带 `deprecation` 的只读口** |
| `GET /a/v1/ontology/publish-requests` | `app.ts:2875` | 租户 ctx | 会签列表 |
| `POST /a/v1/ontology/publish-requests` | `app.ts:2860` | 租户 ctx | 发起会签 |
| `POST /a/v1/ontology/publish-requests/*/signoff` | `app.ts:2879` | 租户 ctx | 逐域同意/驳回 |
| `GET /a/v1/sim/propagation-rules`（不在 41 内，WO §4 指定） | `app.ts:1860` | `requireSim(sim.propagation)` 暗发 | 因果边列表 |
| `POST /a/v1/sim/propagation-rules`（同上） | `app.ts:1865` | `requireSim(sim.propagation)` | 因果边「建 + 启停」 |

**本单未接（18 条，真缺口挂账 · 各自成单）**

| 组 | 条数 | 端点 | 为什么不在本单做 |
|---|---|---|---|
| **对象接口（多态抽象，WO-69 P3）** | 5 | `GET/POST /a/v1/ontology/interfaces`（`app.ts:2730`/`2734` **requireAdmin**）· `GET …/interfaces/*`（`:2742`）· `GET …/interfaces/conformance`（`:2741`）· `GET …/interfaces/*/implementers`（`:2765`） | 独立特性（接口声明 + 一致性报告 + 迁移清单），不是「关系」。基线注释已把它记为「后端 only、管理端 UI 未建」的已知欠账 |
| **对象接口发布/退役** | 2 | `POST …/interfaces/*/publish`（`:2750` requireAdmin）· `POST …/interfaces/*/retire`（`:2757` requireAdmin） | 同上。⚠ 见 §3「假消红」——本单一度**冒领**过 `interfaces/*/retire`，已修正回基线 |
| **OntoFlow 建模工作流** | 8 | `GET/POST /a/v1/ontology-workflows`（`:2817`/`:2818`）· `GET/PUT …/*`（`:2823`/`:2824`）· `POST …/*/validate`（`:2828`）· `…/*/preview`（`:2829`）· `…/*/nodes/*/promote`（`:2833`）· `…/*/publish`（`:2837`） | 一个完整的 DAG 编辑器（节点/边/数据处理预览/提升/发布）。**确有真消费方**：ActionType「流水线发布物化」在执行期读 `repos.ontologyWorkflows`（`app.ts:561`）⇒ 工作流今天只能 curl 建出来。属独立大单 |
| **切片库/索引** | 3 | `GET /a/v1/slices/index`（`:3492`）· `POST /a/v1/slices/library/build`（`:3480` **requireAdmin**）· `GET /a/v1/ontology/slices/*/references`（`:2842`） | 归 `SlicesPage` / `SliceLibraryPage` 的增量（那两页已存在且已接别的切片端点），不属「关系」 |
| **meta 派生 diff / 参考本体基线** | 2 | `GET /a/v1/meta/derive`（`:2393`）· `GET /a/v1/meta/refbase`（`:2348`） | 归 `MetaPage` 增量。二者都过 `requireMetaAccess`（`app.ts:2329`：**entitlement `admin.meta-ontology` 先于 authz**，关 → 404 `FEATURE_NOT_FOUND`；再查角色白名单 → 403） |

> 计数对账：5（服务间）+ 2（内部跑批）+ 4（已有等价入口）+ 12（本单已接，其中 10 条在 41 内）+ 18（挂账）
> = 5+2+4+10+18 = **39**；余下 2 条为 `GET /a/v1/meta/*/*` 与 `GET /a/v1/slices/*/references` 已计入 (3) 组内的合并行 ⇒ 合计 **41**。

## 2 · R4 判定（真值写入经审批）

`docs/SYSTEM-ONTOLOGY.md` §5 R4 原文：**真值写入经 Action 审批；对象物化/本体变更经 `domainExecutor`，EXECUTED 才落。**

逐条判：

| 写操作 | 写到哪 | 是不是真值 | 处置 |
|---|---|---|---|
| `POST /a/v1/ontology/link-types` | `repos.ontologyLinks.put`（**工作集**） | **否** —— 真值是 `OntologyVersion` 快照，由 `ontology.ts:331 publishVersion` 固化 | 前端可直写工作集 |
| `links/*/deprecate` · `types/*/deprecate` | 同上，改 `deprecation` 字段 | 否（同上） | 同上 |
| `links/*/retire` · `types/*/retire` | 同上；且后端**先查引用**，>0 抛 409 | 否 | 同上；409 原文上屏 |
| `POST /a/v1/sim/propagation-rules` | `repos.sim.putPropagationRule` | 否（传导规则是**推演配置**，不是世界态；`status=DRAFT` 时连推演都不进） | 前端可直写 |
| **`POST /a/v1/ontology/publish`** | `publishVersion` → **固化快照 = 写真值** | **是** | **前端不接**。走 `publish-requests` → 逐域 `signoff` → 全域 APPROVE 后后端自动发布（`app.ts:2891`）。接缝测试 §③ 有断言：页面源码里**不许**出现 `"/a/v1/ontology/publish"` |
| `POST /a/v1/ontology/recompute` | `ontologyCore.recompute`（非 dryRun ⇒ **真写派生属性**） | **是** | 不接（见 (3) 组：等价只读出口是 `inference/whatif` 的 dryRun） |

**结论：本单接的 12 条无一写真值；唯二会写真值的两条（`publish` / `recompute`）都判为不接，并各自给出已有的受控替代路径。**

## 3 · 两条本单实测到的「工具骗人」（铁律 0.5/0.6 实例）

### ① 事实锁扫描器吞掉 670 行可执行代码（**假红**方向）

`apps/frontend-shell/test/factlock.ts` 的 `stripComments` 先剥块注释、后剥行注释：

```
s.replace(/\/\*[\s\S]*?\*\//g," ").replace(/^[ \t]*\/\/.*$/gm," ")
```

一条**行注释里写了路由通配**就开出假块注释，一路吞到下一个 `*/`：

```
// `listCheckpoints`，但 24 条 `/a/v1/sim/*` 路由里从没有人开这个口
                                          ↑ 这个 /* 被当成块注释开头
```

全仓实测（复验脚本见 §附录A）：

| 文件 | 假开头 | 被吞可执行行 |
|---|---|---|
| `apps/datacore/src/app.ts` | 3 | 270 |
| `apps/agentcore/src/server.ts` | 1 | 145 |
| `apps/datacore/src/ontology-core.ts` | 1 | 97 |
| `apps/datacore/src/solvers/chain-impediment.ts` | 1 | 71 |
| `apps/datacore/src/features.ts` | 3 | 34 |
| `apps/agentcore/src/tools/executor.ts` | 1 | 32 |
| `apps/frontend-shell/src/views/sim/SandboxPlaysPanel.tsx` | 1 | 11 |
| `apps/agentcore/src/llm/providers.ts` | 1 | 10 |
| **合计** | **12** | **670** |

被吞的区域里正好有 `GET /a/v1/sim/view-config` 的处理器（`app.ts:1802–1954`）——
本单要钉的事实锁全在里面，问「这个事实还在不在」一律得到「不在」。

**为什么金丝雀没拦住**：`commentOnlyCanary` 只验「注释没被当成代码」（**假绿**方向），
对「代码被当成注释」（**假红**方向）天然免疫。照铁律 0.6 句式：
> **「我用『注释没被当成代码』当作『剥注释是对的』的证据，而前者只度量了一半。」**

**处置**：改成单趟左→右扫描（谁先出现算谁 + 跳过字符串/模板串）；
**补金丝雀④ `codeEatenCanary`**（行注释含路由通配 → 其后的真代码必须仍可见），
并写进 `checkedTree` 的四条前置断言里 —— 下次同样的失效，**机器先说话**。

**连带发现（这条缺陷一直在掩盖一个真漂移）**：
`apps/frontend-shell/test/chain-impediment.seam.test.tsx` 因定位器被弄瞎，
在 describe 收集期就抛「引擎 caveat 模板全树命中 0 处」⇒ **该文件 0 个用例被执行**。
修好扫描器后 41 个用例真跑，当场抖出：引擎已是 `C01–C34`（`solvers/chain-impediment.ts:237`），
前端 fixture/mock/test 还停在 `C01–C33`。三处已同步。

> 基线复验（先看红、再看修好）：
> ```bash
> git show 5a67624d:apps/frontend-shell/test/factlock.ts > /tmp/fl.ts   # 旧版
> # 换回旧版后：Tests no tests + 「引擎 caveat 模板全树命中 0 处」
> # 新版：41 passed
> pnpm --filter frontend-shell exec vitest run test/chain-impediment.seam.test.tsx
> ```

### ② 我自己造了一条「假消红」——URL 模板冒领别人的端点

`deprecateOntologyElement` 第一版把路径段写成三元：

```ts
`/a/v1/ontology/${kind === "link" ? "links" : "types"}/${encodeURIComponent(key)}/retire`
```

归一化后是 `/a/v1/ontology/*/*/retire` ⇒ **冒领**了我从没接过的
`POST /a/v1/ontology/interfaces/*/retire`，`--update` 把它从基线里摘掉了（13 条而非 12 条）。

照铁律 0.6 句式：**「我用『某条 URL 字面量匹配上了』当作『这条端点有前端消费方』的证据，
而前者并不度量后者。」** 消红消到不该消的地方，比不消更糟 —— 它把一条真欠账从账上抹掉。

**处置**：拆成两条各自的字面量路径；`interfaces/*/retire` 如实回到基线。
接缝测试新增一条用例把「真发出去的 URL 里有 `/types/`、没有 `/links/`」钉在链路上。

## 4 · 数字（修前 / 修后）

| 指标 | 修前 | 修后 |
|---|---|---|
| `befe-seam` 前端零调用（载体②） | **196** | **184** |
| 基线 `endpoints` 条数 | 186 | **174**（−12，只删不加） |
| 基线 `sseFields` 条数 | 4 | **3**（−1，`supersededBy`） |
| `befe-seam:check` RC | 1 | 1（**同样的 10 条上游既有新增**，无一落在本单四个一级路径） |
| `nav-group-coverage:check` RC | 0 | **0** |
| `stale-claims:check` RC | 0 | **0** |
| `chain-impediment.seam` | **0 个用例被执行**（收集期抛） | **41 passed** |
| 新接缝测试 | — | **16 passed，RC=0** |

## 附录A · 复验命令

```bash
# ① 41 条清单现跑（见文首）
# ② 门：基线真降
node scripts/check-backend-frontend-seam.mjs        # 看「前端零调用」那一行的数
# ③ 可达性
node scripts/check-nav-group-coverage.mjs           # RC=0
# ④ 接缝（含事实锁 + 金丝雀）
pnpm --filter frontend-shell exec vitest run test/ontology-relations.seam.test.tsx
# ⑤ stripComments 缺陷的血量复算
node -e '
const {readdirSync,readFileSync}=require("fs"),{join}=require("path");
const walk=d=>readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(d,e.name)):/\.tsx?$/.test(e.name)?[join(d,e.name)]:[]);
const old=s=>s.replace(/\/\*[\s\S]*?\*\//g," ").replace(/^[ \t]*\/\/.*$/gm," ");
let F=0,L=0;
for(const rel of ["apps/datacore/src","apps/frontend-shell/src","apps/agentcore/src","packages/contracts/src"])
for(const f of walk(rel)){const raw=readFileSync(f,"utf8"),st=old(raw);let lost=0;
for(const l of raw.split("\n")){const t=l.trim();if(!t||t.startsWith("//")||t.startsWith("*")||t.startsWith("/*"))continue;
if(raw.includes(t)&&!st.includes(t))lost++;}
if(lost){F++;L+=lost;console.log(f,lost);}}
console.log("受害文件",F,"合计行",L);'
```
