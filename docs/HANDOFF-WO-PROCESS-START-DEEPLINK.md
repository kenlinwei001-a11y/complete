# HANDOFF · WO-PROCESS-START-DEEPLINK（创建成功块 → 实例详情深链）

- 分支：`claude/handoff-wo-process-start-deeplink`
- 基线：`origin/claude/verify-reclaim-6` @ `9945e77c1b364c64252a93a536622b120d66253a`
- 日期：2026-08-20

## 改了什么

**病灶**：`ProcessStartFromTemplate` 创建成功块（`created.status === "ready"`，`data-testid="start-created"`）只把实例 id 显示为纯 `<code>` 文本（`start-created-id`），没有跳转实例详情页的链接 —— 建完实例后用户无法一键进详情。详情深链页早已存在（route `process-instances/:instanceId`，App.tsx:163），且已有两处入口先例（`ProcessStuckView.tsx:175`、`ProcessWaitView.tsx:240`，写法均为 `to={\`/process-instances/${encodeURIComponent(...)}\`}`）。

**改动（2 文件，+18 行）**：

1. `apps/frontend-shell/src/views/process/ProcessStartFromTemplate.tsx`
   - 头部 `import { Link } from "react-router-dom";`
   - 成功块内、`start-created-count` 之后新增：
     ```tsx
     <Link
       to={`/process-instances/${encodeURIComponent(created.data.instance.id)}`}
       data-testid="start-created-link"
     >
       查看实例详情 →
     </Link>
     ```
   - 既有 `start-created-id` / `start-created-count` / `start-created` testid 一字未动；未新增 css 类（默认锚样式，复用 `.ok` 容器）。
2. `apps/frontend-shell/test/process-start-from-template.seam.test.tsx`
   - 在接缝①主用例回显断言后扩断言：从屏上 `start-created-id` 读出实例 id（即 MSW mock POST 回包渲染出来的真 id，测试不另造），断言 `start-created-link` 存在且 `href === /process-instances/${encodeURIComponent(instanceId)}`。

**禁碰清单核实**：未碰 RiskBoardView / DataBuilderPage / gate-ledger.json / 任何 scripts/check-* 门脚本。

## 测试证据

环境前置：`pnpm install --prefer-offline` ✅；`pnpm --filter @platform/contracts build` ✅；另 `pnpm --filter @platform/llm-adapters build`（typecheck 报 `Cannot find module '@platform/llm-adapters'`，补建 dist 后过）。

1. 目标测试（含新断言）：
   ```
   cd apps/frontend-shell && npx vitest run test/process-start-from-template.seam.test.tsx
   → Test Files 1 passed (1) · Tests 8 passed (8) · RC=0
   ```
2. 邻域回归（ProcessStuckView / ProcessWaitView / 详情页，未动但要证明没误伤）：
   ```
   npx vitest run test/process-stuck.seam.test.tsx test/process-wait.test.tsx \
     test/process-wait-stuck-link.seam.test.tsx test/process-instance-detail.seam.test.tsx
   → Test Files 4 passed (4) · Tests 69 passed (69) · RC=0
   ```
3. 类型检查：`pnpm --filter frontend-shell typecheck` → RC=0。

**跑测试避让**：跑前水位探测 `ps -eo args | grep -F "node (vitest" | grep -v grep | wc -l`：首轮 4（>3，等待），约 3 分钟后复探 0，正常并发跑完，未启用 `--maxWorkers=1`。

## 本体回写说明

**无对应行，未回写**。在 `docs/SYSTEM-ONTOLOGY.md` 全文检索：「创建成功」0 命中；「B5」0 命中（仓内亦无此挂载点编号）；「深链」∩「process-instances」仅 2131/2136/2140 三行，均为 G-BE-FE-SEAM-DEAD 族棘轮台账行，其中提到的「深链路由 + 双入口」是 WO-PROCESS-INSTANCE-UI 的**历史闭账引文**（提交 dc998e41），不是本特性的登记行；ProcessStartFromTemplate 的登记行（:299 ProcessStepTemplate 条目）句尾是「六条设计判据，改之前必须先读：」的引子句，无「创建成功页深链」对应句。按工单约定「找不到完全对应的行就不加新行」，此处仅说明、不改动。

## merge-tree 自测

```
git merge-tree --write-tree origin/claude/verify-reclaim-6 HEAD > /tmp/mt-deeplink.out 2>&1; echo $?
→ RC=0（输出树 f60637b1202965c3864bedebc8c85a88fb332e68，无冲突）
```

## 完工状态

- tip：`7e404129e7fd9dcf28ac31bd8317003172ebfbc9`（已 push 至 `claude/handoff-wo-process-start-deeplink`）
- `git status --porcelain`：零行（净）。
