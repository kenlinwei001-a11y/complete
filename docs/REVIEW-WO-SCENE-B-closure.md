# 审核核发 · WO-SCENE-B（规划体检完整场景 agent）闭合（真起双服务 + 对抗式撤回）

> 提交物 `c3382e4`「规划体检完整场景 agent（agt_plan_audit 试点模板）」。WO-SCENE-A 解"拒答"，本单解"答得接地"——把 WORKFLOW_FIRST 命不中预设的回落从**通用 path-B agent** 改为**配置完整的场景级 agent**（agt_plan_audit）。审核方真起 datacore+agentcore 走 QOS 一条开放问句 + 对抗撤回独立复验。

## 一句话结论

**✅ 路由接缝闭合（结构 FDE 真跑坐实 + 对抗咬）。** 真起双服务、向 plan-audit 提开放问句 → `routing.completed note="场景入口模式 WORKFLOW_FIRST"`（=runSceneAgent 路径·该串仅 runSceneAgent 发），非通用 `进入探索模式`；对抗抽掉接缝 → 退回 `进入探索模式` → 还原复绿。**接地富答案**（真调 plan_audit+C15/C18 裁决）受 `LLM_PURPOSE_UNBOUND` 阻、需真 Kimi——env-gated，dev 已诚实标注，审核方**未**核发该体验层（诚实边界）。

## FDE 真跑核对

源单判据：开放问句（不命中预设意图）在 plan-audit 入口 → 回落到配置完整的场景 agent（agt_plan_audit），非通用泛答 agent。

| 判据 | 状态 | 审核方独立证据（真起 datacore:4001 + agentcore:4002·X-Debug-User demo:admin） |
|---|---|---|
| WORKFLOW_FIRST 命不中 → 委派场景 agent | ✅ | `POST /api/v1/queries`（view=plan-audit·开放问句"有哪些我没注意到的隐患…"）→ SSE `routing.completed {path:"AGENT", note:"场景入口模式 WORKFLOW_FIRST"}`。该 note 串**仅** `orchestrator.ts:837 runSceneAgent` 发 → 证 runSceneAgent(scene=scn_plan_audit) 真执行 |
| 接缝是路由主因（非他路） | ✅（对抗） | **撤回**：neuter `orchestrator.ts:692-698` 场景 agent 委派块 → 重建 agentcore → 同问句 `note:"进入探索模式"`（通用 path-B）；**还原**重建 → 复 `场景入口模式 WORKFLOW_FIRST` |
| 接地结构化富答复（真调求解器+规则裁决） | ◐ env-gated | 任务终态 `FAILED · LLM_PURPOSE_UNBOUND`（无 provider 凭据）——场景 agent 路由已达、但执行需真 LLM。dev 已标"富答案需真 Kimi·审核方 FDE"，本环境无 Kimi → **未实拍富答案**，诚实标未冒充 |

## 审核方自纠（诚实留痕·绿测试≠能用 的反面教材）

**首轮真跑我误报"与 dev 声称不符"（note=进入探索模式）——根因是我自己的陈旧 dist**：我把审核 doc rebase 到 c3382e4（带 WO-SCENE-B 源），但 dist 是 rebase **前**（13ad9fe 期）构建的，agentcore/dist 不含 agt_plan_audit 与接缝。`pnpm -r build` 重建后即复现 dev 声称。**这正是 GATE-B 那条"陈旧 dist"教训在我自己身上复发**——已即时识别纠正，不让自造的假阴性误伤 dev。`/api/v1/agents` 返 404（我那个探针路由本就不存在·"0 agents"是假信号），亦一并纠正。

## 读源坐实（接缝机制）

- `orchestrator.ts:692-698`（runPathB·WORKFLOW_FIRST miss 回落）：先 `sceneEntries.byView(tenant, view)` → 若 `scene.defaultAgentId` 且 `agents.get(id).status==="PUBLISHED"` → `runSceneAgent(task,auth,scene)` 并 return；否则照旧通用 path-B `进入探索模式`。单点覆盖 4 个 miss 站点。
- `seed.ts`：`agt_plan_audit`（PUBLISHED·systemPrompt 基于规划/财务/物料·优先调 plan_audit/plan_generate/mrp_netting·ruleBindings C15/C16/C18/C21/C23·scope plan 域）；`scn_plan_audit.defaultAgentId=agt_plan_audit`·保 WORKFLOW_FIRST。
- 真起 agentcore `main.ts:30` 幂等 insert seedRegistry agents → 重建 dist 后 agt_plan_audit 真入库（dist grep ×3）。

## 距北极星（诚实边界·未核发项）

1. **接地富答案是 WO-SCENE-B 的真目标**，本环境因无 Kimi 凭据**未能实拍**（仅证路由委派达成）。要核发"答得接地"，需真 Kimi 环境跑一遍、看 agt_plan_audit 真调 plan_audit 出 H/M/S 项 + C15/C18 裁决 + 管理事项（dev 亦把此列为审核方 FDE 项）。**此前"拒答→接地"的体验闭环，结构已通、体验待真 LLM 实拍**。
2. **试点单一入口**：仅 plan-audit 配了场景 agent；WO-SCENE-C/D 以此为模板铺 20+ 入口 + scene-agent-config 上架门（未开工）。

## 本体引用与影响

- **断点 G-3**（无场景启动器/presetContext 未注入 QOS·场景卡未走接地闭环）：WORKFLOW_FIRST miss 回落接地 agent 的**路由接缝**修复，G-3 再收一格（本体 §8 G-3 dev 已回写）。
- **链路** `sys.orch.query_to_answer`：WORKFLOW_FIRST 分支 miss 回落语义由"通用泛答"改"场景接地 agent"。
- **不变量**：R3（entitlement/scene 门控）不破——仅 PUBLISHED 场景 agent 才委派。

---
*审核方独立核发（design+review·真起双服务+对抗撤回为据·含审核方自纠陈旧 dist 假阴性·非 dev 实装）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入提交物*
