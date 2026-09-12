# LOOP-PROTOCOL.md v2 — 自治交付回路协议（CEO 真数据 lane · Dev-4 handoff）

> 目的：把「开发 → 真跑验收 → 同步 → 推送 → handoff → 复验」固化成可重复回路，
> 让 Dev-4 在**无需逐步问询**下自治推进，同时保证每一轮交到复验方手上的都是
> **真能用**（非绿测试冒充）、**可回滚**、**基线对齐**的增量。
>
> **v2 变更（复验方 2026-07-17）**：
> 1. **每 WO 独立 handoff 分支** `claude/handoff-<wo>`——不共用单一 handoff、不用指派分支、不开 PR。
>    交付 = `git push origin HEAD:claude/handoff-<wo>`，复验方逐分支逐值复验。
> 2. **颗粒铁律**（供给类 WO）：**只生成颗粒**；聚合值一律由**求解器 Σ/ratio 算出**；判据 = **改颗粒→聚合必变**
>    （入库零预聚合·可逐值下钻）。
> 3. **跟 dev2（本体扩展）对齐**：物化/派生只打**已发布 ACTIVE 类型**（通用·零硬编码类型名）→ dev2 新增类型自动支持，代码不动。
> 4. **基线红诚实**：团队分支常带他人 WIP 的 pre-existing 红；开工先 `git stash` 跑基线定责，**自己 lane 绿即交**，
>    不替他人 lane 修测试（尤其他人 file-domain），红情如实**交底**。

## 0 · 前置铁律（每轮开工前自检，违反即返工）

- **铁律 0 · 先读本体**：产出跨模块改动前，先读 `docs/SYSTEM-ONTOLOGY.md`（或 `/ontology`）；
  沿链路走（§3），断点常在接缝；牢记 **绿测试 ≠ 能用**。改了链路/事件/对象类型/不变量/门禁 → **回写本体**。
- **颗粒不聚合**（本 lane 命门）：CEO 真数据（财务/MES/矿价）**按原始颗粒**落 `RawDataset` / 时序点，
  聚合只发生在求解器/看板派生层的**确定性**计算里，**绝不在入库时预聚合**丢失颗粒（否则无法下钻审计）。
- **真源不冒充**（KILL-MOCK-RED）：真源 = `origin.type==="MATERIALIZED"` 且**非**合成 provenance
  （`solvers.buildSynthProvenancePredicate`）；合成/hash 值一律不得自报 LIVE/实测。
- **tenant_id everywhere** · **no-secrets-echo**（凭据 AES-GCM，仅 credentialRef）· **确定性种子**（R6）·
  **错误信封统一** · **Entitlement 先于 authz**（关=404 FEATURE_NOT_FOUND）。
- **暗发**：新能力 feature key `defaultOn:false`；迁移带 `down`；additive、不同段落、rebase-before-push。

## 1 · 回路阶段（每个 WO 走一遍）

```
① 领 WO      从 docs/work-queue.json 认领（owner=dev4-ceo-data），写清 file-domain + 铁律约束
② 读本体     定位对象类型(§2)→追链路(§3)→查不变量(§5)→走门禁(§7)→看数据流(§4)
③ 设计       《本体引用与影响》一节：触及的对象类型/链路/事件/不变量(R*)/断点(G-*)
④ 开发       只在申明的 file-domain 内改；additive 暗发；contracts-only-shared
⑤ 真跑验收   见 §2（绝不用绿测试冒充能用）
⑥ 门禁       pnpm -r build && pnpm -r test 全绿 + gates 全绿（debattery/no-fake-data/no-silent-mock/…）
⑦ 回写本体   若改了链路/事件/类型/不变量/门禁 → 更新 SYSTEM-ONTOLOGY.md + pnpm ontology:slices
⑧ 同步       git fetch + rebase 到 origin/claude/vigilant-knuth-b1nmxn（rebase-before-push）
⑨ 推送       git push -u origin claude/vigilant-knuth-b1nmxn（网络错退避 2/4/8/16s，≤4 次）
⑩ handoff    更新 work-queue 状态→BUILT + built 交底（真证据·非仅翻标志）；等复验方逐值复验
```

## 2 · 真跑验收（fde-delivery · ⑤ 的展开）

宣布「完成」前，**每一条都必须亲手过**：

1. **起真服务**（内存模式即可）：`datacore :4001` + 真 `X-Debug-User` / JWT。
2. **灌真数据**：走真实连接器 / 真 CSV `RawDataset`，**不造假、不 stub、不 mock 掩盖**。
3. **端到端看真值**：入库颗粒 → 派生 → 看板/求解器输出，**逐值 vs 后端源比对**。
4. **两维诚信**：provenance（真源/合成）与 measurement（LIVE/STALE）各自诚实标注，互不污染。
5. **确定性双跑**：同输入同种子 → 字节一致（R6）。
6. **回滚演练**：feature key OFF → 字节回到基线（暗发不破存量）。

> 判据：**看板上 CEO 能看到的每个真数字，都能下钻到一条真 RawDataset 记录**；
> 看不到源的格子诚实标「来源待披露」，**绝不假标 LIVE**。

## 3 · handoff 契约（交给复验方 = 我复验）

每轮 push 后在 work-queue 的 `built` 字段交底，必须含：
- **真证据**：不是「测试绿」，而是「真跑输出随真数据实变」的可复现命令 + 期望值。
- **file-domain**：本轮碰了哪些文件；确认未越界（尤其共享文件 additive 不同段）。
- **门禁结果**：build/test/gates 逐项绿；本体是否回写。
- **回滚**：feature key / 迁移 down 的关法。
- **残口诚实交底**：没做完 / 走了捷径 / 已知限制，一律写明，不假装闭合。

## 4 · 停止条件

- 遇**架构级/歧义**决策（会与他人 canonical 设计冲突、跨 lane、动他人 file-domain）→ 停，交复验方定夺，不擅自 re-push。
- 本 lane WO 全 BUILT 且复验通过 → 回路收口，报告状态，不空转、不越界找活。

---
_本协议服务于 Dev-4 CEO 真数据 lane（每 WO → `claude/handoff-<wo>` 独立分支·复验方逐值复验）。改协议需复验方确认。_
