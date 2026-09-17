# 复验 WO-SALES-RING（分支 claude/handoff-sales-ring @ceb6c9ff）

复验分支：`claude/verify-sales-ring`　复验时刻：2026-09-17　base（dev 自报）：`b7e3c44b`

## 判据 0 · 越界普查器「此前恒量 0 格」—— 属实，但定性要订正

实测（base 两文件换回 `b7e3c44b` 后跑 §6）：

```
× §6 ... 🔴 联立接缝：播完种的世界 0 格反算越界 ... 22828ms
  → 末拍一个已声明量纲的格都没数到 ⇒ 取数坏了: expected +0 to be 4937
  ❯ test/seed-demo-propagation.test.ts:847:54
```

⇒ `atEnd.declared = 0`、`atT0.declared = 4937`，**「恒量 0 格」属实**。

⚠ **但 dev 的措辞「『末拍 0 格越界』在空集上恒真」不准**：base 上紧挨着的那句
`expect(atEnd.declared).toBe(atT0.declared)` 是**守门员，它当场红了**（上面原文即证）。
所以这台量具不是「静默假绿」，是「红着的」——它属于 dev 自己报的「base 本身是红的」那一档。
这点不影响修复正确性，但影响定性：**不是假绿第 N 形态，是一条既有红**。

## 判据 1 · 四个数（真 datacore · SEED_DEMO=1 · 内存模式）

端口自证（⛔ 不用 ss/netstat 的沉默当证据）：`lsof -i :4771 -sTCP:LISTEN` → `node 15026`，
即本次 `nohup` 亲手起的那个进程，不是别的 agent 遗留的陈旧服务。

播种回执：`seeded demo sim world (RUNNING @tick96, 6363 格 / 实测 4171 格)`

取数金丝雀（证明我读全了、读的是对的租户）：
- `Order` 条数 = **500**（CLAUDE.md 记的 500 张单）
- `Σ Order.value` = **45,464,327,004**（CLAUDE.md 记的 454.64 亿，**逐位吻合**）
