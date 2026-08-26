# 并行开发协议 · 场景推演根治（2 agent + 主线 reviewer）

> 给在 worktree 里并行干活的 agent。**主线（我）做规则 P2 + 当 reviewer/merger**；你只管自己那一格，自闭环交付。
> 北极星：用户从任一入口触发推演必得真决策视图或诚实缺口；零"未能产出回答"、零"未找到定义"、零静默残缺。

---

## 0. 铁律（违反即退回，源 `fde-delivery` + `ontology` skill）

1. **绿测试 ≠ 能用**：交付前必须**以用户身份亲手从真实入口走一遍**，贴证据（门B 真后端真浏览器输出 / curl 响应）。不拿单测/门绿冒充"能用"。
2. **断点在接缝**：分析沿链路走（入口→QOS→计划→求解器→规则→渲染），不只看模块内部。
3. **绝不静默残缺**：缺口要么自动补、要么诚实显示+开单；禁占位文案冒充答案、禁 fail-open 冒充已校验。
4. **改接线必回写本体**：动了链路/事件/对象类型/不变量/门禁 → 回写 `docs/SYSTEM-ONTOLOGY.md` 对应章节（§8 断点表优先）。改前先读 `docs/SYSTEM-ONTOLOGY.md`（或它的 §8/§3 相关段）。
5. **确定性**：合成/求解器同输入同输出（R6）；测试不依赖网络/时钟随机；LLM 一律 mock。

## 1. 硬边界（防 merge 翻车，必须遵守）

> **⚠️ 本轮（P3）教训修订——上轮真踩过的坑，必须照做：**
> 1. **开工前基线自检（铁规）**：第一步先 `git log --oneline -3`，确认 HEAD 落在 `claude/vigilant-knuth-b1nmxn` 主线上、最新 commit 主题与主线给你的一致。**若看到 `ontoflow`/`PRD-IND-story`/与本任务无关的 commit → 你的 worktree 基线错了**（上轮两个 agent 都被误基线到 ontoflow）：执行 `git fetch origin claude/vigilant-knuth-b1nmxn && git reset --hard origin/claude/vigilant-knuth-b1nmxn`，再 `git log --oneline -3` 复确认，**绝不在错误基线上开工**（否则全部白做）。
> 2. **禁改 `docs/SYSTEM-ONTOLOGY.md`**：本体回写由主线**集中**做（上轮两 agent 都改 §8 → merge 冲突）。你在最终报告给**《本体回写清单》**：列出触及的 §2 对象/§3 链路/§4 事件/§7 门禁/§8 断点 + 该写什么文字，主线统一落。
> 3. **禁改 `package.json`**：新增门/脚本/npm script 只在报告里报，主线集中 wire `pnpm gates` + §7（否则 package.json 撞车 + 漏 §7 被 `ontology-writeback:check` 拦红）。

- ⛔ **禁止改 `packages/contracts/**`**。契约改动只主线做。若你的任务确实需要新契约字段 → **停下，在最终汇报里写明需要什么字段，交回主线加**，不要自己改 contracts。
- ⛔ **禁止改 `docs/SYSTEM-ONTOLOGY.md` 与 `package.json`**（见上方教训 2/3，主线集中做）。
- ⛔ **禁止 `git push`、禁止建 PR**。你在 worktree 里 commit 即可；主线负责核验→合并→推送。
- ⛔ **只碰你 task book 列的文件**。跨出文件清单前先在汇报里说明。
- ✅ 你的新增**测试文件**用独立文件名（`<feature>.test.ts`），不改他人测试。
- ✅ 触及共享文件（`mocks/clients.ts`、`mocks/handlers.ts`、`mocks/fixtures.ts`）务必最小化改动并在汇报里点名（merge 冲突高发区）。`scripts/check-*.mjs` 新增门只报告、不自己并入 gates。

## 2. 交付清单（最终汇报必须含，缺一项退回）

