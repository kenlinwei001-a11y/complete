# 测试集 · 本批改动（DRIL 智能检索层 + 上下文压缩 + 全局推演时间窗口口径）

> 给测试 dev：这批改动动了三块。下面**先说人话（解决了啥/对用户什么价值）**，再给**可照着点/照着跑的测试用例**。每条用例都写清了：怎么造前提、点哪里、期望看到啥、怎么判过没过。
>
> 分支：`claude/inspiring-gates-aqczjg`。四包单元测试已在 gate 全绿（不用再手跑，除非你要复验）。**本测试集重点 = 端到端真点真跑（绿测试≠能用）。**

---

## 一、这批改动解决了什么问题（人话版）

### 改动 1：DRIL —— 决策资源智能检索层（最大的一块）
**以前的毛病**：
- 用户随口问一个**没有现成 agent 对口**的长尾问题时，系统里的 agent 只会"盲扫"——一跳一跳去试探（discover 一次、再猜一次、再查一次），**又慢又容易答偏**。
- 规则（rules）、工作流（workflows）、技能（skills）、agent 定义**根本没法被统一检索发现**；本体切片、规则也没被索引成"能语义搜索的资源"。

**现在**：
- 所有资源（求解器 / 切片 / 规则 / 工作流 / 技能 / agent）**统一进一个资源注册表**，一次就能发现全量。
- 五级标签 + 混合检索（语义 + 领域 + 本体 + 历史 + 成本 打分排序）→ agent **一次就拿齐对口资源包**，不再盲扫。
- 自由问答（Path-B agent）**首轮提示词里直接塞进"DRIL 智能资源包"**（已经帮它预选好对口的求解器/切片/规则）→ 来回轮次 ≤4（以前可能十几跳），**秒级出答、答案口径不变、还带溯源标记 ⟦ref⟧**。
- 资源用得好/坏会用 EWMA 质量分记下来，**越用越准**。
- 后台多了个"资源治理页"，运营能看到并管理这些资源。

**对用户的价值**：**自由问答更准、更快**，尤其问到那些没有现成模板 agent 的问题时，不再答非所问或卡很久。

### 改动 2：上下文压缩 —— 长对话不撑爆
**以前的毛病**：agent 多步推演时，上下文越滚越长，会**撑爆 token 预算 / 变慢 / 丢失早期关键信息**。
**现在**：接了真 LLM 滚动摘要器——超长上下文自动**滚动压缩成摘要**，保留关键信息、控制 token。
**对用户的价值**：复杂的多步推演对话能**走得更长更稳**，不会中途因为太长而崩或答非所问。

### 改动 3：全局推演时间窗口口径修正（KILL-MOCK-RED）
**以前的毛病**：全局推演页面时间窗标"**21 天**"，但引擎实际按"**14 天**"算——**标 21 实跑 14**，用户看到的窗口和真实计算对不上，误导。而且前端 mock 也用 21，跟真后端 14 分裂成两套。
**现在**：页面标注、mock、真实后端**三者统一成 14 天**（引擎真实口径 `windowDays=14`）。
**对用户的价值**：**看到的时间窗 = 引擎真算的时间窗**，不再被假口径误导。

---

## 二、测试用例

### 环境准备（两种任选）
**A. 内存模式本地双服务（不用数据库，最快）**
```bash
pnpm install && pnpm -r build
# 终端1（DataCore）
PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 CREDENTIAL_KEY=<64位hex> node apps/datacore/dist/server.js
# 终端2（AgentCore）
PORT=4002 DATACORE_BASE_URL=http://127.0.0.1:4001 node apps/agentcore/dist/main.js
```
开发态认证头（不用真 JWT）：`-H 'X-Debug-User: demo:admin:admin|planner|catalog_admin'`
> ⚠️ **X-Debug-User 只在非生产（内存/本地 dev）模式生效**（DataCore `app.ts:736`：`NODE_ENV!=="production"` 才认这个头）。**docker/生产模式会忽略它 → 401**，此时必须用**真 JWT**（见下）。

