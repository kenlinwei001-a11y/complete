# PRD-A3 · 多跳切片收尾与配套(A3.1 参考基线 + 配套四件)

> 状态:已拍板「A3 全力先攻」(2026-07-16)。A3 四期在正线已建 3.5/4,本 PRD 只覆盖**余量与配套**,不重建已有。
> 施工单:**WO-A3-REFBASE**(agent-1 → `claude/handoff`)+ **WO-A3-SUITE**(agent-2 → `claude/handoff-qos`)。审核方经 LOOP 复验合并。

## §0 本体引用与影响(铁律 0)

- **对象类型**:OntologySlice/SliceSpec(一等切片)· RuleEntry(+params,G-10 一等规则)· ObjectType/OntologyLink(规划器图源)· `graphmeta.ts BUSINESS_DOMAINS`(A3.1 14 域参考注册表·已在)· 元租户参考基线节点(本 PRD 新增,≈95 节点)。
- **链路**:问句→QOS→(A3.4 `lookupReusable` 命中即复用 | 未命中→A3.3 `POST /a/v1/slices/plan`)→切片入 solver 上下文→答案;`ontology.published`/`slice.planned` 事件→A3.4 索引重建。
- **事件**:`ontology.published` · `slice.planned`(已有,索引重建钩子)。
- **不变量**:R2(租户隔离:参考基线只在元租户,业务租户 404)· R6(确定性:同图同目标字节一致,基线 seed 重跑 deep-equal)· R13(索引=派生投影,非新真值源)· R14(配置驱动:14 域注册表换行业零改码)。
- **断点**:G-10(规则即引用——切片约束一等化是其切片维扩展)· G-VIS-1(后端真值→前端可见:切片库/规划可视面)· G-8(SHAPE 门扩到 slice-planner 输出形状)。
- **回写要求**:两单落地后**必须回写 `docs/SYSTEM-ONTOLOGY.md`**:§8 G-10/G-VIS-1 对应行、A3 状态行、新增"参考基线"对象说明。

## §1 背景(正线现状·全有码为证)

| 期 | 状态 | 位置 |
|---|---|---|
| A3.1 14 域参考注册表 | ✅ 注册表在;⬜ **余:参考本体基线(元租户 ≈95 节点)** | `apps/datacore/src/graphmeta.ts BUSINESS_DOMAINS` |
| A3.2 域内/跨域两库 | ✅ | `apps/datacore/src/ontology/slice-library.ts`(纯函数 R6;跨域=每条跨域接缝一张) |
| A3.3 多跳规划器 | ✅ | `apps/datacore/src/ontology/slice-planner.ts`(确定性路径搜索·固定 tie-break) |
| A3.4 索引+复用 | ✅ | `apps/datacore/src/ontology/slice-index.ts`(rootType 索引·lookupReusable) |
| 端点 | ✅ | `POST /a/v1/slices/plan` · `GET /a/v1/slices/library` · `POST /a/v1/slices/library/build`(app.ts:2131-2168) |
| 消费 | ◐ | agentcore tools(datacore-http/clients)+前端 endpoints 已接;深接与可视面=本 PRD |

## §2 WO-A3-REFBASE(agent-1)· 14 域参考本体基线

**目标**:把 A3.1 的余量补齐——在**元租户**种一套**行业无关**的 14 域参考本体基线(≈95 节点:每域的代表类型+关键跨域链路),作为"换行业"的模板真值与两库/规划器的参照世界。

**规格**:
1. 确定性种子函数(seed 参数化,默认 42;同 seed 字节一致 R6),从 `BUSINESS_DOMAINS` 注册表派生,**不新造域**;节点=每域 5-8 个参考类型(行业无关命名,如 sales 域:客户/订单/报价…用平台术语,禁外部产品名),链路=域内骨架+跨域接缝(接缝与 slice-library 的 `biz.x.*` 口径一致)。
2. R2 隔离:只写元租户(参照 `meta:sync` 模式);业务租户查询 404/空。
3. **覆盖验收报告**:脚本或端点输出「电池 66 类型 → 14 域」映射覆盖表(哪些域被实例覆盖、哪些空),诚实列缺,不凑数。
4. 门:`pnpm gates` 新增或扩展一条 refbase 检查(节点数/域覆盖/确定性),tooth 测试(篡改基线→门红)。

**验收(C1-C5,逐条给证据)**:
- C1 同 seed 重跑 deep-equal(R6);C2 业务租户不可见(R2,curl 证);C3 节点计数≈95+逐域计数表;C4 覆盖报告真输出(curl/脚本产物);C5 `pnpm -r build && pnpm -r test` **不比基线更红**(基线红数以审核方当日公布为准)。

## §3 WO-A3-SUITE(agent-2)· 配套四件

1. **切片约束一等化(G-10 切片维)**:`battery.ts:1350` 等 `mustIncludeTypes/mustIncludeLinkKeys` 从写死 seed → 引用一等 RuleEntry(`rule.params` 承载,同 PropagationRule 模式,冷启动可内联 fallback)。**改规则即改切片验收**。
2. **QOS 动态切片深接**:意图需要跨域数据且预置切片不匹配时,agentcore 经 tools 调 `POST /a/v1/slices/plan`(先 `lookupReusable`),把动态切片喂进 solver 上下文;trace 里可见 planned/reused 标记。
3. **切片库/规划可视面(G-VIS-1)**:admin 新页「切片库」:列表(GET /slices/library:key/root/域/类型数)+「规划」tab(输入 root/目标→调 /slices/plan→渲染路径 hops)。**只接真端点,零假数据**;空态诚实。
4. **SHAPE 门扩**:slice-planner 输出形状纳入 `chain:check`/SHAPE 覆盖,形状漂移→门红(tooth 测试证)。

**验收(C1-C6)**:
- C1 编辑规则 params→slice-contracts 验收随之变(dry-run 演示);C2 一条真问句走动态规划(curl+trace 证 planned 或 reused);C3 真浏览器截图:切片库页真数据渲染+一次规划路径;C4 门 tooth:故意破形状→红,恢复→绿;C5 不比基线更红;C6 回写 SYSTEM-ONTOLOGY.md(§0 要求)。

## §4 非目标(勿做)

- 正线 37 项测试红(重基线)= 审核方在修,**勿碰**;
- CAPSIM/DATAMODE 等 July port = 另单(对账已出);
- 不重写 A3.2/3/4 已有实现——**复用不重建**;发现其 bug 报审核方,勿顺手大改。

## §5 交付纪律

- LOOP:`git fetch && git rebase origin/claude/vigilant-knuth-b1nmxn` → 本地自检 → `git push -f origin HEAD:claude/handoff(-qos)`;WIP 每 ~30 分钟推 `*-wip` 分支。
- 红线:KILL-MOCK-RED(前端禁写死冒充真实;合成诚实标)· R6 确定性 · contracts-only-shared · tenant_id everywhere · 错误信封统一。
- "完成"的定义 = 验收 C 条逐条有证据(curl 输出/截图/门 exit code),**绿测试≠能用**。