1. **改了哪些文件**（逐个列）+ 一句话说明各自改动。
2. **单测**：新增/改的测试名 + 本地 `pnpm -r build && pnpm -r test` 结果（贴 4 包 Tests 行）。
3. **门**：`pnpm gates` 结果（绿/红，红则贴哪条）。
4. **门B 真后端真浏览器证据**：你亲手起 datacore+agentcore+vite、以用户身份走一遍的**实测输出**（前端真渲染了什么 / curl 真返回什么）。这是"能用"的唯一凭据。
5. **本体回写**：动接线了就贴回写了 §几；没动就说明"未触及接线"。
6. **诚实边界**：还差哪几环 / 哪些是 happy-path / 哪些没做完。绝不报"全好了"含糊带过。

## 3. 怎么跑门B（真后端真浏览器，照抄）

```bash
# 1) 构建
pnpm -r build
# 2) 起 datacore（内存模式，含 demo 种子）
CK=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
PORT=4001 JWT_SECRET=dev BLOB_DIR=/tmp/blobs SEED_DEMO=1 CREDENTIAL_KEY=$CK node apps/datacore/dist/server.js &
# 3) 起 agentcore
PORT=4002 DATACORE_BASE_URL=http://127.0.0.1:4001 node apps/agentcore/dist/main.js &
# 4) 起 vite（真后端模式，非 mock）
cd apps/frontend-shell && VITE_DATACORE_URL=http://127.0.0.1:4001 VITE_AGENTCORE_URL=http://127.0.0.1:4002 npx vite --port 5199 --host 127.0.0.1 &
# 5) Playwright：chromium 在 /root/.cache/ms-playwright/chromium-1148；登录 demo/admin/demo1234；
#    SPA 内导航用 pushState+popstate（不要 goto，会丢内存态 JWT）。参考 scripts/ui-smoke-ontogenesis.mjs / ui-smoke-rules.mjs。
```
- 后端冒烟（无浏览器也先做）：`curl` 直打端点看真返回。
- 真浏览器：照抄 `scripts/ui-smoke-rules.mjs` 的结构（findChromium/login/pushState 导航/断言），为你的特性写一个 `scripts/ui-smoke-<feature>.mjs`。环境无 chromium 时脚本 SKIP(exit 0) 但**你必须先 curl 后端证明端到端通**。

## 4. 超时与求助

- 卡住 ~30 分钟没进展 → 停，汇报"卡在哪 + 试过什么 + 怀疑哪个接缝"，交回主线，别钻牛角尖。
- 任务比预期大/触及 contracts/触及他人文件 → 立即汇报，不擅自扩面。

---

## Agent A · 规则即引用 P3-a：规则编辑器 UI 完善（编辑闭环·前端）

**文件归你**：`apps/frontend-shell/src/pages/admin/RulesPage.tsx`、`apps/frontend-shell/src/api/endpoints.ts`（仅规则 CRUD 端点，缺则补）、`apps/frontend-shell/src/mocks/handlers.ts`（仅规则 CRUD/dry-run mock，最小改动）、你的新测试文件、你的 `scripts/ui-smoke-*.mjs`。**不碰 contracts / SYSTEM-ONTOLOGY.md / package.json**。

**目标**：让 admin 在规则编辑器**可编辑闭环**——增/改规则的 `expression` + **`params`（命名阈值，键值可编辑）** + `severity` + `scopeObjectTypes`，dry-run 预览，发布/退役走版本。P2 已让前端 RuleRef tooltip **显示** params；P3 让 params 在编辑器**可改**。
- 后端已有：`POST/PUT /a/v1/rules`、`/:id/publish`、`/:id/retire`、`/a/v1/rules/dry-run`、`/a/v1/rules/:id/references`（发布影响面）。RulesPage 现已有列表 + 部分编辑（grep `RulesPage.tsx` 看现状：编辑器表单是否含 params 字段、dry-run 预览是否接）。
- 补齐：编辑器表单加 **params 键值编辑**（`Record<string,number>`，增行/删行/改值），保存经 PUT；dry-run 预览块（输入样例 payload → 显示命中/未命中）；发布确认（已有 publish-impact）。
- 验收：前端单测（编辑器渲染 params 行 + dry-run 调用）+ **门B 真后端真浏览器**：admin 登录 → /admin/rules → 改某 DRAFT 规则的 params/expression → dry-run 预览 → 发布 → 列表显 version+1/PUBLISHED。**注意 `mocks/handlers.ts` 是共享文件**，只加规则 CRUD 所需、最小改动、汇报点名。

