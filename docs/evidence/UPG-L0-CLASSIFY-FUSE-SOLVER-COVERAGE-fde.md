# UPG-L0-CLASSIFY-FUSE (C2) + UPG-L0-SOLVER-COVERAGE (C3) · 真跑证据（返工）

前置根因（COVERAGE-FILL 共享修复）：原痛点问句「常州物料齐套为什么这天越线」分类到 `risk_root_cause`，此前
AGENT_FIRST 无 LLM 恒 Path B FAILED。本单改 WORKFLOW_FIRST + 重定向 path-A `causal_attribution` 求解器，
使该原问句可被融合救回（CLASSIFY-FUSE）、且 Path B 兜底可按问题类目打点（SOLVER-COVERAGE）。

## 环境（真起双服务·内存模式·own worktree build·no secrets·kill by PID）
- datacore :4501（SEED_DEMO·CREDENTIAL_KEY·SERVICE_TOKEN=svc）
- agentcore :4502（DATACORE_BASE_URL=:4501）
- packageId=pkg_battery_manufacturing · x-debug-user=demo:user-planner:planner

## C3 · qos_pathb_by_problemclass 真出数（live·single choke runPathB）
原问句 vs Path-B 问句同跑，/metrics 实测：
```
qos_tasks_total{path="WORKFLOW",status="COMPLETED"} 1   ← C1 原问句「常州物料齐套为什么这天越线」→ path=WORKFLOW
qos_tasks_total{path="AGENT",status="FAILED"} 1         ← 无意图问句 → Path B 兜底
qos_pathb_by_problemclass{class="unknown_intent"} 1     ← Path B 按问题类目打点真出数（未匹配意图→unknown_intent）
qos_classify_fuse_rescued_total 0                        ← 无真 LLM·live 不触发②救回（见 C2 test）
```
taskIds（本次·可复现）：C1=task_01KX4ZZNVJQ5N417HBX6QT3M39（COMPLETED/WORKFLOW/risk_root_cause）；
PathB=task_01KX4ZZNZWZGBWTNR7C7MGE6N8（FAILED/AGENT）。
注：qos_pathb_by_problemclass 只在 **runPathB 单一收口** 打点（WORKFLOW 意图落 Path B 兜底=覆盖缺口可观测）；
AGENT_FIRST 意图经其绑定 agent 直达（有意为之·非缺口），不计入本计数——这正是「哪些问题往未验证 Path B 落」的语义。

## C2 · 融合②det-rescue（原问句·弱 LLM·非同义句·非合成入参）—— 可复现单测承重
真起服务无真 LLM 无法造 present-but-weak（live classify 返 null → 融合①纯确定性·非②救回）。故 present-but-weak
救回由**可复现单测**承重（stub 建模不完美弱 LLM·诚实标注·非真 LLM；QUERY 仍是原痛点问句·det 跑真本体 examples）：
`apps/agentcore/test/coverage-fill-classify-fuse-rework.test.ts`
- **ON**（QOS_CLASSIFY_FUSE=1）：弱 LLM 判域外（会落 Path B）+ det 对原问句「常州物料齐套为什么这天越线」强命中
  risk_root_cause（S03 examples·真本体）→ 融合②补入（confidence=τ_low·脱离 Path B）→
  `qos_classify_fuse_rescued_total` 0→1，`task.path != AGENT`，`classification.candidates[0].intentKey=risk_root_cause`，
  `outOfCatalog=false`。
- **OFF**（关闸）：同弱 LLM 判域外 → `task.path=AGENT`（Path B·改造前系统），救回指标不动（0）。
- C3 单测：Path B 弱 LLM 域外 → `qos_pathb_by_problemclass{class="unknown_intent"}` 0→1；/metrics 文本导出该计数器；
  `problemClassForIntent("risk_root_cause")="general_causal_attribution"`。

## 门/单测（全绿）
- agentcore: coverage-fill-classify-fuse-rework(6) + router-classify-fuse(8·keep) + mode-dispatch-honor + intents-materialize +
  scenarios + derive-render-bindings + scenario-render-projection + evals-scenario-suite(27/27) 全绿。
- datacore: solver-coverage.test.ts（含 INTENT_PROBLEM_CLASS·problemClassForIntent·isProblemClassCovered 9 tests）全绿。

## 诚实声明
- stub 分类器**显式建模弱 LLM**（非真 LLM·非同义句改写）；QUERY 全程是原痛点问句；det 在真出厂本体 examples 上跑。
- 无手喂合成入参：causal_attribution 入参映射自 S03 卡 slotPresets（Metric.actual/floorVal + MaterialBalance.gapTon）。
