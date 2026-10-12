# WO-CONSOLE-COPY · 「事件影响与对策」结果文案结构化 + 术语通俗化（2026-09-28 仓主令）

仓主两条反馈：① 输入扰动因素后的**推演结果描述不专业**，要结构化输出；
② 「单子太多，铺不下…」「…· 必填」这类**不必要的描述**；③ 「世界」这类词不易理解。

## 判据与证据（判据全部落在**渲染结果**上，禁源码 grep 自证）

| # | 文件 | 判据 | rc |
|---|---|---|---|
| 01 | `01-model-test.txt` | `decision-console-model.test.ts` 29/29（含新增「口径表里不许有开发话」R-UI-4 一条） | 0 |
| 02 | `02-probe.txt` | CDP 探针打真后端（datacore 4031 + vite 5175）11 项全绿 → PASS | 0 |
| 02 | `console-copy-1680x900.png` / `console-copy-note.txt` | 截图与口径表正文（人眼可核） | — |
| 03 | `03-build.txt` | `pnpm --filter frontend-shell build`（tsc build 配置 + vite build） | 见 `.rc` |

探针 11 项：route / table / heads（读数·随本次事件·它在回答什么）/ rows≥5 / E6 尺子 ratio≤1.15 /
无 seed / 无接口路径 / 无 curl / 页面根内无「世界态·本体真值·世界」/ 无字面 `**` / 真后端命中 61 条。

复跑：`E2E_BASE=http://127.0.0.1:5175 E2E_API_PORTS=4031 E2E_SHOTS=/tmp/x node apps/frontend-shell/test/e2e/console-copy-verify.mjs`

## 环境注记（读数会误导人的两处，写下来免得下次重踩）

- **本机 2026-09-28 16:31–16:56 load average ≈ 680**（共享机上还有别人的 datacore vitest 在跑）。
  同一条 `POST /a/v1/sim/sessions/.../drill` 实测 **67.8s / 77.9s / 94.5s / 126.0s** —— 探针原来等 120s，
  16:54 那次就正好卡在门外被判「口径表没渲染」。已把等待放到 360s，并写明理由：
  **机器慢 ≠ 功能坏**。
- 下拉主体选项来自**异步查询**（`list.data?.items`）：点开模板行后立刻读，只会读到占位项
  「请选一个（共 0 个）」，看着像「这个 kind 没有主体可选」。探针已改为等选项出现（≤15s）。

## 本单**没**做的（范围外，未经仓主批准）

- 左导航「**组织世界**」是**另一个模块**的名字（本页唯一残留的「世界」），不在本单范围。
- `views/sim/` 其余各处仍有「世界」类词（SandboxView / EdgeActivePanel / ImpactAnalysisPanel /
  EnterpriseState* 等），属禁令 2 范围（沙盘 UX 改动须逐案批准），未动。
