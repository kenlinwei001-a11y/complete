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

- ⛔ **禁止改 `packages/contracts/**`**。契约改动只主线做。若你的任务确实需要新契约字段 → **停下，在最终汇报里写明需要什么字段，交回主线加**，不要自己改 contracts。
- ⛔ **禁止 `git push`、禁止建 PR**。你在 worktree 里 commit 即可；主线负责核验→合并→推送。
- ⛔ **只碰你 task book 列的文件**。跨出文件清单前先在汇报里说明。
- ✅ 你的新增**测试文件**用独立文件名（`<feature>.test.ts`），不改他人测试。
- ✅ 触及共享文件（`mocks/clients.ts`、`mocks/handlers.ts`、`mocks/fixtures.ts`、`scripts/check-*.mjs`）务必最小化改动并在汇报里点名（merge 冲突高发区）。

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

## Agent A · BP-6 相对时间归结 + BP-7 空结果显性化（诊断账本 D6/D7）

**文件归你**：`apps/agentcore/src/router/slots.ts`、`apps/agentcore/src/router/orchestrator.ts`（仅 slot 填充相关）、`apps/agentcore/src/workflow/executor.ts`（仅 `summarizeSolverOutput`）、你的新测试文件、你的 `scripts/ui-smoke-*.mjs`。**不碰 contracts**。

**BP-6（相对时间归结）**：S03「常州物料齐套为什么**这天**越线」中 `day` 槽被 Kimi 抽成 `"这天"` 不可解析 → 归结失败。
- grep 确认 slot 填充在 `router/slots.ts`（fillSlots）。加**确定性归结层**：相对时间引用（这天/today/下周/本月）→ 视图上下文具体日期（这天=视图焦点日/模拟时钟当前日；下周=焦点周+1…），放在 LLM 抽取之后兜底。
- ⚠️ **优先用现有 SessionContext 字段**（view/filters/已有日期上下文）做归结，**不要新增 contract 字段**。若确实缺字段 → 停，汇报需要什么，交主线加。
- 验收：S03 端到端 `day` 解析为具体日期（不再 null）；时间相关卡不空槽。后端单测 + 门B（点 S03 看 day 真值/根因不再失准）。

**BP-7（空结果显性化 / D7）**：S19 `quarterly_gap` 跑通但 `combo:[]`、`residualGap:50` → 用户看到"有缺口、对策为空"沉默空数组。
- 锚点 `workflow/executor.ts:404 summarizeSolverOutput`（已有 P2 通用投影；现仅 `out.length===0` 时出一句"无输出数据"）。
- 增强：求解器产出**空数组字段**（combo/rows/over…全空）时，render 出"**为何为空 + 下一步建议**"，并**区分"真无解"与"数据未接齐"**（如关键标量在但数组空=真无解；关键标量也缺=数据未接齐）。不静默吞空数组。
- 验收：S19 出"对策为空，因 X；建议 Y"，可溯源。后端单测（喂空组合 payload → 出显性化文案块）+ 门B（点 S19 看到显性化而非空白）。

---

## Agent B · BP-4 sop 卡接真数据 + ontogenesis:check 扩断言

**文件归你**：`apps/agentcore/src/mocks/seed.ts`（仅 S18/sop_balance 计划分支）、`scripts/check-ontogenesis.mjs`、你的新测试文件、你的 `scripts/ui-smoke-*.mjs`。**不碰 contracts**。共享文件 `mocks/clients.ts` 尽量不碰（优先复用已有 mock 的求解器）。

**BP-4（S18 sop 卡出真数据，D4）**：S18 现仅渲染跳转文本"S&OP 月度平衡台请见对应视图"（`seed.ts:410-413` 的 `sop_balance` 特判），无任何计算/进度/缺口数 → 点卡承诺落空，且被 P2 诚实门正确标 PROVISIONAL/RENDER_NOT_PROJECTED。
- 改 S18 计划：不再纯跳转，改 `invoke_solver` 一个**已注册且 mock 已支持**的求解器出富 KPI——**首选 `mrp_netting`**（输出 materials/shortageCount/summary）**或 `cockpit_kpi`/`finance_pnl`**（先 grep `SOLVER_OUTPUT_SHAPES` + `mocks/clients.ts` 确认该 solver mock 直连出真值，避免 404/400）→ 配 P2 通用投影 `solver_summary`（`{ type:"solver_summary", output:"{{steps.s1.output}}", fromStep:"s1" }`）出 KPI/表。
- 目标：grow S18 → GOVERNED（带真数据），不再 RENDER_NOT_PROJECTED。
- 验收：后端单测（grow S18 → VERIFIED + 答案含 kpi/table 块）+ 门B（点 S18 / grow S18 看到本月平衡/缺口真数据，非一句跳转）。**注意**：S18 当前是 `scenario-ontogenesis.test.ts` 里"诚实门 PROVISIONAL"用例的样本——你改了 S18 会让那条用例失效，需**改用别的纯指针卡**或调整该用例（在汇报里说明你怎么处理的，别静默改挂别人的测试）。

**ontogenesis:check 扩断言**：`scripts/check-ontogenesis.mjs`（41 行，现为保守声明性校验）按 PRD-scenario-ontogenesis §6 扩**静态可校验**的逐卡断言。
- ⚠️ **诚实分清静态 vs 运行期**：§6 有 6 条，其中"每张 GOVERNED 卡有 VERIFIED run"等是**运行期**事实（需真 grow，静态门测不了）→ **不要假装静态能测**。只加**静态可校验**的（如：每张卡 plan 的 render 步存在；卡声明的 solver 在 `SOLVER_OUTPUT_SHAPES` 有形状；卡 rules 引用 ⊆ 已定义——可复用 `rule-closure` 思路）。运行期项**明确 log 跳过+说明原因**，不静默冒充覆盖。
- 验收：`node scripts/check-ontogenesis.mjs` 绿、并入 `pnpm gates` 不破其他门；汇报列清"加了哪几条静态断言、哪几条运行期的诚实跳过"。
