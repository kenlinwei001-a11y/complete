# 协同并行编排 · worktree 分道 + 依赖/冲突图（dev 照此认领·勿自行推断并行性）

> 审核方产出（用户定：审核方分析依赖·明确 worktree 是否可并行·dev 不必自己想·有异议再交流）。
> 原则：**冲突判据 = 是否改同一文件**。改同一文件的 WO **不可并行 worktree**（合并冲突）→ 同道串行、一个 worktree 独占该文件按序做；文件树**互不相交**的 WO → **可并行 worktree**。

## 0. 三条互不相交主道（可 3 worktree 并行）+ 孤立单（各自可并行）

| 道 | 文件树 | 主要文件 |
|---|---|---|
| **道 S · datacore 求解器/时序** | `apps/datacore/src/solvers/**` + `calibration/**` + `livedin/**` + `synthetic/service.ts` + `seed.ts` | extended.ts(热点·5单) · risk.ts(3单) · service.ts · calibration · livedin/engine.ts |
| **道 A · agentcore 编排/意图** | `apps/agentcore/src/{scenarios-catalog,server,growth/**,intents,catalog}` | scenarios-catalog.ts · server.ts · growth/scenario-grow.ts |
| **道 F · frontend 视图** | `apps/frontend-shell/src/views/**` + `pages/admin/**` | 决策视图(SopBalance/Dashboard/OrderChain/QuarterlyRolling) · sim视图 |
| **孤立**（任意 worktree 并行·footprint 独立） | — | `AGENTCORE-TRACE-LINEAGE`(agentcore/router) · `META-SYNC-CWD-FIX`(datacore/meta) · `SIM-REAL-SNAPSHOT`(frontend/views/sim·与决策视图不同文件) |

**道 S / 道 A / 道 F 三者文件树不相交 → 可同时开 3 个 worktree**；三孤立单再各占 worktree（≈最多 6 并行）。**道内**因共享热点文件必须**串行**（下表）。

## 1. 道内串行序（共享文件·一 worktree 独占按序做）

### 道 S（求解器·共享 extended.ts/risk.ts/service.ts/livedin）——**串行**，荐序：
1. `CALIB-HONEST-EMPTY`（WIP·calibration+livedin·先行不阻他）
2. `RISK-TRAJECTORY-DEFAKE`（risk.ts 轨迹/事件 + extended.ts yield/gap·不作假优先）
3. `HARDCODE-SOLVER-PARAMS`（extended.ts 全 13 solver + risk.ts 阈值入 param·紧接 defake 同文件）
4. `HARDCODE-BIZ-ENTITY`（risk.ts segOfCust + scenarios-catalog/livedin/connectors·部分跨道 A→见 §3）
5. `HARDCODE-CLOCK-DERIVE`（extended.ts 时间默认 + seed + livedin·dep LAUNCHER-GROUNDED·见 §2）
6. `HARDCODE-DISPATCH-REGISTRY`（**结构重构 extended/service dispatch registry 化·放最后吸收前面已定逻辑**·否则前 5 单要 rebase 到 registry）
   - `PROVENANCE-SWEEP`（4 solver 加 provenance 字段·低冲突·可插在 2–3 之间或紧随）
   - `METHOD-MC-STOCHASTIC`（若返修·capacity/service/vle-oracle·与本道同文件·串入）

### 道 A（编排·共享 scenarios-catalog.ts/server.ts）——**串行 + dep 链**：
1. `GROWTH-WORKLIST-HUMAN-FILL`（growth/scenario-grow + server 端点 + 契约 WorklistItem）
2. `LAUNCHER-GROUNDED-QUESTIONS`（**dep GROWTH-WORKLIST**·scenarios-catalog 接地 + server launch）
3. `INTENT-MATERIALIZE-BINDING-COMPLETE`（intents 物化 + server 端点 + scene-agent-config·紧接 catalog 同文件）

### 道 F（前端视图·共享 SopBalance/Dashboard/OrderChain/QuarterlyRolling）——**串行**，荐序：
1. `HARDCODE-VIEW-LAYOUT`（**结构入 ViewConfig.layout·先做·后面在新结构上改**）
2. `FRONTEND-VALUE-AUTHORITY`（消费后端权威值·同这批视图）
3. `HARDCODE-SOLVER-PARAMS`(前端阈值部分) + `HARDCODE-CLOCK-DERIVE`(QuarterlyRolling 部分)（同视图·紧随）
   - `VIS-SIGNALS`/`VIS-SIGNALS-2`/`UI-POLISH`（前端信号/透出/瑕疵·低冲突·插空或收尾）
   - `SANDBOX-LAYOUT-REWORK`（WIP·sim 视图·与决策视图不同文件·可与道 F 决策视图并行）

