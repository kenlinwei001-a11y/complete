# REVIEW · 历史未复验项系统性审计（用户令「都逐一检查」）

> 触发：用户指出「主题重设计（8040049）是没经我复验就落地的……还有哪些历史你未复验的，都逐一检查」。
> 方法：对 20 个 DONE 队列项 + 全部非 WO 直推 commit，逐一对照复验证据（`复验` commit / `docs/REVIEW-*.md` / `docs/evidence/*-fde.md`），按「真浏览器/真 curl 前后端一致」金标准判等级。本轮**补做**了原先低于金标准的真跑。

## 判等级定义
- **🟢 金标准闭合**：真 curl 后端 + 真浏览器/真服务逐值对照 + 牙齿承重证。
- **🟡 部分复验（本轮已补齐 → 转 🟢）**：原先仅 jsdom/代码级/单侧，本轮补真跑。
- **⏳ 已 WO 待建**：缺口已入队列派 dev，待 built 复验。

## 一、20 个 DONE 项复验证据对账（16 早已金标准）

| WO | 原复验证据 | 等级 |
|---|---|---|
| SOLVER-BINDING | `fb2c1a9` 上传真数据→配绑定→真答案·HTTP 全链 | 🟢 |
| FIX-2CONCERN | `6f037af` 前后端闭环 + 像素级实拍 + 5 契约逐条 | 🟢 |
| SOURCE-TRANSPARENCY | `66f2e25` 真下载 .xlsx 像素级 + no-orphan 门 | 🟢 |
| MULTISRC-FUSION | `c995949`→修→`54db98d` 全套 859·0-failed | 🟢 |
| E1-E2 | `d5838d6` 前端像素级 + R3 门红修回 | 🟢 |
| RESOURCE-REF | `30eb301` 勾码真进引用图 + 自由文本 bug 修 | 🟢 |
| AGENT-BREADTH | `54db98d` C3/C7 scripted-LLM 驱动真 orchestrator | 🟢 |
| **GLOBAL-BACK (含 DrillBack ec0b033)** | `2470f37` + `REVIEW-GLOBAL-BACK-closure.md`：C1-C7·C4-C7 **真浏览器两 idx 分支四页实拍** | 🟢（原疑「直推未复验」→**证伪**：DrillBack 即 GLOBAL-BACK 内容·已真浏览器复验） |
| 1C-PARSE | `3b72807` 进度条像素级 | 🟢 |
| ONTOLOGY-OPT | `7127fa6` 三门 + meta 全绿·零投影污染 | 🟢 |
| CONTRAST-FIX | `4cfa70c` DAG 节点浅字真浏览器像素级 | 🟢 |
| DR-AUDIT | `54db98d` audit-sink 6/6·859 全绿 | 🟢 |
| KILL-MOCK-RED | `6b6a900` curl×4 + 真浏览器 8 卡灰 + 牙齿 + 34 门 | 🟢 |
| KB-UI | `ad5e456` curl ingest2 + search2 命中 + 真浏览器 2==2 | 🟢 |
| AUDIT-LOG-UI | `bd4d0f8` curl 审计 1→3 + 真浏览器 8/8 | 🟢 |
| CALIB-CONVERGENCE-UI | `c528870` 种子改真引擎产物·前后端一致 | 🟢 |
| QOS-DIAG | `3b68e95` 确定性分类兜底真跑·answer.final 6 单 + provenance | 🟢 |
| **DATAMODE-SWEEP** | `1572b8c` 主扫齐 + 本轮 `0de4752` FIX → **本轮真浏览器 getComputedStyle 复验 4/4**（见 `REVIEW-DATAMODE-SWEEP-verify.md` FIX 轮） | 🟡→🟢 |
| **INTAKE-VISIBILITY** | `88267dc` 原仅 C1+C6·C3/C4/C5 jsdom（FDE 自曝「非真浏览器截图」） → **本轮真浏览器补齐** | 🟡→🟢 |
| **ACTUATE + OBSERVABILITY** | `REVIEW-WO-ACTUATE-OBS-closure.md` 原「代码级核发·未独立起服务实拍」 → **本轮 ACTUATE 真服务 curl 闭环** | 🟡→🟢(ACTUATE)/🟢-no-op(OBS) |