---

## Agent B · 规则即引用 P3-b：其余求解器 evaluatedRules payload 映射（全求解器真评估）

**文件归你**：`apps/datacore/src/solvers/service.ts`（**仅 `ruleEvalPayload` 私有方法**——P2 主线刚加，你只扩它，绝不动 `evaluateRuleRefs`/`loadContext`/`invoke` 其它部分）、你的新测试文件、你的 `scripts/ui-smoke-*.mjs`。**不碰 contracts / SYSTEM-ONTOLOGY.md / package.json**。

**背景**：P2 只让 `capacity_forecast` 的 C01/C02/C03/C09 真评估（`ruleEvalPayload` 为它补了 `Order.demandDelta` + `DataSourceHealth`）；其余 18 求解器的规则因**输出字段名 ≠ 规则表达式字段名**全落 NOT_APPLICABLE。
- **目标**：扩 `ruleEvalPayload(c, solverKey, args, out)`——为高价值求解器把"输出/上下文"映射成规则 expression 期望的 payload 字段，使 evaluatedRules 真出 PASS/WARN/BLOCK。
- **逐个核对字段**（必须 grep 求解器实现 + `SOLVER_OUTPUT_SHAPES`(service.ts) + 规则 expression（`battery.ts rules[]`）确认真实字段名，别拍脑袋）。优先：
  - `quote_margin`（C15/C24 `Order.marginPct < Order.floorPct` / `Quote.marginPct<floorPct`）：输出有 `margin`/`floor` → 映射 `Order.marginPct=margin*100? floorPct=floor*100?`（核对口径：margin 是 0.2565 比率还是百分；floor 同）。
  - `credit_exposure`（C13 `Order.creditUsedRatio>1` / C32 `Customer.maxOverdueDays>30`）：输出 limit/exposure/available/overdue → 映射。
  - `carbon_footprint`（C33 IMPLIES 碳护照）：输出 total/threshold/verdict → 映射 destination/carbonFootprint/euCarbonThreshold（或用 verdict 直判）。
  - `kit_readiness`/`lta_gap`/`inventory_optimize`（C06/C16 `MaterialBalance.gapTon>0`）：输出有 gap/shortage → 映射 `MaterialBalance.gapTon`。
  - `changeover_sequence`（C22 `Order.changeoverMin>120`）：输出 totalChangeoverMin → 映射。
- **诚实**：映射不了/口径不清的**留 NOT_APPLICABLE，别硬凑**（宁可诚实不适用，不可假评估）。每个映射在汇报里写"字段口径依据"。
- 验收：后端单测（每个新映射求解器 invoke → evaluatedRules 出真 outcome，且阈值边界翻转可验）+ **门B 真后端**：curl `POST /a/v1/solvers/<key>/invoke` 看 evaluatedRules 真评估（贴响应）。无 chromium 时后端 curl 即可（本任务无前端面）。

---

## （主线我做，不分配给 agent）规则即引用 P3-c
版本/事件失效闭环（`rule.updated`/`rules.updated` → AgentCore 缓存失效 60s SLO，全 7 入口下次读新版）+ 6 入口逐一 FDE 验收 + **集中本体回写**（§2/§3/§7/§8）+ 合并两 agent。Agent A/B 不碰这块。
