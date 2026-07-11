# S4 · WO-SANDBOX-RADAR-COLLAPSE · 真浏览器证据（2026-07-11 · dev3）

执行 REVIEW「拒绝照搬竞品形式」标志性一刀（#9/#10）：三雷达合一（主雷达维度换人话）+ L0-L4 黑话台阶折成
**一句人话结论**（能不能拿来决策）。纯前端·零后端 cert 计算改·零新色·值全 DERIVE 自 cert（R13·只重组不改数）。
真起双服务 + 真 chromium + 真 vite（`.env.local` localhost）+ 真 admin 登录 → 真沙盘渲染器。**非 jsdom·非机制冒充**（铁律 0.4）。

## 真浏览器逐值断言（9/9 全绿）
```
✅ 后端 workspace entitled sim.radar_collapse（battery all-on·暗发键真下发）
✅ 真后端登录成功 → http://localhost:5174/
✅ 一句人话结论真渲染·级别=L1_CONFIGURED·「尚不可推演——已配置但就绪认证未达标（缺：前向闭合(规则 scope 类型缺失)、图查询覆盖不足）」
✅ 逐值对照后端：DOM 结论级别 L1_CONFIGURED == 后端 cert.level L1_CONFIGURED（R13 派生·不新造）
✅ 人话结论文案与级别 L1_CONFIGURED 判据一致（含「尚不可推演」·能不能拿来决策说人话）
✅ FDE 校正：结论指向真断点(含前向闭合)·world=100% 不臆断「世界未就绪」
✅ L0-L4 台阶黑话收「查看认证详情」折叠（data-open=0 默认折叠）·stepper 仍在 DOM（hidden 保留·功能不删）
✅ 主雷达维度换人话名（数据/结构齐备 / 规则/知识覆盖 / 行为已验证）·无 structure/knowledge/behavior 黑话裸键（R14）
✅ 截图 docs/evidence/S4-sandbox-radar-collapse-realbrowser.png
```

## FDE 校正（用户实测触发·2026-07-11·诚实高于形式）
用户 FDE 追问「为何无法推演」→ 实测 demo 沙盘 GLOBAL cert：`level=L1`·`canEnter=false`·**`worldCompleteness=100%`**（状态变量
11/11·派生 11/11·行动 12/12·传导 3/3 全齐）·`trialTick.passed=true`（3 规则真触发）·`l4Checks{fanoutSafe✓ writebackComplete✓
observabilityMet✗}`·`gaps`=3 条前向闭合(FORWARD rule C24->Quote/C45->Action/C50->Action·规则 scope 类型缺失 HARD)+1 条
图查询覆盖(40/43·observability)。**根因不在推演核**（tick 正常），在**本体前向闭合 + 图查询覆盖**（数据/建模闭合范畴）。
- **校出并修的诚实 bug**：原 L1 结论文案硬套「已配置但**世界未就绪**」，与 `worldCompleteness=100%` **矛盾**（世界是齐的）。
  修：结论 `{gaps}` 摘要改从**真实 `cert.gaps`** 桶派生（`summarizeCertGaps`·前向闭合/图查询覆盖/归域…关键词桶·未命中回退 gapCode），
  L1 文案「世界未就绪」→「就绪认证未达标」——诚实指向真断点，绝不臆断（KILL-MOCK-RED 精神）。回归门 `test/sandbox-radar-collapse.test.tsx`
  「FDE 校正回归：world=100% 但仍有闭合缺件 → 结论指向真断点·绝不臆断世界未就绪」。

截图（就绪认证卡）：顶部 amber「L1 已配置 尚不可推演——已配置但世界未就绪。」一句人话结论（替代原 L0-L4 stepper 黑话），
其下主雷达维度标「数据/结构齐备」等人话名 + 「✗ 暂不可进入推演 综合 52」；L0-L4 台阶/三元组/Trial Tick 收「查看认证详情」折叠。
S2 诚信位徽标（系数未校准/来源待披露）同屏共存——两 feature 正交不打架。

## 验收对照（WO §5）
- **§5.1 一屏一雷达**：主视觉区 1 张就绪雷达（人话维度）；健康6/信任4 双雷达早在折叠卡（`sandbox-dual-radar-card` defaultOpen=false·功能不删）。✓
- **§5.2 认证一句话正确**：L1 会话 → 「尚不可推演——已配置但世界未就绪」+ gaps（缺件由 worldCompleteness present<needed 真派生）；点「查看认证详情」见原 L0-L4 stepper。✓
- **§5.3 值一致**：主雷达每维值 = 原 `radarValues`（cert.dims·未改数）；综合值 = cert.dims.composite（52）逐值一致。单测 `humanize 开/关 canEnter+综合值同源`。✓
- **§5.4 零新色**：`check-css-vars` 绿；结论色走既有语义 token（L2 --warn / L3 --ok / L0 --danger / L4 --accent）。✓
- **§5.5 回退演练**：feature `sim.radar_collapse` 关 → 回 L0-L4 stepper 主视觉原样、无一句话结论、无折叠详情卡（旧 DOM 未删）。单测 `humanize 关→原样`。✓

## 配套单测/门
- 前端 `test/sandbox-radar-collapse.test.tsx`（6 测·全绿）：simCertVerdict 逐级 + simRadarHumanLabel 映射/回退 + humanize 开/关（一句话+详情折叠 vs 原样·DOM 保留）+ 值一致（只重组不改数）。
- 门 `css-vars:check`（零新色）· `sim:check`（sim.* defaultOn:false）· `genuine-sim:check`（S2 §④.b 仍绿）· `feature-parity:check` 全绿。
- 全量前端 174+ 文件测零回归。

## 诚实边界
- 纯前端展示重组：`deriveCertification` 后端零改（母体 §0「不改母体」）；值全 DERIVE 自 cert（R13）·只换 label/重组布局·不新造真值。
- feature `sim.radar_collapse` 暗发（datacore features.ts·defaultOn:false·battery all-on→demo 开·纯前端渲染闸无 agentcore 消费故不镜像）。

## 附记：本支 datacore 阻塞（非本单·已排障 flag Dev-4）
本单验证时发现**共享支 datacore 启动即崩**——`app.js` 静态 import `DeriveBatchRequestSchema`（Dev-4 WO-IMPORT-MULTITABLE）。
根因：`packages/contracts/src/import.ts` 已写该 schema 且 barrel `index.ts` 已 `export * from "./import.js"`，但 **contracts dist 未随之重建**（陈旧 dist 缺该导出）→ ESM 载入 SyntaxError。**重建 contracts dist 即解**（本单已重建·datacore 恢复启动）。
**残留（Dev-4 待补·非本单·非本人域）**：datacore `tsc` 仍红两处——`jszip` devDep 未加（`app.ts:3747` 懒 import·仅 zip 上传路径触发·非致命）+ `entry` unknown 类型标注（`app.ts:3750-3757`）。datacore dist 经 tsc 仍 emit 可运行（`noEmitOnError` 未设），但 `pnpm -r build` 交付底线仍因此红——需 Dev-4 收尾。