**B. 前端点击态 / docker（生产模式·NODE_ENV=production）**：`docker compose up --build`（见 DEPLOY.md），登录 `demo / admin / demo1234`。
> docker 模式后端 curl 必须带**真 JWT**（X-Debug-User 会 401）：先登录拿 token —
> ```bash
> TOKEN=$(curl -s -X POST http://localhost/a/v1/auth/login -H 'Content-Type: application/json' \
>   -d '{"tenantId":"demo","username":"admin","password":"demo1234"}' | jq -r '.accessToken')
> AUTH="Authorization: Bearer $TOKEN"    # 下面 curl 用 -H "$AUTH" 代替 X-Debug-User
> ```

---

### T1 · DRIL 资源注册表：一次发现全量（后端）
**目的**：验证所有资源类型都进了统一注册表。
**步骤**：
```bash
# docker：-H "$AUTH"（真 JWT）+ 网关同源 localhost；内存态：-H 'X-Debug-User: demo:admin:admin|catalog_admin' + :4002
curl -s http://localhost/b/v1/resources -H "$AUTH" | jq '.items | group_by(.kind) | map({kind: .[0].kind, n: length})'
```
**期望**：返回里**同时出现 solver / slice / rule / workflow / skill / agent / intent / mcp_tool 多类 kind**（docker 全播种态实测 8 类·~144 条；内存态 ~88 条·类数相同）。每类 n≥1。
**判过**：≥4 种 kind 都有；**判不过**：只回 solver 或某几类缺失、或 500。

---

### T2 · DRIL 混合检索：语义搜得到、排序合理（后端）
**目的**：验证搜索接口能按语义找到对口资源并排序。
> **两个坑先看**（否则会误判红）：
> 1. **返回结构是嵌套** `{resource:{kind,key,...}, score, scoreBreakdown}`，不是扁平——jq 要用 `.resource.kind`。（注：agent 的 `retrieve_knowledge` 工具会**拍扁**成 `{kind,key,score}`；只有这个**原始 endpoint** 是嵌套。）
> 2. **不加 kinds 过滤时 intent 会排前面是正常的**——intent 带自然语言样例问句，NL 查询语义命中天然高。要验"对口 **solver**"，必须加 `"kinds":["solver"]`（agent 的组包 `buildResourcePackage` 本来就先过滤到 solver 再注入，所以 agent 拿到的是对口 solver·不受 intent 挤占）。

**步骤**（docker 用 `-H "$AUTH"`；内存态用 X-Debug-User）：
```bash
# ① 只看 solver（验对口归因求解器排序）——这是判 DRIL 路由准不准的正解
curl -s -X POST http://localhost/b/v1/resources/search \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"query":"储能份额为什么下降 逐层拆根因","kinds":["solver"],"maxResults":5}' \
  | jq '.results[] | {kind:.resource.kind, key:.resource.key, score}'
# ② 全类（会看到 intent 在前·正常）——仅用于观察全景
curl -s -X POST http://localhost/b/v1/resources/search -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"query":"储能份额为什么下降 逐层拆根因","maxResults":8}' \
  | jq '.results[] | {kind:.resource.kind, key:.resource.key, score}'
```
**期望（当前口径）**：①（kinds=solver）里 `gap_attribution` 进 **top-4**（= agent 组包 `buildResourcePackage.topSolvers` 默认取 4·所以对口 solver 真会进 agent 资源包）。②里 intent 靠前属正常。
> ⚠️ **已知精度缺口（在修）**：当前 solver 资源**没有灌 NL 样例问句 `answersQuestions`**，语义分只靠 description → 对口根因 solver 排不到榜首（实测 gap_attribution 第 4·margin_attribution 抢第 1）。**这不影响 agent 拿到 gap_attribution（它在 top-4 组包内）**，但精度不达"进前 3"。**WO-DRIL-PRECISION 正在给 solver 灌样例问句 + 补 solver→objectType 关系**，修完 gap_attribution 应进前 3。
**判过（当前）**：对口归因 solver 进 **top-4**；**判不过**：对口 solver 跌出 top-4 / 根本不出现。
**判过（WO-DRIL-PRECISION 合并后）**：gap_attribution 进 **top-3**。

