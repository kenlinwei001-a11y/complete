# 派单 · 满配脊柱 2-Dev 并行（审核方出·2026-07-11）

## 目标
19 脊柱 WO（L1-A 需求图 / L1-B 计划+工作流DAG运行时 / L2 决策内核 / L1.5 企业记忆CBR）**双 dev 并行开建·文件不相交=零碰撞**。批量：整子系统建完再交审核方**批量复验**（不逐小 WO ping-pong）。
**铁律（钉死）**：不仅追快——**解决根因·完整·不留 stub/mock 冒充完成·真跑·additive 暗发可回退**。

## 分区（按 app 栈切·文件域不相交）
### 🅰 Lane A — Dev-1（agentcore 栈）
- **WO**：`WO-L1A-1` → `WO-L1A-2` → `WO-L1A-3`；`WO-L1B-1` → `WO-L1B-2` → `WO-L1B-3` →（`WO-L1B-4` 需 L1A-3）→ `WO-L1B-5`；`WO-L1B-SAGA`（需 L1B-3）
- **文件域**：`apps/agentcore/src/growth/*`、`apps/agentcore/src/workflow/*`、`orchestrator.ts`(锚 :673 需求图 / :1076 planner影子)、`engine.ts`(:396)、`packages/contracts`(qos.ts + 新文件)
- **PRD**：`docs/PRD-L1A-requirement-graph-engine.md`、`docs/PRD-L1B-execution-planner-workflow-runtime.md`

### 🅱 Lane B — Dev-2（datacore 栈）
- **WO**：`WO-L2-1` → `WO-L2-2` → `WO-L2-3` →（`WO-L2-4` 需 L1A-3）→ `WO-L2-5`；`WO-L1.5-1` → `WO-L1.5-2` →（`WO-L1.5-3` 需 L2-5）→ `WO-L1.5-4` → `WO-L1.5-5`
- **文件域**：`apps/datacore/src/*`(决策内核/记忆域)、`server.ts`(锚 :305 pre_analysis 旁挂)、`decisions.ts`(:21 复用)、`packages/contracts`(decisions.ts + 新文件)
- **PRD**：`docs/PRD-L2-decision-kernel.md`、`docs/PRD-L1.5-enterprise-memory-cbr.md`

## 跨 Lane 依赖（唯一同步点）
- `WO-L2-4`(Lane B) deps `WO-L1A-3`(Lane A) · `WO-L1B-4`(Lane A) deps `WO-L1A-3`(同 lane)。
- **策略**：Dev-2 先建 L2-1/2/3（零跨依赖），期间 Dev-1 落 L1A-3；再建 L2-4/5→L1.5。其余 deps 全在 lane 内。

## 每 Dev 纪律
1. **只认领本 lane 的 WO-ID**：`node scripts/collab-queue.mjs claim <id> dev1`（或 `dev2`）。**⛔ 不要用 `next-dev` 盲取**——它不按 owner 过滤，两 dev 会撞同一条。
2. 按 lane 内 deps 顺序建（地基契约 `L1x-1` 先）。整子系统建完 → 逐个 `collab-queue built <id>` → 交审核方**批量复验**。
3. **根因·完整·真跑**：targeted 测试 + 相关门绿即可交（别等 env-timeout 全套）。`additive`·env 暗发·关闸=字节一致（脊柱 PRD 均暗发观察态·十红线 RL2/RL9）。**绝不 stub/mock 冒充完成**（违假推演铁律）。
4. **只碰本 lane 文件域**。`packages/contracts` 各加**新文件** + append index（rebase-retry 处理 append 冲突）。
5. push `claude/vigilant-knuth-b1nmxn`·`git pull --rebase` 重试。契约 zod / tenant_id / 错误信封 / 确定性 R6 守 `CLAUDE.md`。
6. 建 sub-agent 时：sub-agent **不碰 `docs/work-queue.json`**（队列由 dev 主线 claim/built、审核方 done/block）。

## 复验（审核方=我）
- **子系统边界批量复验**：整 L1-A / L1-B / L2 / L1.5 各一次真跑（暗发开闸真起服务、逐值、回退演练关闸=字节一致）。
- **地基契约 WO 早期 sanity**：`L1A-1/L1B-1/L2-1/L1.5-1` 落即快速核契约形状，确保 19 层深度不建在沙子上。
- `BUILT→DONE/BLOCK` 由审核方独立对抗复验判（**建造 agent≠复验 agent·守"谁复验"红线**）。
