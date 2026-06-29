# 评审核发 — `PRD-opensource-fusion-lastmile.md` 实装（dev 提交 41330b6）

> **角色**（铁律0.5）：本文是**审核方**对 dev 实装的**独立真跑复验核发**，非开发产物。判据 = PRD §6 合并验收基线 10 点 + 蒙眼对抗式独立验证（curl oracle，非 grep / 非账面 / 非信"全绿"）。
> **复验环境**：datacore :4001（`SEED_DEMO=1 SEED_OPT_INDUSTRY=1 OPTIMIZER_BASE_URL=http://127.0.0.1:4003`）+ 真 OR-Tools sidecar :4003（`services/optimizer/server.py`·ortools 9.15.6755）+ agentcore :4002。
> **核发结论**：**闭合（CLOSED）**。9/10 基线点审核方亲手 curl 实拍复现 dev 全部声称值；第 10 点（全量门）后台跑收集。**外加一项 dev 未做的对抗测试（杀 sidecar）坐实"真 CP-SAT 依赖、非硬编码"** —— 这是本簇从 ◐ 翻 ✅ 的关键证据。

---

## 1. §6 合并验收基线 · 逐点独立复验

| # | 验收点 | 真值判据（FDE oracle） | 审核方独立复验结果 | 判 |
|---|---|---|---|---|
| 1 | entitlement 暗发（R3） | 关→`/opt/*` 404 | 非授权租户 `GET /a/v1/opt/templates` → **HTTP 404**；demo 开 `opt.*` → 可见 | ✅ |
| 2 | 真 CP-SAT solve | OPTIMAL+真目标值（非 graceful 400） | demo `facility_location` → **status:OPTIMAL · open:[jiangmen] · obj:56802.4** | ✅ |
| 3 | 非电池行业租户真立 | 全链 provision→绑定→出最优 | `logi` `POST /growth/provision-world` → **物化 16 对象（6 Warehouse+10 Store）**；该租户 `/opt/solve` 出最优 | ✅ |
| 4 | **两行业 R14 真 CP-SAT** | 同模板各出**不同**最优·代码零改仅 binding | demo **[jiangmen]/56802.4** ⊕ logi **[WH-002]/249** —— 同 `facility_location` 模板/求解器代码、仅 `OntologyBinding` 不同 | ✅ |
| 5 | optimize_whatif 真重解 | Δ目标+冲突约束（真双解·非 mock） | WH-002.openCost→9999：**baseline 249 → perturbed 274 · Δ=25 · feasible** + 见 §2 对抗坐实 | ✅ |
| 6 | provenance 非空 | gate 绿 + 真 OptModelTemplate 实例 | `/opt/templates` 返 **5 实例**带 `provenance{derivedFrom:"OR-Tools CP-SAT…",license:"Apache-2.0…"}`；`opt-template:check` 绿（5 核心 requiredRoles 齐·LIC4 留痕·零业务常数） | ✅ |
| 7 | 确定性 R6 | 同绑定同参两次 solve 字节一致 | whatif 二次复打 **baseline=249 perturbed=274 Δ=25 完全一致**；`opt-determinism:check` 绿（seed+单线程·稳定输入序·embedding 隔离 FUS2） | ✅ |
| 8 | 许可证 | gate 绿·无 Gurobi·无训练管线 | `solver-license:check` 绿（扫 791 文件·NOTICES 四红线在·无 Gurobi 指纹·优化作用域无训练管线·派生留痕·违规 0） | ✅ |
| 9 | 门全绿 | `pnpm gates`（含 3 优化门）绿 | **全量 `pnpm gates` 22 门 + `datacore build` 亲跑全绿·零失败**（含 solver-license/opt-template/opt-determinism 三优化门 + ontology-writeback + validation:check V10 SMOKE pass） | ✅ |
| 10 | 本体回写 | §8 G-5/G-12 + §2.J provenance | §8 G-5 行记非电池租户收口、G-12 行翻 **✅ last-mile 收口（U1–U6…门绿）**；§2.J 优化融合域契约在；`ontology-writeback:check` 绿（22 门均登记 §7） | ✅ |

