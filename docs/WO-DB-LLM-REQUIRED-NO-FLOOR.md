# WO · 取消 comprehend 无-LLM 地板兜底（只有绑定 LLM 才能建域·不降级造垃圾）· 详细施工单

> 状态：**待派单**（给 dev 的施工规格；作者不实现）。
> 一句话：删掉「无 LLM / LLM 失败 / LLM 没理解 → 静默回落 7 词电池词表地板」这条路——**没绑 comprehend 用途、或 LLM 调用失败、或 LLM 未理解此故事，一律诚实报错不建域**（`LLM_PURPOSE_UNBOUND` / `COMPREHEND_NOT_UNDERSTOOD`），绝不降级产电池味垃圾数据。
> 依据：真跑实测（2026-07-11）——冷链故事无 LLM 被硬套成 `Order/Process/Base`(温区/货位丢失)、绑 Kimi 后正确建出温区/货位/分拣；地板路 = KILL-MOCK-RED 要杀的"静默造错语义数据"。用户钉：**宁可诚实报错不给建，不能降级造垃圾。**
> 所有锚点已核对真实存在（origin `8f8f161`）。

---

## §0 本体引用与影响（铁律 0 · 门 `prd:check` 机器解析）
- **对象类型**（§2）：`BuildPlan`/`StoryBuildRun`（§2.B·`databuilder/service.ts`）· `LlmProviderRecord`/`PurposeBinding`（§2·`llmproviders.ts`）。
- **链路**（§3）：数据构建发动机链 `故事→comprehend→BuildPlan`——本 WO 在 comprehend 处加**硬门**（无 LLM 绑定即断，不降级）。
- **不变量**（§5）：**KILL-MOCK-RED（核心·无真理解不造伪语义）** · R7 错误信封（`LLM_PURPOSE_UNBOUND` 已有·`llmproviders.ts:375`） · R6（确定性：测试路仍可确定性·见 §3.3） · R13（诚实·不静默降级）。
- **断点**（§8）：拟登 **G-COMPREHEND-FLOOR**（无-LLM 地板静默造错域·本 WO 闭）。
- **回写**：落地后登 §8 G-COMPREHEND-FLOOR 标闭；§7 若加"禁地板"门则登记；`pnpm ontology:slices`。

---

## §1 背景（真跑证据）
`comprehendPlanBody`（`service.ts:87`）当前逻辑：
```
if (this.llm) {
  try { core = await llm.parseStructured({purpose:"comprehend", ...})
        if (core.objectTypes.length > 0) return assemblePlanBody(core,...) }  // :96
  catch { /* 无绑定/无 key/解析失败 → 落地板 */ }                             // :97-99  ← 静默吞错
}
return comprehendScript(script, seed)                                          // :101   ← 7 词电池词表地板
```
**三条静默降级路**（都产垃圾）：① `this.llm` 不存在 ② LLM 调用抛错（含 `LLM_PURPOSE_UNBOUND` 被 catch 吞掉）③ LLM 返回 0 对象。
**实测危害**：冷链故事 → 地板匹配到"订单/工序/基地" → 建成电池味 `Order/Process/Base`、温区货位静默丢失、`gapReport.findings=[]`（不报"我没懂")、closure 判绿。用户拿到一套**语义错误但看着完整**的域。

---

## §2 范围与非范围
**In scope**：
1. 删 comprehend 生产态地板降级；无 LLM 绑定/调用失败/未理解 → 抛结构化错误（不建域）。
2. `POST /a/v1/databuilder/runs`（及 workflow-runs）前置校验：comprehend 用途已绑定才受理；未绑 → 400 `LLM_PURPOSE_UNBOUND` + 中文引导（不进管线）。
3. 保住确定性测试：`comprehendScript` 降为**测试/离线专用、显式开关、且诚实标注**（§3.3）——绝非自动生产兜底。

**Out of scope**：
- ❌ 改 LLM 理解质量（那是 comprehend prompt 的事）。
- ❌ 处理"LLM 已绑但低覆盖度"（→ 理解确认门 UX·五幕向导幕2·另单）——本 WO 只治"无 LLM/失败/0 理解"的硬降级。
- ❌ 删 `comprehendScript` 函数本体（保留作测试确定性 stub + datadep 单测直用）。

---

## §3 详细设计

### 3.1 comprehend 硬门（`service.ts:87` comprehendPlanBody 重写）
```
private async comprehendPlanBody(ctx, script, seed, entryIntent?) {
  // 测试/离线显式开关（默认 false·仅 CI/无网络单测置 true·且产物标注 UNDERSTOOD_BY=FLOOR）
  if (this.config.DC_COMPREHEND_DETERMINISTIC === true) return comprehendScript(script, seed);

  if (!this.llm) throw new AppError("LLM_PURPOSE_UNBOUND", "建域需绑定 comprehend 用途的 LLM，请在 设置→LLM 用途绑定 配置", 400);
  const context = await this.buildComprehendContext(ctx, entryIntent);
  let core;
  try {
    core = await this.llm.parseStructured({ model:this.defaultModel, maxTokens:8000, tenantId:ctx.tenantId, purpose:"comprehend",
      system: comprehendSystemWithSolvers(SOLVER_KEYS, context), messages:[{role:"user",content:script}], schema: LlmComprehendSchema });
  } catch (err) {
    // LLM_PURPOSE_UNBOUND / 鉴权失败 / 超时 → 原样抛（不吞·不降级）。含 1 次重试见 §3.2。
    throw err;
  }
  if (!core.objectTypes || core.objectTypes.length === 0) {
    throw new AppError("COMPREHEND_NOT_UNDERSTOOD", "LLM 未能从此故事理解出任何对象——请把业务描述写具体（涉及哪些实体/流程/指标），或补充数据后重试", 422);
  }
  return assemblePlanBody(core, script, seed, SOLVER_KEYS);
}
```
- **关键**：`catch` 不再吞错回落；`0 对象` 从"落地板"改为"诚实 422"。**三条降级路全断。**

