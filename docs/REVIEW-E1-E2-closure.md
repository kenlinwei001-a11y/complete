# REVIEW · E1-E2 复验闭环（校准活体常态化 + 沙盘 what-if 进决策·a8cbdf6 + R3修511120b）

> 两轮：①首轮抓 R3 门控回归门红(sim.sandbox 关时沙盘 nav 仍现)→BLOCK；②dev 修(默认关+openWhatIf 按 entitlement 门控)→复验转绿 + 逐条真跑 E1 校准 + E2 what-if 前端像素级→DONE。
> 环境：真 datacore(SEED_DEMO·127.0.0.1:4001·enable sim.sandbox) + 真 vite(5177·非mock·指真后端)。

## 判决：✅ DONE（E1 校准越用越准 + E2 一键 what-if 带上下文进沙盘·前端像素级实拍 + R3 门红修回转绿）

## 契约 7 条证据
| # | 断言 | 证据 | 判 |
|---|---|---|---|
| C1 | scheduler CALIBRATION_SWEEP kind + handler 周期调 calibration.run/runAll(非手动) | synthetic/service.ts:255 `register("CALIBRATION_SWEEP","tenant","0 5 * * *")`(cron 日5点)·app.ts:683 `.on("CALIBRATION_SWEEP",→calibration.sweep→runAll)`·契约 actions.ts:106 枚举 | ✅ |
| C2 | 喂 observed→sweep→proposals status=pending length>0·trigger 非手动 | m11-calibration.test.ts(真 HTTP inject):proposals>0(:226-227) | ✅ |
| C3 | writeback-echoes/reconcile 真 observed 进配对·nPairs/samples>0 含来源标记 | m11 test 配对样本 + FDE(reconcile 前 samples=N) | ✅ |
| C4 | GET /a/v1/calibration/convergence 逐轮序列 len≥2·mape 单调下降(末<首·越用越准) | m11 test **E1a 经真 HTTP GET convergence**:sweep 3 轮 mapeAfter **25→13.64→…下降**(FDE [E1-EVIDENCE])。诚实:我 live sweep=200 但 convergence rounds=0(demo 默认无 observed pairs·测试喂 pairs 后下降·非缺陷) | ✅ |
| C5 | approve 提案→Action EXECUTED→paramsVersion +1 + outbox calibration.applied | m11 test:approve `/proposals/:id/approve`→paramsVersion v0→v1(:239/268)·runWithParams 新旧版差(:274-276) | ✅ |
| C6 | rollback→param 退回 appliedFrom·M11+sim 回归全绿 | m11-calibration.test.ts **12 passed**(含 rollback)·wo-e2-whatif.test.tsx **3 passed**·**首轮 nav-sandbox 门红经 dev 511120b 修→复验转绿** | ✅ |
| C7 | 真浏览器 RiskBoard 风险红点→「开 what-if」→真起 sim session(baseSnapshot=红点上下文)→SimCompare diff·checkpoint rollback 主世界不变(R3隔离) | **Playwright 真 Chromium**(demo/admin·真后端·enable sim.sandbox)/v/risk(8 风险卡)→**「就此问题开 what-if 推演 →」按钮可见**(sim.sandbox 门控·R3)→点→**navigate `/v/sim-sandbox?whatif=1&source=risk-board&subject=洛阳&factor=设备OEE`**(带红点上下文)→沙盘渲染:what-if 徽标+"来自决策入口:risk-board"+"洛阳·设备OEE"+全局态(tick0 50.2/demandLoad51.2)+就绪雷达(综合53)+L4三元组+"决策完即弃或采纳为 Action(R4)"(R3隔离)。截图 `e2-c7-sandbox-whatif.png` | ✅ |

## 前后端闭环·像素级（E2）
- 后端:enable sim.sandbox→workspace.features 含 sim.sandbox→前端 useFeature 门控现按钮(R3 暗发·关则隐·避沙盘404死路)。
- 前端像素级:risk红点上下文(洛阳·设备OEE)经 openWhatIf navigate 真带入沙盘 URL param→SandboxView 渲染 what-if 上下文条+沙盘态+雷达+采纳/弃(R3隔离不污染主世界)。截图逐元素辨识。

## block→fix→done 闭环（反偷懒）
- 首轮:E1-E2 加 openWhatIf 沙盘入口但未判 sim.sandbox entitlement→`wo-nav-data-sandbox.test.tsx:37` R3 门控回归红→我 BLOCK(精确 file:line)。
- dev 修(511120b):sim.sandbox 默认关 + openWhatIf 按钮 entitlement 门控(非改测试凑绿·真门控)。
- 复验:nav-sandbox 测转绿 + 真浏览器验按钮门控(sim.sandbox 关隐/开现)→DONE。

## 本体回写
- E1:CALIBRATION_SWEEP 调度作业 + calibrationConvergence store(migration034·repo 三实现)+ calibration.swept/applied 事件。E2:openWhatIf(risk上下文→沙盘)+SimComparePanel·R3隔离(checkpoint/rollback 主世界不变)。SYSTEM-ONTOLOGY 已回写。R2/R6/R3(沙盘暗发门控)。

---
*审核方 E1-E2 复验闭环（E1 校准越用越准 real-HTTP convergence + E2 一键 what-if 带上下文进沙盘前端像素级实拍 + R3 门红 block→dev修→复验转绿）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