集成测试 `test/opt-real-sidecar.integration.test.ts`（env-gated `OPTIMIZER_BASE_URL`）接真 sidecar **3/3 通过**（facility_location OPTIMAL·optimize_whatif Δ·two-industry R14），非 skip、非 MockFive。

---

## 2. 审核方追加 · 对抗测试（dev 证据中没有，本核发关键）

PRD §6 核心红线是「**mock 引擎 = 不算交付**」。要证 CP-SAT 是**真依赖**而非"恰好返回 OPTIMAL 的硬编码"，唯一判据是**杀掉求解器看结果会不会跟着崩**。审核方独立做了 dev 未做的杀进程对抗：

| 步骤 | 动作 | 结果 | 含义 |
|---|---|---|---|
| A | sidecar 在世 · whatif | `Δ=25 · feasible` | 基线 |
| B | `kill -9 5773`（精确 PID·`services/optimizer/server.py`） | healthz → **000（已死）** | 求解器真停 |
| C | 同 whatif 再打 | **`INTERNAL_ERROR "fetch failed"`** —— **不是** 硬编码的 Δ=25 | **真依赖坐实**：结果经 HTTP 真打 sidecar 算出，无求解器即无解，无法伪造 |
| D | 重启 sidecar · 同 whatif | `Δ=25` 复现 | 恢复 |
| E | 二次复打 | `Δ=25` 字节一致 | R6 确定性 |

**判定**：A→C→D 闭环证明 `optimize_whatif` 的 Δ 是 OR-Tools sidecar 真双解算出，**杀求解器即 fetch 失败**，硬编码不可能有此行为。本簇「绿测试≠能用」的"最后一公里"——**真在活系统通电了**。

---

## 3. 诚实边界（北极星仍差什么·非本期硬性范围）

按 FDE 纪律附"距北极星还差什么"，以下是审核方核到的真实边界（dev 在 PRD §8 已诚实披露，非隐瞒，记此备查）：

1. **降级路径欠典型化（P2·建议补）**：sidecar 死时 `/opt/whatif` 返**通用 `INTERNAL_ERROR` 500**，而非语义化 `503 SOLVER_UNAVAILABLE`。功能上安全（不伪造结果），但前端拿不到"求解器不可用"的可读信号 → 建议补一个 typed 降级码（小工单，不阻断核发）。
2. **CI 默认不打真 CP-SAT**：真集成测试 `describe.skipIf(!OPTIMIZER_BASE_URL)`——默认 `pnpm -r test` 绿**不**覆盖真 sidecar。这是 dev 诚实保留的"无外部进程依赖 CI"权衡，**但意味着"测试全绿"对优化链仍是必要非充分**；真值靠审核方上面这套真跑兜底。可接受（dev 提供了 env-gated 真测试 + repro 脚本），记此提醒：**别让后续看到 test 绿就以为优化链被覆盖**。
3. **非电池世界经 synthetic 确定性路立、非 LLM runStory**：`runStory`（倒序发育建本体）走 LLM、本环境 mock → `logi` 世界是经 `provision-world` 合成链确定性立（真非 mock 的建模路径，但**不是** G-9 那条 LLM 发育闭环）。R14"两行业可优化"真闭；G-9 的 LLM 全自动发育另案（不在本 PRD 声称内）。
4. **范围内只立 1 个非电池行业**（物流仓配）——PRD §8 明示"≥1 非电池证 R14 即可，7 行业全立按需"，故非缺口。深分支树（U7）/ 离线进化器（U8）远期，本期不硬性。

以上 1 是建议补的小工单；2/3/4 是 PRD 明示的诚实边界，**不影响本次核发闭合**。

---

## 4. 核发

**`PRD-opensource-fusion-lastmile.md`（U1–U6 收口）= 闭合**。这是本簇（G-5 去电池多租户 / G-12 优化融合 / 优化模板池）从 ◐ 翻 ✅ 的**实质交付**——区别于此前账面"机器建好门全绿"的关键是：审核方**亲手 curl 实拍了真 CP-SAT 两行业不同最优 + whatif Δ + 杀 sidecar 对抗坐实真依赖**。机器层未动，dev 照 PRD 实现 + 自验贴证属实。

**建议后续小工单（非阻断）**：§3.1 求解器降级码 typed 化（`503 SOLVER_UNAVAILABLE`）。
