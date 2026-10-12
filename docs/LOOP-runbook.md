# Loop Runbook · §0–§7 有纪律步进（调用 fde-delivery skill）

> 这是自驱动 loop 每次 fire 的执行规格。**不是 autopilot**：它驱动**自主项**走完验收闸，遇到**你的决策项就停下来摆出来、绝不替你猜**。完成的唯一判据是 `fde-delivery` SOP——亲手用一遍能用、附证据、报北极星距离；从不拿测试绿/自检绿冒充"完美"。

## 每次 fire 的步骤

1. **先走 `fde-delivery` skill**（验收纪律前置）+ `ontology` skill（改接线先读本体）。
2. **读 `docs/TODO-fde-build-engine.md`**，按建议顺序找**下一个未完成项**。
3. **分流**：
   - 该项是**决策门**（§2/§3/§4/§6 的开放岔路）→ **不动手**，把决策清单摆给用户，跳过，找下一个自主项。
   - 该项**自主可做**（§0 审计续跑 / §5 对象浏览器 / 确认的 bug）→ 进第 4 步。
4. **按 SOP 做一个最小可验证增量**：
   a. 写"完成定义（用户视角）"。
   b. 建（代码 + 工业级测试，真实/新颖故事而非内置 demo）。
   c. **亲手验**：能起服务就 hand-run（注意沙箱对长驻 server 发 SIGURG/exit144，必要时退到确定性单测 + 已有 live 证据）；核对产物在**真实 UI 模块**里看得见。
   d. 全绿（该包 test + `pnpm gates`）。
   e. commit + push 到 `claude/vigilant-knuth-b1nmxn`。
   f. 回写本体（若改接线）+ 更新 TODO 勾选 + 更新 `docs/AUDIT-hand-run.md`（若审计项）。
5. **本轮汇报**（即使无人看也写进 transcript）：做了什么 + **亲手验证据** + **距离北极星还差什么** + 标清哪些是合成/happy-path。
6. **决策门全部待答、无自主项可推** → 一句话说明"卡在你的 N 个决策上"，停，不空转。

## 红线（防复发）

- 不 push 大型新特性而无授权（loop 是 steward 不是 initiator）。
- 不把"组件各自正确"当"整体目标达成"。
- 不自证"完美/100%"——完成需用户过目。
- 只推指定分支；模型标识不进任何提交物。

## 决策门（已解锁，2026-06）

- ✅ **§3**：两库 = **现有本体图读模型 + 索引**（不复制真值，避免漂移 R9）；只持久化"生成的切片 + 切片索引"。多跳路径规划 = **确定性图搜索做地板**（BFS/最短路，无 LLM 可跑、R6），LLM 作可选"路径排序 + 切片命名/描述 + 听懂新颖意图"层。
- ✅ **§2**：LLM comprehend **接 Kimi**（openai_compatible provider），新增 `comprehend` 用途（"数据构建发动机·故事意图解析"），在 LLM 用途矩阵绑定 Kimi（modelId 由用户填，如 kimi 2.5）；输出经 freezePlan 守 R6；缺绑定/无 key/失败 → 确定性关键词地板兜底。**Kimi API key 由用户在 provider 凭据处填（我无法代填）。**
- ✅ **§4**：分类 = **大类→数据集两层**；"字段被≥1切片覆盖" = **软提示**（高亮待办，不硬阻断）。

## 进度（loop 实跑）

- ✅ §2 第一增量：comprehend 大脑可插拔（Kimi 优先 / 确定性地板兜底）+ assemblePlanBody（LLM 三件→全栈倒推）+ comprehend 用途入用途矩阵。mock 验证：新颖故事→Process/Equipment+shared_bottleneck，自检诚实报缺口。**余**：用户绑 Kimi+填 key 才 live；缺的求解器(shared_bottleneck 等)仍需实现/兜底；终态闭环(DRAFT→publish→启动器)。
