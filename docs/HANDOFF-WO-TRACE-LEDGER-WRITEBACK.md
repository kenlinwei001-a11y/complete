# HANDOFF · WO-TRACE-LEDGER-WRITEBACK（轻画像·纯文档，零代码）

> **基线**：集成线 `claude/verify-reclaim-6` tip **`914d0289b`**（内容级核查，非哈希祖先判定）。
> **分支**：`claude/handoff-wo-trace-ledger-writeback`。
> **范围边界**：只碰 `docs/REQUIREMENTS-TRACE.md`（本 HANDOFF 为派单点名交付物，不计入源码 diff）。
> **任务**：「⛔ 未派（我欠的）」节六项中 #1–#5 经独立重审实际已做，做记账回写；#6 仍阻塞，原样保留。

## 0 · 本节开工前的真实形态（比派单描述的更糟一层）

派单说「:222-228 六项」。实测该节躺着**两份清单**：

- **清单甲**（原 :190-221）：#1 未划线；#2–#5 已划线带 ✅ 回写。
- **清单乙**（原 :222-228）：#1 已划线带 ✅；#2–#5 **未划线**；#6 未划线。

即同一件事在同一节里既是「已闭」又是「未派」——正是本文件 B4a 行记过的形态
「新增一行不等于旧行作废」的**整节版**。本次合并为一份清单：#1–#5 划线带 ✅（保留既有回写全文），
#6 字节级原样保留（diff 实测见 §7）。

## 1 · 步骤模板层（B4 前置）⇒ 划线 ✅

**验证证据（对 914d0289b 工作树实测）**：

- `packages/contracts/src/process-step-template.ts` **存在**（18440 B），
  `tasksFromStepTemplate` 导出在 `:238`（`/usr/bin/grep -n "tasksFromStepTemplate"` 命中）。
- `apps/frontend-shell/src/views/process/ProcessStartFromTemplate.tsx` **存在**（15693 B）。
- B4 的 ✅ 行已在（表内第二行 B4）：接缝 `apps/datacore/test/process-instance-wire.seam.test.ts`
  与前端 `test/process-start-from-template.seam.test.tsx` **均存在**；行内载「7 条有模板的流程全部走通、
  读回步数 == 模板步数、变异反证 RC=1」。
- **:41 矛盾行订正**（派单点名）：旧 B4 行写 🟡「前置是步骤模板层，⛔ 未派」，与相邻 ✅ 行互相矛盾。
  订正前后文对照：

  前：
  `| B4 | 剩余 POST /a/v1/process-instances | 🟡 | **诚实挂账不接**：…前置是**步骤模板层**，⛔ 未派 |`
  后：
  `| B4 | 剩余 POST /a/v1/process-instances | ~~🟡~~ ✅（2026-08-19 同行订正 · WO-TRACE-LEDGER-WRITEBACK） | **本行原判「前置是步骤模板层，⛔ 未派」已过期**：…正是 B4a 行记过的形态「新增一行不等于旧行作废」，两行须对齐到同一真相，本次同批订正 |`

  ⚠ 订正后行内**刻意保留 ⛔ 字形**（在「原判」引文里）：`scripts/dispatch-deficit.sh` 的判据级金丝雀
  需要从表内取到一行 `^| .*⛔` 样例，全删字形会让机制门 RC=2 误报「工具坏了」（实测三样例齐全，见 §6）。
- **同批订正的另两处同事实旧注**（同一真相「步骤模板层未派」的其余两处现存声称，不订正则文件仍自相矛盾）：
  ① 清单乙 #1 的旧注「改由 B4a 接棒：`advance`/实例详情仍无前端消费方，卡在导航信息架构」——
  B4a/B5 两行 2026-08-17 已实测收口（`ProcessInstanceDetailView` 挂路由 `process-instances/:instanceId`），
  该注随清单乙删除、在合并后 #1 内注明过期；
  ② B5 行尾注「创建链仍挂账在 B4（步骤模板层未派，届时创建成功页加一行深链跳转即闭合）」——
  「未派」半句过期已订正；**「深链跳转」半句实测未落**（`ProcessStartFromTemplate.tsx` 成功块
  零 `to=`/`href`，仅展示实例 id 与步骤，`:333`），已在注内如实标明、移交派单方裁决是否补跳转。

## 2 · 13 类需求卡片（C10）⇒ 划线 ✅