---

### T3 · DRIL 图关系 + 质量分（后端）
> **quality 端点入参是 `{success:boolean, latencyMs:number}`**（EWMA 探针观测），**不是** `{outcome}`（那会 400 INVALID_QUALITY_PROBE·此前 doc 写错）。
> **关系**：`workflow --invokes--> solver`、`--includes--> slice`、`agent --binds--> skill` + `solver/rule --reads/scope--> objectType` 1-hop。**一个 solver 若没有工作流引用它、也没投影出 read 对象类型，relations 会是 0（不一定是 bug）**。要稳定看到关系，选一个 **workflow** 或被工作流引用的 solver。
```bash
# 关系：先挑一个 workflow（出边稳定非空）
curl -s http://localhost/b/v1/resources/workflow/<某workflow_key>/relations -H "$AUTH" | jq
# 质量分：正确入参 {success,latencyMs}，打一条再读回
curl -s -X POST http://localhost/b/v1/resources/solver/gap_attribution/quality \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{"success":true,"latencyMs":1200}' | jq
curl -s http://localhost/b/v1/resources/solver/gap_attribution/quality -H "$AUTH" | jq
```
**期望**：workflow relations 非空且有关系类型；打一条 `{success:true,latencyMs:...}` 后质量分（successRate）**按 EWMA 往上挪**（α=0.1·确定性·非随机）。
**判过**：quality 200 且 EWMA 有反应；relations 对 workflow 非空。**判不过**：quality 仍 400（入参没改对）或 EWMA 无反应。
**判过**：关系有内容 + 质量分对反馈有反应；**判不过**：relations 恒空、或质量分对反馈无变化。

---

### T4 · DRIL 接缝头号判据：开关驱动 Path-B 组包注入（最关键·SEAM）
**目的**：这是本批**头号验收判据**——DRIL 开 vs 关，自由问答 agent 的行为真的不同，且**关掉时零回归**。
**前提**：DRIL 路由是"暗发"（`qos.dril-routing` 默认关）。需要给 demo 租户**开启这个 entitlement**再测"开"的分支。

**步骤（开）**：给 demo 开 `qos.dril-routing` 后，问一个自由问题（走 Path-B agent），抓它的执行 trace：
- 问句示例："综合评估一下储能份额下滑的连锁影响，该怎么补"（这种"综合/连锁"是真开放题，会走 Path-B）。
- 看 agent 首轮 system prompt / trace。
**期望（开）**：
1. 首轮提示词里**含【DRIL 智能资源包】段**，里面预选了对口求解器；
2. 来回轮次（agentRequests）**≤4**；盲扫 discover **≤1 次**；
3. 真的调了 `invoke_solver`；答案里业务数字带 **⟦ref:N⟧** 溯源；
4. trace 里有一步 `dril_package_injected`。

**步骤（关）**：把 `qos.dril-routing` 关掉，问**同一句**。
**期望（关）**：首轮提示词**逐字节不含【DRIL 智能资源包】**；trace 里**没有** `dril_package_injected`；答案仍带 ⟦ref⟧（既有 path-B 不被劫持、零回归）。

**判过**：开=注入+快+溯源，关=不注入+不回归，两者都成立；**判不过**：开了没注入 / 关了还注入 / 关了之后既有问答坏了。

> 复验捷径（不想手点）：`pnpm --filter agentcore test -- dril-routing-seam` 就是这条接缝的自动化断言（已在 gate 绿）。

---