### 3.2 瞬时失败重试（韧性·不降级）
LLM 超时/限流 → 有界退避重试 1–2 次；仍失败 → 抛 `LLM_UNAVAILABLE`（502·R7），前端"LLM 暂时不可用·重试"，**不产地板域**。

### 3.3 保住测试确定性（不破 4 包全绿）
现依赖 `comprehendScript` 的 3 个测试（`databuilder.test.ts` / `datadep-comprehend-fill.test.ts` / `domain-invariants-e14.test.ts`）：
- **首选**：迁移为**注入 `ScriptedLlmClient`（mock LLM 返回 canned 结构化输出）** → 测的是真 LLM 路、确定性、不碰地板。
- **过渡**：置 `DC_COMPREHEND_DETERMINISTIC=1` 走 comprehendScript——但**产物 BuildPlan 打标 `comprehendedBy:"FLOOR"`**（契约 additive），前端/结算单诚实显"⚠ 确定性地板理解·非 LLM·可能不完整"（连测试都不许假装是真理解）。
- `datadep-comprehend-fill` 若是**直测 `deriveDataDependency` 纯函数**（非经建域路）→ 不受影响，保留。

### 3.4 入口前置校验（`app.ts` POST /databuilder/runs）
受理前查 `bindings` 含 `comprehend`；未绑 → 直接 400 `LLM_PURPOSE_UNBOUND`（不进七阶段管线，省得跑一半才断）。demo/CI 在 seed 时绑 comprehend（`KIMI_API_KEY` 已能自动配 provider·补一步自动绑 comprehend 用途）。

---

## §4 诚实边界与代价（用户须知的取舍·钉死）
本 WO 让系统**硬依赖一个已绑定、有预算、在线的 LLM 才能建域**。取舍（用户已择"诚实">"可用"）：
- ✅ **收益**：不再产语义错误的垃圾域；每次建域要么真被 LLM 理解、要么诚实拒绝。
- ⚠️ **代价（须配套）**：① CI/demo 必须绑 LLM 或注入 mock（否则建域相关测试/演示全 400）——§3.3/§3.4 已处理；② 离线/信创无网环境不能建域（只能用 `DC_COMPREHEND_DETERMINISTIC` + 诚实标注地板）；③ LLM 预算耗尽 → 建域暂停（诚实 502·非降级）。
- → **这三条是这个决定的必然结果,不是 bug**;WO 把它们做成诚实态（报错+引导），非静默。

---

## §5 触点清单
| 文件 | 改动 |
|---|---|
| `apps/datacore/src/databuilder/service.ts:87-101` | comprehendPlanBody 硬门（删地板降级·catch 不吞·0 对象 422） |
| `apps/datacore/src/config.ts` | +`DC_COMPREHEND_DETERMINISTIC`(默认 false·测试/离线用) |
| `apps/datacore/src/app.ts`（runs 入口） | 前置校验 comprehend 绑定 → 未绑 400 |
| `packages/contracts/src/databuilder.ts` | `BuildPlan +comprehendedBy?:"LLM"|"FLOOR"`(additive·诚实标注) |
| `apps/datacore/src/mocks/*`（seed） | KIMI_API_KEY 时自动**绑 comprehend 用途**(现只建 provider·漏绑) |
| 3 个测试文件 | 迁 ScriptedLlmClient 或置 flag+断言 FLOOR 标注 |
| `docs/SYSTEM-ONTOLOGY.md` §8 | 登 G-COMPREHEND-FLOOR 闭 |

---

## §6 验收（真跑·含 green→red）
1. **未绑 LLM 硬拒**：不绑 comprehend → `POST /databuilder/runs` 返 400 `LLM_PURPOSE_UNBOUND`，**不产任何 BuildPlan**（现状：产电池味地板域·此为要治的红）。
2. **绑 LLM 真建**：绑 Kimi → 冷链故事建出温区/货位/分拣（实测基线·逐值）。
3. **LLM 未理解诚实**：喂一句无实体的空话 → 422 `COMPREHEND_NOT_UNDERSTOOD`，不建。
4. **瞬时失败不降级**：mock LLM 抛超时 → 502 重试后仍报错，**不产地板域**。
5. **green→red 自证**：把地板降级代码临时改回 → 一个非电池故事应产电池味域 → 该门/测试红。
6. **测试保绿**：3 个迁移后测试绿；置 `DC_COMPREHEND_DETERMINISTIC=1` 时产物标 `comprehendedBy:FLOOR`。
7. **gates 全绿**（含 no-fake-done / prd:check）。

## §7 失败判据
- F1 改后仍有一条静默回落地板的路径（catch 吞错/0 对象 fall through）→ 未达标·返工。
- F2 CI 因无 LLM 全红且未提供 mock/flag 路 → 补 §3.3。
- F3 地板路产物未诚实标注 FLOOR → 违诚实红线。
- F4 门红 → 不进下一期。

## 附录 · 证据锚点
`service.ts:87`(comprehendPlanBody)·`:96`(0对象fall through)·`:97-99`(catch 吞错落地板)·`:101`(return comprehendScript)·`comprehend.ts` ENTITIES(7词电池词表)·`llmproviders.ts:375`(LLM_PURPOSE_UNBOUND 已有)·真跑实测：无LLM冷链→Order/Process/Base；绑Kimi→ColdZone/StorageSlot/SortingTask·规则 leadTimeHours>4·链路真连。母体 §5 KILL-MOCK-RED/R6/R7/R13 · §8 G-COMPREHEND-FLOOR(拟立)。
