# HANDOFF · WO-TIMEOUT-5000-SWEEP（测试墙钟预算清扫）

- 分支：`claude/handoff-wo-timeout-5000-sweep`
- 基线：集成线 `claude/verify-reclaim-6` tip = `0d56bbf54`（开工时经 SSH 一次性 URL fetch 的 FETCH_HEAD，与派单一致；分支直接从该点切出，`git status` 干净）
- 环境前置：`pnpm install --prefer-offline` RC=0 · `pnpm --filter @platform/contracts build` RC=0 · `pnpm --filter @platform/llm-adapters build` RC=0
- 日期：2026-08-19

## 1. 现算清单（金丝雀与更正）

派单写「全仓剩 21 处」；协调中途更正为 **14 处（6 文件）**。本 dev 现算实证两边口径：

```
grep -rn "timeout: 5000" apps/*/test/   → 21 命中（8 文件）
grep -rn "timeout:5000"  apps/*/test/   → 0 命中（无空格变体不存在）
grep -rnE "timeout: *5000[^0-9]"        → 与上全等（无其它间距变体）
```

21 = 14（本单范围）+ 7（edge-active.seam.test.tsx ×2 / disruption-cards.seam.test.tsx ×5）。
**金丝雀订正**：派单金丝雀说「edge-active.seam.test.tsx 若在清单里说明 grep 错了」——实测它**在**清单里，但 grep 没错：收口提交 `c9ff5936f` 是 `0d56bbf54` 的直系子提交、**尚未并进集成线**（`git merge-base --is-ancestor c9ff5936f HEAD` = false）。该两文件按范围边界排除，未碰。14 处在范围内的清单与协调更正数字一致。

## 2. 落点表（file:line → 新预算 → 亲跑 RC → 负载水位）

所有亲跑 = `npx vitest run <file> --maxWorkers=1`，stdout/stderr 全文落 /tmp/sweep-*.log；负载水位 = 开跑前 `ps -eo args | grep -F "node (vitest" | grep -v grep | wc -l`。

| 文件：行（改前） | 处数 | 新预算 | 整测试 60s 落点 | 亲跑 RC | 负载水位 |
|---|---|---|---|---|---|
| edge-panel-3pages.seam.test.tsx:169/175/186/213 | 4 | 20000 | SEAM order-chain 条（原 164 行）+60000 | **RC=0**（7/7 绿，SEAM 条实测 16s——旧 20s 全局预算负载下必炸） | 2 |
| wo-sim-action-real.project-sim-adopt.test.tsx:93 | 1 | 20000 | 改参数后采纳条（原 82 行）+60000 | **RC=0**（2/2 绿） | 4 |
| befe-wire-d.seam.test.tsx:325 | 1 | 20000 | ①-G 条 +60000；④-D 条 +60000（见 §3） | 首跑 RC=1 → 补 ④-D 预算后 **RC=0**（19/19 绿） | 4 / 4 |
| dbui-13-needs.seam.test.tsx:64（reachStepTwo 助手内） | 1 | 20000 | §1–§6 六个 renderApp 测试各 +60000 | **RC=0**（7/7 绿） | 6 |
| process-inspect.test.tsx:64/66（openPanel 助手内）/103 | 3 | 20000 | 10 个 renderApp 测试各 +60000（§A×2、§B×3、§C×2、§D×1、§E×2） | **RC=0**（12/12 绿） | 5 |
| dbui-flow.seam.test.tsx:59/86/124/140 | 4 | 20000 | 六步走/入库前复验/接缝裁决 三条各 +60000 | **RC=0**（5/5 绿） | 4 |

vitest 避让实录：批 2 开跑前水位 6（>3）→ 等 3 分钟 ×3 轮，水位 6→6→4→4 仍高 → 按派单先例记录证据后以 --maxWorkers=1 单文件推进（caplive 复验同先例）。

## 3. 真红红单

**无。**

唯一一次中途红（已定性收口，非真红）：befe-wire-d ④-D「不是死代码」条首跑 RC=1，失败原文首行 = `Error: Test timed out in 20000ms.`（befe-wire-d.seam.test.tsx:657）。该条是**同步静态扫描**（读文件 + toContain），无 await——红因不是断言失败，是负载=4 下事件循环饿死、整测试 20s 墙钟耗尽，与 edge-active「半修回红于 Test timed out in 20000ms」同签名。补 60000 整测试预算后同负载复跑 RC=0（19/19）。按协调更正判据（60s 预算 + 记录负载下仍红才算真红），此条不算真红。

## 4. 断言零改动声明

全部 diff 仅含三类内容：① `timeout: 5000` → `timeout: 20000` 数字；② 整测试收尾 `});` → `}, 60000);` 新增整测试 timeout 参数；③ 注释（标注预算来历，不断言）。无任何断言/逻辑/测试顺序改动。词级可核：

```
git diff 0d56bbf54..HEAD -- apps/ | grep -E "^[+-]" | grep -vE "^(\+\+\+|---)"
```

## 5. 铁律 0 判断（本体无需回写）

本单是**纯测试等待预算调整**：不新增/改变任何链路、事件、对象类型、不变量、门禁；src 一行未碰（`git diff --stat` 仅 6 个 test 文件 + 本文档）。判据字字未动、被测行为未变 ⇒ `docs/SYSTEM-ONTOLOGY.md` 无需回写。

## 6. 范围外说明（不动的原因）

- edge-active.seam.test.tsx（2 处 5000）/ disruption-cards.seam.test.tsx（5 处 5000）：已由 `c9ff5936f` 在旁支收口为 20000，按范围边界排除，避免同行冲突；并线时以该提交为准。
- 同文件内**未含** `timeout: 5000` 的 renderApp 测试（如 dbui-flow「屏上不出现区号」条、wo-sim-action-real「整单」条）：不在 14 处清单内，未加预算；亲跑中它们全部绿（含默认 findBy 1s 等待的断言），无假红证据，不动。