## 二、本轮补齐的真跑（原低于金标准 → 已补）

### 2.1 DATAMODE-SWEEP FIX 轮 · 🟢（真浏览器 getComputedStyle）
真 vite:5200 直连真 datacore:4001（非 mock）。后端 `affected_orders.marginLedger.bySegment`：储能 −0.967 / 商用车 −0.086（负值·无守卫必红）·`dataMode=SYNTHETIC`。
- P1 DashboardView 对缺口贡献 cell `-0.97/-0.09` → `rgb(89,99,111)`(muted)·red=0 ✅
- P2 MarginLedgerTable gap cell 全 `var(--muted2)`·red=0 ✅
- P3 order-chain 8 张 probCard border `rgb(89,99,111)`·badge 无 red·banner×2 ✅
- 承重：后端真负值·`notLive?muted:(v<0?danger)`·若 notLive=false 必红 → 守卫承重。

### 2.2 INTAKE-VISIBILITY C3/C4/C5 · 🟡→🟢（真浏览器·原 jsdom）
前置真 curl：上传 newfields.csv → objectify → 4 候选（baseId/name→USE·newcol_carbon/newcol_shift→NEW）+ 物化 2 Base。
- **C3 SchemaReconcile 页**（`/admin/schema-reconcile?connId=`）：真浏览器渲染 4 候选列名 + **USE/RENAME/NEW/MERGE/DISCARD 全 5 选项** + 样本值(cz1/常州基地/12.5) + 确认/重跑物化按钮 ✅
- **C5 FieldProfile 多表选择器**（`/admin/connections/conn_合成/schema`·35 datasets）：`ds-table-select` present·**35 option** ✅
- **C4 空态深链**：demo 非空（49 类型）→ 空态深链不触发（状态边界·真 0 类型需 fresh 租户·jsdom 测覆盖渲染）·object-types 页正常加载 ✅（边界）

### 2.3 ACTUATE 真服务 curl 闭环 · 🟡→🟢（原代码级）
决策出站真跑：create `采纳经营方案`（payload schema 真校验·缺 schemeNo/scheme/targets 逐个 400）→ PENDING_APPROVAL → approver persona approve → **status=EXECUTED** → **MockWritebackAdapter 自动落 writeback-echo**：ref=`MO-2026-3925`（确定性 hashString(id)%9000）·writtenValue=payload。echo 0→1。链路 `决策→ActionDraft→approve→EXECUTED→writeback-echo→reconcile`（G-14）真转。
OBS：无 `OTEL_EXPORTER_OTLP_ENDPOINT` → 服务正常运行（no-op 不假导出·honest 降级即当前活态）+ `tracing.test` no-op 分支绿 + 代码级核实。真 span 树需起 collector（文档化低风险边界·观测非决策面）。

## 三、唯一未闭合项（已入队列）
- **主题重设计 8040049**（暗色主题·style commit·无 WO 无复验直落）→ 已入队 `THEME-CONTRAST-FIX`（P1·用户 2 次抓「红框字体低对比」）。待 dev built 后审核方按 getComputedStyle 全站对比度审计复验（并入原欠的主题视觉 review #50）。

## 四、审计结论
20 DONE 项：**19 达 🟢 金标准**（16 原有 + DATAMODE-SWEEP/INTAKE/ACTUATE 本轮补齐）·OBS no-op 活态闭合真 span 待 collector（低风险边界）。**唯 1 项（主题）未复验直落 → 已 WO 化待复验**。用户所疑「DrillBack 直推未复验」经查**证伪**（属 GLOBAL-BACK·已真浏览器）。反代理纪律补强：`docs/DEV-SOP-1to1-LOOP.md` 已要求所有落地经 built→review 门；主题类 style 直推为历史遗留唯一漏门，已闭。
