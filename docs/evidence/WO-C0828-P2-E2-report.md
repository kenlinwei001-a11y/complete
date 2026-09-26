# WO-C0828-P2 · E2 判据取证报告（修复轮②收口）

- 分支 `claude/handoff-wo-c0828-p2`：修复轮② `7a620b799`（本次）+ #53 前端接线 `62d6bbfdd` + 修复轮① `bc4065568`
- 取证环境：真后端 datacore 4011（p2-self worktree dist · `SEED_DEMO=1` seed 42）+ 真浏览器（Chrome 1680×900）
- §8.2 纪律：datacore+agentcore 同对重启；金丝雀 `GET /a/v1/sim/sessions/sims_demo_seed_world/perturbations` count=1（仅 `_p0`）—— 本轮两次重启均过
- ⚠ **实施方=审核方披露**：本单由审核方自实现（用户选定「我自实现」，2026-09-11）。复验判据 = 本表 E2 机器可验证套件（live 取证 + 单测 25/25 + 前端接缝），不是自我背书。

## 修复轮② 内容（commit 7a620b799）

1. **基准锚定重放**：`simAdvanceTicks` 新增 `fromState/fromTick`（守卫：只许 `persist:false`）—— 定价基准 = 从最早扰动 `startTick−1` 的**历史定格态**零扰动重放到对照口径。修「排除推进从已烘入扰动的当前态起推 ⇒ 基准≡对照 ⇒ 假 E0」的病根。`readTickState(0)` = `baseSnapshot`。
2. **候选扰动 `startTick` 必传**（接线方传 `curTick+1`）：修「startTick 0 而推进从 curTick>0 起 ⇒ entersAt 恒 false ⇒ 扰动从不落地」（propagation.ts 只在 `startTick===producedTick` 的首次生效拍落笔）。
3. **TEMP-DIAG 删除**（PRICING_DEBUG console.log 块，`grep -c PRICING_DEBUG apps/datacore/src/app.ts` = 0）。
4. 单测 +2（E2-b′ 剂量传递、E2-b″ 敞口塌缩），**25/25 绿**。

## E2 判据逐条（PRD §5.2）

| 判据 | 结果 | 证据（live 双世界，本报告附件） |
|---|---|---|
| **E2-a** E0 与 Ec 都报出；Ec ≤ E0 方向性正向 | ✅ 都报出。utilization 候选（金华分切线 89.9153）：E0 = Ec = **0.06798572660600044** 逐字节（等式 ≤ 成立，horizon 3 差一拍够不到订单——诚实非零）。⛔ leadTime 候选 Ec > E0 —— 见「方向性披露」 | p2-e2-new.txt w2Util |
| **E2-b′** 同杠杆更大一档 toValue ⇒ p90 位移单调不增 | ✅ **双世界**。设备停机世界：to 10 → **0.5835048219210002**，to 25 → **0.5524699271200006**；种子世界：**0.5898104503240003 → 0.5240231994620004**。扰动幅度：−48.573744（to 10）/ +40.570502（to 25） | p2-e2-new.txt w1Priced/w2DosePair |
| **E2-b″** 敞口从≈E0掉到≈0 ⇒ 同屏显示越线张数与 p90 | ✅ 单测 fixture：越线 **2→0** 张、p90 **0.02→0.003**、faint 分账 2（p90 非 null 是地板下残余的诚实读数）。UI 同屏：探针读数文本「150 张 · 156.6亿元 · 位移 p90 …」。demo 世界无可致零剂量（live 诚实说明，fixture 补） | option-pricing.test.ts E2-b″；p2-e6-probe4.txt |
| **E2-c** 零扰动对照：单跑候选读数与 control 基线一致，⛔ 不许编出改善量 | ✅ 种子世界 control = **150 张 / 15,663,001,584 元 / p90 0.09273904103199992**（§0.2 结构：全在 0.01–1 桶）。候选读数如实报出自身足迹（0.5898/0.5240，未编改善）；utilization 候选 aft≡ctl 逐字节（扰动未及订单，如实） | p2-e2-new.txt w1Priced；单测 E2-c :233 |
| **E2-d** 反向金丝雀：候选扰动拿掉 ⇒ 读数回到 E0 | ✅ leadTime aft≠ctl（0.5898 ≠ 0.0927）⇒ 候选扰动真落地；拿掉 = control 推进 = E0 的结构半由单测钉死（E2-g 用例 calls[1] 无 ephemeral；E2-a 用例对照=E0 fixture） | p2-e2-new.txt；单测 :305/:333 |
| **E2-e** 无绑定杠杆 ⇒ 「本引擎量不出」＋点名缺的绑定；⛔ 不返 0 / 不返 E0 / 不从屏上消失 | ✅ 4× gap 点名 `missingBinding`：`{Process, attendance}` ×2、`{Process, yield_baseline}` ×2；屏上可见「未找到压力绑定：Process.attendance 无对应派生规格（拨了也不按式子传导，不编数）」 | p2-e2-new.txt w1Gaps/w2Gaps；probe4 |
| **E2-f** 披露：specKey/扰动落点/tick数/耗时/「本次未调用 agent」明写 | ✅ 每条回包 `disclosure`：specKey、targetObjectId、targetStateVar、tickCount=3、elapsedMs{binding/perturb/tick/diff/total}、**agentInvolved:false** | p2-e2-new.txt |
| **E2-g** 定价全程后 curTick 与扰动清单逐字节不变 | ✅ 双世界 before/after JSON 逐字节 equal（`e2g_w1=true, e2g_w2=true`） | p2-e2-new.txt 末行 |
| **E6-a** 1680×900 对策页签 scrollHeight/可见高 ≤1.15 | ✅ ratio **1.000**（452/452），5 条定价读数 + 2 detail 全屏显示，失败请求 0 | p2-e6-probe4.txt |

## 方向性披露（会改变下一步决策）

leadTime 候选（物料·到货周期，落点 pos_lfp shortageRisk）读出的 **Ec > E0**：
候选把 pos_lfp `shortageRisk` **set** 到派生公式在 toValue 处的值（to 10 → −48.573744），
而 §0.2 阶跃尺 = diff(无扰动基准, ·) —— 候选自身足迹（从自然值摆到 −48.57）即位移。
机制如实报「比不处置更偏离」，未糖化 —— **这是装配在按 PRD D2 的代入语义干活**。
根因在**枚举层**的扰动幅度语义（set 到公式极值产生过冲）。是否改枚举层语义（如 offset 当前压力）
属 D2 域裁决，**本报告只披露不动手**（越界）。

## 证据清单（全部 +rc 对）

- `docs/evidence/wo-c0828-p2/p2-e2-new.txt` + `.rc`（RC=0 · 双世界 live 实验全输出）
- `docs/evidence/wo-c0828-p2/p2-e6-probe4.txt` + `.rc`（干净世界 E6 探针）
- 既有（#53 提交 62d6bbfdd）：p2-e6a*.txt+.rc、seam/rail-forms 文件级结果