## 2. 硬依赖链（跨道·必先后·非文件冲突而是逻辑依赖）
- `GROWTH-WORKLIST-HUMAN-FILL` → `LAUNCHER-GROUNDED-QUESTIONS` → `HARDCODE-CLOCK-DERIVE`（后者 dep 前者·且 LAUNCHER 的空结果→认领复用 GROWTH 的 worklist）。
- `INTENT-MATERIALIZE` 逻辑上受益于 `GROWTH-WORKLIST`（自动补齐复用 self-growth scaffold）但**无硬 dep**·可并行（不同文件：intents vs growth/worklist）。

## 3. 跨道 WO（footprint 跨 2 道·**做时勿在所跨道并发同文件 WO**）
| WO | 跨 | 处置 |
|---|---|---|
| `HARDCODE-BIZ-ENTITY` | 道 S(risk.ts) + 道 A(scenarios-catalog/livedin) | 拆两半或独占：做时道 A 勿并发 scenarios-catalog 类 WO |
| `HARDCODE-SOLVER-PARAMS` | 道 S(extended/risk) + 道 F(前端阈值) | 前端阈值部分可待道 F 的 VIEW-LAYOUT 后做（阈值随 config） |
| `HARDCODE-CLOCK-DERIVE` | 道 S(extended/seed/livedin) + 道 F(QuarterlyRolling) | dep LAUNCHER·前端部分并入道 F 尾 |
| `GROWTH-WORKLIST` | 道 A + 前端 GrowthCockpitPage(道 F 但 admin 页非决策视图·低冲突) | GrowthCockpitPage 与决策视图不同文件·基本不撞 |

## 4. 「现在就能并行」的 worktree 建议（≈6 并发·全 footprint 不相交）
| worktree | WO | 为何安全 |
|---|---|---|
| wt-S | `CALIB-HONEST-EMPTY`(WIP) | 占道 S calibration/livedin |
| wt-A | `GROWTH-WORKLIST-HUMAN-FILL` | 占道 A growth/server·与道 S/F 不相交 |
| wt-F | `HARDCODE-VIEW-LAYOUT` | 占道 F 决策视图·与道 S/A 不相交 |
| wt-1 | `AGENTCORE-TRACE-LINEAGE` | agentcore/router·与 GROWTH 的 growth/ 不同文件（注意 server.ts：TRACE 不改 server·GROWTH 改端点·不撞） |
| wt-2 | `META-SYNC-CWD-FIX` | datacore/meta/service.ts·孤立 |
| wt-3 | `SIM-REAL-SNAPSHOT` | frontend/views/sim·与道 F 决策视图不同文件 |

> dev：以上 6 单**可同时开 6 个 worktree 并行建**（互不改同一文件）。各道后续单**必须等本道前一单 merge 后**再在同 worktree 续（共享热点文件）。有异议（如你判断某两单其实不撞、或某单该拆）→ 在队列 note 或直接说，我们对齐。

## 5. 维护
- 本表随队列增删同步（审核方维护）。新 WO 入队时审核方标其**道 + 冲突文件 + worktree 安全性**。
- 判据永远是「改同一文件？」——同文件串行·异文件并行。dep 字段（work-queue.json）管逻辑先后·本表管文件冲突并行性。

## 6. 陈旧认领仲裁规则（2026-07-05 死锁复盘新增·审核方执行）
- **规则**：WIP 认领超过 **24h 无该单相关提交** → 审核方有权释放（WIP→TODO·清 owner·note 记录半程产物锚点），任何在场 dev 可续做。续做必须**基于已落半程提交继续**（note 会给锚点 commit），禁止重启重写。
- **首例**：SANDBOX-LAYOUT-REWORK——peer 会话 07-02 15:05 后失联 2.5 天，07-05 03:03 释放（半程锚点 f88189c：§2/§3 决策卡组件+§5 折叠卡）。
- **根因**：两侧会话均为回合制，认领无心跳；本规则以"最后相关提交时间"为心跳的替代判据。

### §6.1 机制化落地（不再靠自觉·2026-07-05）
- `node scripts/collab-queue.mjs health` —— LOOP 体检：陈旧 WIP（失联判据=该单最后**施工侧**相关提交>24h·审核方复验/仲裁类提交不算心跳）· 积压 BUILT（>2h 无裁决→提示升级激活审核方）· 最后队列活动。**exit 1=有病灶**，两侧每次激活先跑。
- `node scripts/collab-queue.mjs sweep` —— 自动释放陈旧 WIP：WIP→TODO·清 owner·note 自动记**半程锚点 commit**（续做基于其上勿重启）。阈值 env 可调（STALE_WIP_H/STALE_BUILT_H·齿检用）。
- 状态迁移全部盖 `at.{wip,built,done,blocked}` 时间戳 + `meta.lastActivity{role,cmd,id,at}` 心跳（工具层时间戳·非产品 R6 范畴）。
- 双侧升级协议：dev 激活时 health 见积压 BUILT>2h → 在给用户的答复里点名"审核方需激活"；审核方激活时 health 见 STALE-WIP → 直接 sweep（首例 SANDBOX 已走通）。
