# 亲手用一遍 · 真相审计（§0）

> 方法（`fde-delivery` SOP）：起真服务（datacore:4001 + agentcore:4002，SEED_DEMO，跨系统 SERVICE_TOKEN+AGENTCORE_BASE_URL 已配），以 admin 身份用真实端点驱动端到端流程，记录"声称完成 vs 实际能用"。**非单测**。
> 首轮覆盖：数据构建发动机主线（故事→倒推→各模块生成→场景启动器→推演）。

## 数据构建发动机主线 · 实测结果（2026-06，真服务真请求）

对照两条故事跑同一条主线:

| 验收项（体验） | 策展故事「常州…风险推演」 | 真实新颖故事「工序/设备/共享瓶颈/降级/后果」 |
|---|---|---|
| build 成功 | ✅ SUCCEEDED | ✅ SUCCEEDED **（但空心）** |
| 倒推对象类型 | ✅ Base/Order/… | ◐ 仅 Order/Line/Customer（**漏 Process/Equipment**） |
| 倒推规则 | ✅ C03/C13/C05 | 🔴 **0** |
| 倒推求解器 | ✅ affected_orders/capacity_forecast | 🔴 **0** |
| 倒推切片入库 | ✅ slice_*（本轮已修，库里看得见） | ◐ slice_order/line/customer（**无工序/设备切片**） |
| 倒推 agent | ✅ agt_*（跨系统 scaffold 全 SCAFFOLDED） | 🔴 **0** |
| 跨系统全链闭包 | ✅ fullChainOk=true（plan/intent/scene/wf/skill/agent 全建） | —（无可建） |
| 场景进启动器 | ◐ **仅 `?includeDraft=true` 可见**；默认（PUBLISHED）看不到 | 🔴 **0，启动器无此卡** |
| 自检 verdict | （未测此句） | 🔴 **ANSWERABLE（谎报"无缺口"）** |
| 真能推演该问题 | （未测此句） | 🔴 **FAILED，无答案**（path AGENT，无 LLM） |

## Verdict（诚实）

**1. 策展故事 + 跨系统已配 → 倒推到各模块的生成是真的、可用的（给应得的肯定）。**
solvers/rules/scenes/agents 全部真建出，跨系统 scaffold 全链 `fullChainOk=true`。这条不是 vapor。

**2. 但即便 happy path，终态闭环仍缺一环（离"在启动器看到并真推演"还差）：**
生成的场景是 **DRAFT**，默认不进场景启动器（只有 `includeDraft` 才看得见）→ 用户看不到、跑不了。缺"**审批(R4)→publish→进启动器→重跑验证**"的末步。建域也不自动产出推演答案（answer=无）。

**3. 真实新颖故事 → 完全空心，且系统自己不知道（核心差距 + 一个真 bug）：**
- comprehend 关键词目录听不懂"工序/设备/瓶颈/降级/后果" → 0 规则/求解器/agent/场景；
- 🔴 **selfCheckGaps 谎报 `ANSWERABLE`**：因为它只查"已倒推的制品有没有 MISSING"，而"comprehend 压根没倒推出东西"时无 MISSING 项 → 误判无缺口。**"听不懂"没被当成缺口**——这是这次亲手跑才暴露、任何单测都没抓到的真 bug。
- 把该问题真提交 QOS → **FAILED 无答案**（无 LLM、path B 兜底也跑不动）。

## 这次审计的元价值

`status=SUCCEEDED` + `gapReport=ANSWERABLE` + 单测/gates 全绿——**全是绿的,却完全没回答用户的问题**。这正是"绿测试≠能用"的活样本,而且**是亲手跑真系统才发现的,单测一个没抓到**。印证 `fde-delivery` SOP 的必要性。

## 由此确认的下一步（按离北极星距离排序）

1. 🔴 **修 selfCheckGaps 谎报**：comprehend 覆盖率低（故事大量句子未映射）时,必须报"未理解/缺口",而非 ANSWERABLE。让系统"知道自己不懂"。
2. 🔴 **LLM comprehend 大脑**：听懂任意业务语言 → 真倒推 Process/Equipment + 瓶颈求解器 + 降级规则 + 后果推演 + agent（§2 核心）。
3. **终态闭环**：DRAFT 场景 → 审批 → publish → 进启动器 → 重跑验证可推演。
4. 富多跳切片 + 拟真值（§3）。

> 其余模块（连接器/对象浏览/Agent 页/推演链路）的逐一 hand-run 待续,方法同上。
