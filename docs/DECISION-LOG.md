# DECISION-LOG · 审核方代拍板（用户授权"需决策的记录下来·按你认为对的走"）

> 用户令：清单上需我决策的，记录下来，先按我认为正确的执行。本文记我替你拍的决策 + 依据 + 执行。**你可随时推翻任一条**。

## D1 · #22 N1 多源融合是否提 P1
**决策：YES，"接缝层"提 P1。但第一张具体 WO ≠ N1 融合本身，而是 B3 映射层（更近"真实数据出真答案"）。**
- **依据**：option A 真跑钉死 **B3**——canonical 求解器硬编码认 `Order`/`Base`（`service.ts:1721`），上传产 `Orders`/`Bases` 喂不进（"需先合成 Order"）。这是"真实数据能用"的**命门**，且与 N1（多源/多名→同一 canonical 对象）**同源**。
- **执行**：① 先写 **WO-SOLVER-ONTOLOGY-BINDING**（求解器 schema 由本体绑定驱动·仿 `opt-binding.ts` role→本体类型/字段·行业无关 R14）——直接解 B3。② **WO-MULTISRC-FUSION-DOMAIN**（N1·含测谎）随后，建在绑定层之上。

## D2 · #23 是否现在派 3 张设计单给 dev
**决策：dispatch-ready，合成单一派发清单给你转 dev。**
- **依据**：SOURCE-TRANSPARENCY / ACTUATE / OBSERVABILITY + 新 B3/N1 WO 都自包含可派。我是审核方不开发（你定的边界），"派发"=你转 dev。
- **执行**：写 **DISPATCH-MANIFEST**（单一清单·每单一句提示词 + 链接），你一次转 dev；dev 建完我复验闭环（写完≠做完）。

## D3 · #24 选项 C：demo 默认换真实上传包
**决策：DEFER（暂不做 C），依赖 B3 先修。**
- **依据**：B3 证明"上传数据喂不进求解器"。现在把 demo 默认换成真实上传 = 让每个 demo 用户撞 B3（求解器全拒）→ **比合成捷径更差**。合成 demo 是确定性 R6 地板，且 SOURCE-TRANSPARENCY 已让它透明可下载 Excel。**正确序：先 B3（求解器吃任意类型）→ 再考虑 C。**
- **执行**：C 挂起，标依赖 B3；B3 修好后重评。

---
## 决策派生的执行项（已入任务）
- WO-SOLVER-ONTOLOGY-BINDING（B3 命门·高优·D1①）
- WO-MULTISRC-FUSION-DOMAIN（N1 含测谎·D1②）
- DISPATCH-MANIFEST（单一派发清单·D2）
- 选项 C 挂起依赖 B3（D3·无新单）

---
*审核方代决策留痕（用户授权·可推翻·依据钉 option A 真跑 B3）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