**验证证据**：

- C10 行已 ✅（表内），载「13 类全部上屏 · 权威清单 = `MODULE_KINDS`」。
- `packages/contracts/src/databuilder.ts:279` `MODULE_KINDS` 实数 **13 项**
  （dataset · kb_doc · ontology_type · rule · slice · solver · intent · plan · workflow · skill · agent · scene · mcp）。
- 双 seam 钉死：`apps/frontend-shell/test/dbui-13-needs.seam.test.tsx`（存在，引用 MODULE_KINDS 5 处）
  + `apps/datacore/test/databuilder-needs.seam.test.ts`（存在，引用 11 处）。
- 回写：保留清单甲既有 ✅ 回写全文（含「队列与代码脱节了一轮」的记账）。

## 3 · STALE-8 正则盲区 ⇒ 划线 ✅（残留拆显式子项，不划线）

**验证证据**：

- `scripts/check-stale-claims.mjs` 含 STALE-9/10 自诉层：
  `:625` 节注「门自述层（STALE-9/10 · WO-STALE-REGEX-BLIND）」、`:788`/`:796` code "STALE-9"、
  `:807` code "STALE-10"、`:645`/`:655` 判据说明、`:1249`/`:1255` 自测期望。
- 回写：保留清单甲既有 ✅ 回写全文；其尾部「遗留另立单」段按派单要求**拆成显式子项**——
  `- ⛔ 残留子项（未闭·不划线）`：`VIEW_TITLE_SLOTS` 紧邻要求放宽后暴露的 3 条真分叉
  （`aop-base` 亿/万 · `oee-trend` 14 日/7日 · `aop` 年度规划（旧）/年度规划），修它须动 `apps/**`、
  超出原单边界，**仍待另立单**。该子项无删除线，`dispatch-deficit.sh` 现算会把它数进待派（正确）。

## 4 · sandboxConsoleModel:709 worstMbal ⇒ 划线 ✅

**验证证据（否定结论带金丝雀，一律 /usr/bin/grep）**：

- `/usr/bin/grep -rn "worstMbal" --include="*.ts" --include="*.tsx" apps packages` 命中全部在注释：
  `sandboxConsoleModel.ts:713`/`:715`（**该文件内仅此 2 处**，行首均为 ` *`，
  位于「⚠ 2026-08-15 重测订正本行」块内，原文写明「符号已不存在…已被 WO-DYNAMIC-DRILL-RESOLVE 整个删除」）；
  另有 `order-dependent-pick.seam.test.ts:277`、`battery-extended.ts:423`/`:1028`/`:1050`，同为历史注释。
- **金丝雀**：同法 grep `resolveDynamicDrill` 命中真代码
  （`apps/datacore/src/solvers/dynamic-drill.ts:71` 导出 + `service.ts:42`/`:2762`/`:3966` 调用）⇒ 工具没瞎。
- 回写：保留清单甲既有 ✅ 回写全文（含行号 :709→713/715 已漂的记账）。

## 5 · agentcore 3 处 stale 文案 ⇒ 划线 ✅

**验证证据**：机制门 `apps/agentcore/test/keyprops-ontology-parity.seam.test.ts` **存在**（23587 B）。
回写：保留清单甲既有 ✅ 回写全文（实测 40 处 · 四种错法 · 机制门四节）。

## 6 · mock 与真后端 S&OP 量级差 4–12 倍 ⇒ 未触碰

**未触碰证明**：`git show 914d0289b:docs/REQUIREMENTS-TRACE.md` 的该行与改后逐字节 diff 为空
（`ITEM6-BYTE-IDENTICAL`）。仍阻塞等仓主裁，一行未动。

## 7 · 机制兼容性实测（dispatch-deficit.sh）

改后跑该脚本同款判据（章节内 · 列表项 · 无 `~~`）：命中恰 **2 条** =
残留子项（`VIEW_TITLE_SLOTS` 分叉）+ #6（S&OP 量级差），与事实一致；
判据级金丝雀三样例（图例行 / 章节标题 / 表内 ⛔ 行）与已划线项样例**齐全**（各 ≥1），门不会因本次回写误报 RC=2。

## 8 · 收尾核验

- `git diff --stat`：仅 `docs/REQUIREMENTS-TRACE.md`（+7/−10），另加本 HANDOFF 新文件；零代码。
- `git status --porcelain` 提交后为空。
