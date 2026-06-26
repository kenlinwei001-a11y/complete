# 总优先级开工单 · 全轨 P0 汇总（发给开发 agent 执行）

> **这是什么**：Pass-2 全覆盖后，把**所有轨（A–K）的 P0**汇成一张按优先级排好的开工单。每条指向它的施工文档（读那份的 §1 追溯表 + 增量）。**先做 Tier 0，逐 Tier 下推。**
>
> **铁律（每条都适用）**：① 动手前读该条施工文档的 **§1《源↔现状↔设计》追溯表**，标「真实」的**只接不重写**（真代码普遍比文档建得多）；② **第一步永远是增量0**（起真系统 FDE 真跑/真走一遍定基线，只看不改）；③ **完成=亲手跑一遍能用+截图证据，不是测试绿**；④ 只 commit+push `claude/vigilant-knuth-b1nmxn`，push 前先 `git fetch+rebase`，不开 PR；⑤ 有歧义先问。

---

## Tier 0 · 红线 / 北极星（最先做 · 关系"能用"与诚实）

| WO | 轨·项目 | 读这份施工文档 | 完成判据（FDE 真跑） |
|---|---|---|---|
| **WO-1** | **J · 数据流闭环 TR1-8 真通** | `PASS2-wave3-finishing-tasks.md §1`（DF-1..7） | 补齐产出事件发射（raw_dataset.uploaded/derivation.completed/materialize.completed/dataset.regenerated）+ **AgentCore→DataCore 跨栈 outbox 通道**（含松耦合 C-2 webhook，同一缺口）→ **真浏览器逐条走 TR1-8、产出后下游不重载即可见**（D-29/UP-1 红线） |
| **WO-2** | **K · QOS 全量真跑 + 数字可信** | `PASS2-wave5-finishing-tasks.md §1`（QOS-1/2） | ① 20 卡**逐卡** probe-e2e + 真 DataCore 联测（破 G-1/G-2 虚判，修种子 `seed.ts:215/245`）② 路径B **数字↔provenance 反向一致性校验**（现 LLM 自填可谎报）。贴 20 卡真跑 + 数字溯源证据 |
| **WO-3** | **A · 推演沙盘 P0** ⚠️**已有 agent 在做** | `HANDOFF-sandbox-build-and-review-contract.md §6.1.A` | 采纳→Action 草稿(**RL4 红线**)/分支→对比 UI/初始化向导/就绪面板砌齐/给 demo 种传导规则。**先 rebase 看进度，别撞别重复** |
| **WO-4** | **C · 数据构建发动机** | `HANDOFF-comprehend-engine-build-and-review-contract.md` | 增量0 用**新颖故事**真跑 runStory 坐实引擎；增量1 **用途→provider→model 路由表**（去 `service.ts:79` 硬编码）。§1 标「真实」13 项引擎主体只接不重写 |

## Tier 1 · 闭环 / 可信基建

| WO | 轨·项目 | 读这份 | 完成判据 |
|---|---|---|---|
| **WO-5** | D · VLE CI 门 | `HANDOFF-vle-build-and-review-contract.md`（增量1 V10+V9） | `scripts/check-validation.mjs` 跑 SMOKE 红阻断合并 + 静态独立性入门 |
| **WO-6** | E · 规则全入口生效 | `HANDOFF-rules-firstclass-p3-build-and-review-contract.md`（R9+R10） | 11/19 求解器接规则 payload 映射（去 NOT_APPLICABLE）+ 6 入口"改规则即改推演"FDE 对比截图 |
| **WO-7** | F · 场景自动发育 | `HANDOFF-ontogenesis-p3-build-and-review-contract.md`（增量1 O9） | `growScenario` 自动调 `runGrowthLoop`→缺件卡自动补成 GOVERNED；补不了诚实 PROVISIONAL+开票 |
| **WO-8** | G · 管理面 AC8 闭合 | `HANDOFF-admin-console-closure-build-and-review-contract.md`（增量1-2 C5+C6） | 求解器目录页 `/admin/solvers` + 12 引用控件闭合（＋新建/可查看，真浏览器点无死路） |

## Tier 2 · 核心模块收尾 P0（Pass-2 收尾清单）

