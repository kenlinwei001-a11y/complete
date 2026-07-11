# S1 §5.4 五触发归一 + §5.3 多轮→分支 · 真浏览器证据（2026-07-11 · dev3）

真起双服务（datacore:4001 SEED_DEMO=1 + agentcore:4002）+ 真 chromium + 真 vite（.env.local 指真后端·同站 localhost
使 httpOnly refresh cookie 跨导航存活）+ 真 admin 登录（真 JWT）。Playwright 驱动真沙盘渲染器，逐值断言。**非 jsdom·非机制冒充**。

## §5.4 五触发归一（canonical source·R13 可溯）· 真浏览器
告警(alert)触发·scope-only（无 shock）preset → 沙盘渲染器真渲染：
```
✓ §5.4 上下文条显示归一 canonical source=alert（原始 alert）· 实得=alert
✓ §5.4 scope-only 告警(无shock)→不 auto-tick·保裁剪静止（RL9）· cur-tick=0
```
- 上下文条 `data-testid="sandbox-whatif-source"` 的 `data-sim-source` 属性 = 归一后的 canonical 五源之一（此例 alert）。
- 五触发（对话/what-if按钮/场景卡/告警/工作台）经 `mapSimSource` 归一到 `dialogue|scenario|whatif|alert|workspace`——同一
  SimulationRequest 管线、同一渲染、source 全程可溯（R13）。
- **RL9 守恒**：scope-only 触发（无 shock）→ 开箱裁剪静止、cur-tick=0、不 auto-推演（旧 what-if 行为零变化）；
  只有 shock 携带者（对话/告警冲击）才 auto-推演（见 `S1-realbrowser-shock-run.md`）。

## §5.3 多轮追问→分支布线（能分、能对比·A/B 此刻相同=S1 边界）· 真浏览器
followUp preset（带 shock）→ 会话就绪 + auto-推进后 → auto-触发 simBranch → compare 面板真出现：
```
✓ §5.3 followUp → auto-触发 simBranch → compare 面板真出现（能分、能对比·A/B 此刻相同=S1 边界）
✓ §5.3 SimComparePanel 渲染（A/B 双序列对比）
```
- 后端 `isSandboxFollowUp`（同会话前序有 sandbox_render）→ 块标 `followUp:true`（`sim-render-hook.test.ts` 真跑
  orchestrator 双轮验证：首轮无 followUp、"那外协呢?"追问轮 followUp=true）。
- 前端 followUp preset → SandboxView auto-触发既有 `onBranch`（checkpoint→simBranch→fetchSimCompare）→ `sandbox-compare-card`
  + `sim-compare-panel` 真渲染 A/B 双序列。
- **S1 边界（钉死·不越界 S3）**：A/B 此刻相同（能分、能对比即达标）；往 B 注入不同应对（外协/加班改传导系数）+
  对比维换决策维（交付缺口/成本/齐套）= S3 的活（deps S1·本单不做）。

截图 `S1-sandbox-5354-realbrowser.png`（compare 面板 + 上下文条 canonical source 可见）。

## 配套单测/集成测
- 前端 560 测零回归 + 新增：`mapSimSource` 五源归一、followUp 块渲染「分支对比推演」按钮 + preset 携 followUp。
- agentcore 723 测零回归 + `sim-render-hook.test.ts` §5.3 多轮 followUp 标记（真跑 orchestrator 双轮）。
- §5.4 source 归一 + §5.3 followUp 分支 = 后端集成测 + 前端单测 + **真浏览器** 三段验证（铁律 0.4）。
