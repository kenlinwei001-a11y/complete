# 推演域四页合并评估 · 可裁决方案

> **本文只做评估，一行产品源码未改。** 动不动由仓主定。

## 报告头（回显）

| 项 | 值 |
|---|---|
| **base commit** | `3f5dbe1a`（= `origin/claude/inspiring-gates-aqczjg` tip，开工时 fetch 所得） |
| **取证时刻（UTC）** | 2026-09-11T03:10Z 起，全程同一棵树 |
| **开工分支** | `claude/handoff-wo-sim-pages-consolidation` |
| 树龄探针 | `wc -l apps/datacore/src/synthetic/battery.ts` = 见 §0 |

### 四个视图文件各自行数（实测 `wc -l`）

| 键 | 导航名 | 视图文件 | 行数 |
|---|---|---|---|
| `decision-play` | （**导航里没有**，见 §5 风险①） | `views/DecisionPlayView.tsx`（壳） | **46** |
| | | └ `views/DecisionPlayPanel.tsx`（**真实现**） | **1991** |
| `decision-console` | 事件影响与对策 | `views/sim/DecisionConsoleView.tsx` | **2355** |
| `sim-unified` | 统一推演控制台 | `views/sim/unified/UnifiedSimShell.tsx`（专家屏 + 壳） | **1101** |
| | | └ `views/sim/unified/console0828/Console0828.tsx`（默认屏） | **1670** |
| `sim-sandbox` | 推演沙盘 | `views/sim/SandboxView.tsx` | **2630** |
| | | └ `views/sim/SandboxConsole.tsx`（布局 + 两个链路求解器） | **2408** |

⚠ **派单表里的两个数要订正**：
- `DecisionPlayView.tsx` 派单写「—」，实测 **46 行** —— 它是个**壳**，5 区推演的唯一实现在
  `DecisionPlayPanel.tsx`（1991 行）。这不是细节：**同一份实现被 4 处复用**（见 §2 判定「真独有/嵌入」一档）。
- `sim-sandbox` 派单写「入口见 `shared.tsx`」，实测入口是 `App.tsx:144` 的
  `SimSandboxGuard`（entitlement `sim.sandbox` 关 → 404），渲染 `SandboxView`。

---

（其余各节随后追加）