| WO | 项目 | 读这份 | 完成判据 |
|---|---|---|---|
| **WO-9** | 账号权限 | `PASS2-wave3 §2`（AU-1/2） | ServiceAccount 权限 Admin UI + Agent 发布时 workflow 环检（A→W→A 拒） |
| **WO-10** | 求解器 LIVE 口径 | `PASS2-wave3 §2`（SV-1/2） | S1.5 affected_orders 真排产仿真（去 MOCK 哈希）+ S1.3 瓶颈 LIVE 4 因素 |
| **WO-11** | 运营完备性 | `PASS2-wave1 §1`（OC-1/2/3） | 提示词配置化消费端 + 对象 status 三态 + asOfEpoch 全链 |
| **WO-12** | 执行语义 | `PASS2-wave1 §1`（ES-1） | 任务级三态 FAILED_RETRYABLE/PERMANENT 落地（现 enum 零引用） |
| **WO-13** | M11 校准 | `PASS2-wave1 §1`（P0-1/2） | C12 触发钩子接线 + 周度 CALIBRATION_RUN 定时任务 |
| **WO-14** | 能力路由（~1h） | `PASS2-wave2 §1`（CR-1/2） | load_tools 工具注册 + >24 按需加载阈值激活 |
| **WO-15** | LLM 多厂商 | `PASS2-wave2 §1`（LP-1） | Workflow/Skill publish impact API（与规则侧对称） |
| **WO-16** | A7 合成 | `PASS2-wave4 §1`（W4-3/4） | discrete/retail 内置模板 + **LLM 新行业 SY3 真验**（与轨 C 共撑"听懂任意行业"） |
| **WO-17** | Skill 规范 | `PASS2-wave4 §1`（W4-9） | 多技能互斥重叠检查 + 出厂范例技能 |
| **WO-18** | 前端图谱（小） | `PASS2-wave5 §2`（FE-1） | 图谱 14 业务域配色对齐（现 6 域 muted 灰） |

## Tier 3 · 高回归专项（独立 PR + FDE · 谨慎）

| WO | 项目 | 读这份 | 完成判据 |
|---|---|---|---|
| **WO-19** | I · 驾驶舱数据层（25-30%，唯一真半成品） | `PASS2-wave2-finishing-tasks.md §2` | **三阶段必守**：低回归先（八根因种子/台账筛选）→ 中（八卡KPI/DAG/毛利求解器）→ **高回归专项独立 PR + FDE 逐值核 HTML 过基线，别混 commit**。求解器框架别重写 |

---

## 派活建议

- **Tier 0 四条先派**（可并行给不同 agent）：**WO-3 已有 agent 在做，别再派**；WO-1（数据流·跨栈，最重）/ WO-2（QOS）/ WO-4（发动机）各一个 agent。
- **一个 agent 一次只接一条 WO**；一条 WO 内若是 HANDOFF（含多增量）则增量**串行**。
- **WO-1 DF-5 跨栈 outbox 牵动大**：若发现 AgentCore→DataCore 回路改动面超预期，**停手报审核方**升级为独立 HANDOFF。
- **WO-19 驾驶舱单独一个 agent**，严守三阶段、高回归专项独立 PR。
- 去重：WO-1 已含松耦合 C-2 webhook；求解器有两处（WO-6 规则 payload 映射 ≠ WO-10 LIVE 口径，**都做但别混**）。

## 相关文档清单（agent 必读顺序）

1. **总入口**：`docs/START-HERE-dev-agent.md`（轨 A–K 表 + 全部纪律）
2. **铁律0**：`docs/SYSTEM-ONTOLOGY.md`（对象/链路/不变量 R1-R17/断点 G-1..G-11）
3. **真相表**：`docs/COMPLETION-LEDGER.md`（全域 Pass-2 定级 · 别照它盲建，按本开工单）
4. **轨 A-G 施工合同**：`docs/HANDOFF-{sandbox,optimization-fusion,comprehend-engine,vle,rules-firstclass-p3,ontogenesis-p3,admin-console-closure}-*.md`
5. **收尾清单**：`docs/PASS2-wave{1,2,3,4,5}-finishing-tasks.md`
6. **交付纪律**：`.claude/skills/fde-delivery`（完成=亲手用一遍能用）

> 一句话给开发 agent：**从 Tier 0 开始，一条 WO 接一条；每条先读其施工文档 §1 追溯表 + 增量0 真跑定基线，再动手；完成靠亲手跑+截图，不是测试绿。**
