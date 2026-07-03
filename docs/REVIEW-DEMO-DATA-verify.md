# REVIEW · DEMO-DATA → ✅ DONE（部署态 demo 依赖型空页开箱·合成走正门诚实标）

> 审核方真起 datacore(SEED_DEMO=1 SEED_LIVED_IN=1) + 真浏览器逐条闭合。判决 DONE。根因解=部署配置启用 livedIn 合成（非硬塞样本），诚实边界清晰。

| # | 断言 | 证据 | 判 |
|---|---|---|---|
| C1 | livedIn→GET /a/v1/history/bundle 非404 | 起 SEED_LIVED_IN=1→`history/bundle` **200**·trend 13点·keys{trend,deviation,monthly,delivered,onTimeRate}(此前无 livedIn 快照 404) | ✅ |
| C2 | 运营回顾/OEE趋势 非空态 | `/v/review` review-view 渲染·**MAPE 52周收敛曲线**(12%→7%·W4/W21/W23事件标)+**参数校准史8提案**(APPLIED/REJECTED·n=147..196 MAPE改善)+**S&OP版本史V1-V13**·bodyLen 2993·非空态 | ✅ |
| C3 | meta sync→/a/v1/meta/ontology total>0 | 部署 cwd(apps/datacore·匹配 Dockerfile WORKDIR /repo/apps/datacore)→`meta/sync` **200**→total **187**(SystemInvariant17含新R-QUANT/R-PRD·Breakpoint15·Event93·Domain11·Slice15) | ✅ |
| C4 | 合成数据显SYNTHETIC诚实标不冒充真实 | 运营回顾**顶栏"合成数据"徽标**常驻(诚实标 livedIn 合成非真实运营)·数据经标准合成正门(dataMode=SYNTHETIC) | ✅ |
| C5 | gates绿 | 改动=docker-compose SEED_LIVED_IN + DEPLOY.md(配置·无TS码)·ontology切片已随母体§8同步 | ✅ |

## 治法（根因·非硬塞）
demo 默认不跑 livedIn(seed.ts 门 SEED_LIVED_IN)→依赖 livedIn 快照的页(OEE趋势/运营回顾/history bundle)空。docker-compose 加 `SEED_LIVED_IN:${SEED_LIVED_IN:-1}`→部署态 demo 播种后跑 livedIn 合成(标准合成→回放1年T-365d→T0)·幂等 R6·本地裸跑不设此变量保持快启(opt-in)。**诚实边界(不作假)**：rule-docs/decisions/evals/quarantine 需真实运营动作(跑eval/抽rule-doc/记decision)才产生·demo **不硬塞样本**·保持诚实空态+空态引导。

## 审核方发现（非本单缺陷·follow-up）
**meta/sync cwd 脆性**：`meta/service.ts:33 docsDir=join(process.cwd(),"..","..","docs")` 假设 cwd=apps/datacore；从**仓根**跑(CLAUDE.md 文档命令 `node apps/datacore/dist/server.js`)→docsDir=`/home/docs`→**ENOENT 500**。部署(WORKDIR /repo/apps/datacore)cwd 正确→200。文档化本地命令会触发→已入队 META-SYNC-CWD-FIX(P2·路径应基于 import.meta.url/__dirname 而非 cwd)。

## 本体引用与影响
- 断点：G-VIS-1(依赖型空页后端有真值前端空·本单部署态开箱)。不变量：R6(livedIn 确定性幂等)·R13(合成诚实标 dataMode=SYNTHETIC不冒充)。
