# WO-DB-FIVE-ACT-UX（§3 理解确认门·暴露洞给人）· 证据（2026-07-12·dev3）

暴露"建域塌方"给人（KILL-MOCK-RED 用户侧闸）。多数诚实信号已由前置单落地——本单补**理解确认门**缺口：

## 本单增量
- **故事覆盖度百分比**（`sbr-coverage-pct`）：原 StoryCoverageView 只显未映射**计数**，改显**百分比**（读懂了几成·色分档 100%绿/≥60%黄/<60%红）。
- **理解确认门·可拒**（`sbr-coverage-reject-gate`）：有读不懂句 → 诚实劝阻「建议**拒绝**建域、补充/改写故事后重建，勿在未理解之上建域（空壳冒充真派生）」。

## 前置已在（本单不重复）
- **真绿才绿·BUILD_STATIC 显非绿**：`sbr-verify-status` 三态诚实——VERIFIED 绿「已验证可答✓」/ NOT_VERIFIED 红「未验证(不可答)✗」/ **BUILD_STATIC 黄「兜底静态(未过 QOS 运行时)」**（暴露洞D·非绿）。
- 未映射句红高亮（`coverage-unmapped`·⚠未理解）+ 全链闭包可视化（`sbr-closureviz`·gatePassed）已在。

## 验证（铁律 0.4）
- 单测 `test/db-coverage-gate.test.tsx`（3·green→red）：全命中 100%无门 / 部分 2/3=67%+门现身+未理解红标 / 全不懂 0%+门。
- 集成 `test/f50.data-builder-trust.test.tsx`：demo 三句全命中 → sbr-coverage-pct=100%·无拒绝门。
- **真浏览器**：真登录→/admin/data-builder→建域→`sbr-coverage-pct` 真显「100%」（demo 全命中）。截图 `DB-FIVE-ACT-UX-coverage-realbrowser.png`。