### T5 · DRIL 治理页：后端真值 → 前端可见（前端点击）
**前提**：demo 已开 `qos.dril-routing`（这页 `AdminGuard featureKey="qos.dril-routing"`，没开会 404，这本身也要验）。
**步骤**：用 admin 登录 → 后台 → 「编排与场景」→ **资源（resources）** 页。
**期望**：
- 未开 entitlement 时进该页 → **404 FEATURE_NOT_FOUND**（功能关=不存在）；
- 开了之后 → 列出 T1 后端返回的那些资源，kind/标签/质量分可见。
**判过**：关=404、开=列表与后端一致；**判不过**：关了还能进、或开了列表空/和后端对不上。

---

### T6 · 上下文压缩：长对话不炸（后端/接缝）
**目的**：验证滚动摘要器在长上下文时启动、且不丢关键结论。
**步骤**：对同一个 Path-B agent 会话，连续追问 6~8 轮（每轮引用前一轮结果，制造长上下文）。观察：是否报 token 超限/中断？早期轮次的关键结论后面还认得吗？
**期望**：长到阈值后**自动压缩成摘要继续跑**，不中断（不再出现 `INTERNAL_ERROR`/token 撑爆），且能引用早期结论。
**判过**：多轮长对话稳定走完、结论连贯；**判不过**：某轮起崩 / 丢失早期关键数字 / 答非所问。
> 复验捷径：`pnpm --filter agentcore test -- context-compression-seam`（已绿）。

---

### T7 · 全局推演时间窗口 = 14（前端点击 · KILL-MOCK-RED）
**目的**：页面标注、mock、真后端三者口径统一为 14 天。
**步骤**：
1. **真实态**：进「全局联合推演」页，看时间窗/矩阵列的天数标注。
2. **mock 态**：`VITE_MOCK=1 pnpm --filter frontend-shell dev`，进同一页看标注。
**期望**：两种模式下时间窗标注都是 **14 天**，**页面任何地方不再出现"21 天"**。矩阵列宽度对应的窗口天数与标注一致。
**判过**：全是 14、无 21；**判不过**：任一处还写 21、或标 14 但矩阵实际按别的天数分桶。
> 复验捷径：`pnpm --filter frontend-shell test -- portfolio-globalsim`（含 `not.toMatch(/21\s*天/)` 断言，已绿）。

---

### T8 · DRIL 金标脚本（回归护栏 · 一条命令）
**目的**：三个金标脚本是 DRIL 的注册/检索/质量护栏，改动后必须仍绿。
**步骤**：
```bash
pnpm dril-registry:check && pnpm dril-retrieval:check && pnpm dril-quality:check
```
**期望**：三条全部退出码 0、打印 PASS。
**判过**：三绿；**判不过**：任一红——把红的那条输出贴回来。

---

## 三、验收总纲（给测试 dev 的判定顺序）
1. **头号判据 = T4（DRIL 开关接缝真驱动）** + T7（口径统一）——这两条是本批"能用"的命门，先测。
2. 再测 T1/T2/T3/T5/T6 的端到端行为。
3. T8 金标脚本 + 四包 gate 作回归护栏。
4. **绿测试≠能用**：请务必真点真跑 T4/T5/T7，别只看单测绿就签字。
5. 任何一条不过 → 回报**精确到接口/页面 + 实际输出 vs 期望**，我据此定位。

## 四、范围边界（本批**没**动、别误判为回归）
- 多目标 what-if 面板仍是写死的 SO-A/B/C 示意订单（那是另一张单 G-UI-4，不在本批）。
- 全局推演按业务类型（乘/商/储）筛选（W5）、每订单基地+产线列（W6/W7）——**未在本批**。
- 灰节点（物流时长/设备OEE）自动补齐（DATABUILDER-HARNESS 的 EMPTY_DATA 时序自补）——数据构建 harness 已并，但**灰节点端到端补齐的真跑收敛属下一轮**。
