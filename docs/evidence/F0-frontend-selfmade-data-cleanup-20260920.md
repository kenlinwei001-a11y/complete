# F0 证据 · 前端自造数据生产路径清零（2026-09-20 复测）

> 复测人：第三任 builder（worktree `agent-aac69bcd2ba58eeaa`，分支 `wo-m0-ground-truth-b`）。
> 复测基线：tip `4a5c1ad4a`（= 远端 `claude/handoff-m0-ground-truth` tip）。
> 实施提交（第一任完成）：`47c671872`（摘除 edgeActiveModel 的 hash01/deriveBaseSnapshot/stampAllDerived，路B裁决）
> → `80902dfe1`（EdgeActivePanel 改服务端派生）→ `4a5c1ad4a`（SandboxView.init 改服务端派生）。

## ① 主判据：生产路径零命中

```
$ grep -rn "deriveBaseSnapshot" apps/frontend-shell/src
RC=1（零命中）
```

`apps/frontend-shell/src` 全树对 `deriveBaseSnapshot` **零命中**——生产路径与注释叙事均无残留。

## ② 金丝雀：替代路径真的在（同法必中）

```
$ grep -rn "deriveSeedBaseSnapshot" apps/ packages/
RC=0，命中 80+ 处，关键三处：
  apps/datacore/src/sim/seed-world.ts:304   export async function deriveSeedBaseSnapshot(  ← 服务端派生实现
  apps/datacore/src/app.ts:99               import { deriveSeedBaseSnapshot, ... }
  apps/datacore/src/app.ts:2068             input.baseSnapshot === undefined ? await deriveSeedBaseSnapshot(repos, c.tenantId) : null  ← 生产调用点
```

金丝雀命中 ⇒ 查法有效 **且** 服务端派生路径在位（`app.ts:2068`：不传 `baseSnapshot` 时服务端现派生）。

## ③ 被摘 hash 函数的连带清查（不许留死代码）

```
$ grep -rn "hash01\|stampAllDerived" apps/frontend-shell/src
RC=0，命中分两类：
  (a) 注释叙事（历史叙述"X（删之前）……"），非代码引用；
  (b) apps/frontend-shell/src/views/sim/physicalTopology.ts:186 `function hash01(s: string)` ——
      该文件**自有**的 FNV-1a 结构哈希（物理拓扑用），同文件 :205 仍在消费，是活代码，
      与被摘除的 edgeActiveModel.hash01 无 import 关系（注释原文："与本仓既有 hash01 同族"）。
```

`stampAllDerived` 在 `apps/frontend-shell/src` **零代码引用**（命中全在注释叙事）。
`edgeActiveModel.ts` 现存导出（grep `^export` 实测）：`EdgeRowVM / DomainSliceVM / buildDomainSlices /
resolveActiveSlice / buildEdgeRows / toggleEdge / DiffRowVM / buildDiffRows / EdgeVerdictKind /
buildVerdict / pickProbeSession / PROBE_WORLD_PROVENANCE*` —— 无任何 hash/派生函数残留。

⇒ **无死代码遗留**：被摘三函数（hash01/deriveBaseSnapshot/stampAllDerived）零调用方、零定义残留。

## ④ 路A/路B裁决记录（第一任执行，本任复核成立）

派单书要求裁决「`origin/claude/handoff-real-cells` 的 `resolveTick0World`（路A：先问后端播种快照、要不到才本地派生）
vs 服务端现派生（路B）」。实测读数：同一时刻真值 `equipmentFailure=75`，路A 复制冻结快照读到 17，路B 读到 75。
⇒ 路A 验收第一行必败，**已按路B执行**：前端 `createSimSession` / `init` 均**不传** `baseSnapshot`，
世界态整份来自服务端回包（`SandboxView.tsx:992` / `EdgeActivePanel.tsx:198` 注释在案）。
