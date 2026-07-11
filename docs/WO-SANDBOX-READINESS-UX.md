# WO · 推演沙盘就绪认证 UX 重排(体检报告进抽屉·提问回主角)

> **这是什么**:沙盘主屏当前把"就绪认证 L0-L4 + 三维准备度 + 健康6维 + 信任4维 + 世界完整度"五套体检指标前置在主屏,挤占了这页真正的主角——**提问(what-if)→ 利好/利空**。本单把体检指标**收进抽屉、压成一行信任条**,把提问升为主角,并把 `世界完整度` 改成业务人看得懂的词。
> **一句话**:**信号不砍(底层投影全留),只改"给谁看、放哪、放多少"**——决策者主屏只留"能不能信 + 差什么 + 一键去补",完整体检(L0-L4/三张雷达)收进 `[查看完整体检]` 抽屉给建模者。
> **纪律红线**:**只改呈现层(`SandboxView.tsx`)**。后端 `deriveCertification`、契约 `SimCertification`、投影口径**一律不动**(守 spec RL3 单源:就绪全 DERIVE 自既有 closure,不新写校验)。本单是"搬 UI",不是"改判据"。
> **状态**:待派单。锚点已核对(`complete` 分支 · `SandboxView.tsx`/契约 `sim.ts` · `2026-07`)。

---

## §0 本体引用与影响(铁律 0)
- **对象类型**(母体 §2.I 推演沙盘域):`SimCertification`(契约 `sim.ts:110-143`,level/dims/l4Checks/trialTick/worldCompleteness/canEnterSimulation/gaps)——**只读不改**。
- **链路**(母体 §3):无新增。纯前端呈现重排。
- **不变量**(母体 §5):**R14** 配置驱动·零业务常数(阈值/权重仍走 config)· **R6** 不动确定性投影 · **R13** 溯源文案保留(每维 `src` 悬浮溯源不删)· **RL3 单源**(sandbox 本地铁律:就绪全 DERIVE 自 closure·本单不碰投影)· **R17**(一页看全:体检**折叠**进抽屉仍在本页·非移除,守"一页看全"但重定优先级)。
- **断点**(母体 §8):**G-8**(呈现层不影响数据接入)。沙盘域设计见 `SPEC-sandbox-readiness-certification.md`。
- **回写**:UX 布局定案后回写 `SPEC-sandbox-readiness-certification.md §222`(把"主屏三雷达并列"改为"主屏一行信任条 + 抽屉全展开")。

---

## §1 主屏三区新布局(决策者视角)

沙盘主屏从上到下只留三区(体检退居抽屉):

```
① 提问区(主角)        「本次推演问题」+ what-if 输入 + [开始推演]     ← 已有(AI指挥台/whatIf)升位
② 信任条(一行)        ✅可推演 · 备料85%(缺2条规则) · 🔒时序/数据信任未接入   [查看完整体检▸]
③ 结果区              利好/利空 · KPI · 溯源 · 动作(原推演结果)
```

`[查看完整体检▸]` 抽屉里才展开:L0-L4 阶梯 · 三维准备度雷达 · 健康6维雷达 · 信任4维雷达 · 世界完整度四类计数 · entering/gaps 清单。**给愿意深挖的建模者,不占决策者主屏。**

---

## §2 改造清单(五项·全在 `SandboxView.tsx`)

| 项 | 现状(锚点) | 改成 |
|---|---|---|
| **UX-1 提问升主角** | what-if 输入现为 AI 指挥台条(`:733`)+ whatIf preset 注入(`:699-701`),位置靠下 | 提到主屏**顶部第一区**,做成显眼提问框 + [开始推演] |
| **UX-2 信任压一行** | `canEnterSimulation`/`l4Checks`/`worldCompleteness` 现散在多块 | 合成**一行信任条**:`可推演/暂不可推演` + `备料 N%` + RESERVED 项标"未接入" + `[查看完整体检▸]` |
| **UX-3 三雷达移抽屉** | 自绘 `sandbox-radar`(`:248`)+ `deriveHealthDims`(`:292`)+ `deriveTrustDims`(`:310`)现渲在主屏 | **函数全保留**(诚实投影不删),渲染位置移入 `[查看完整体检]` 折叠抽屉 |
| **UX-4 L0-L4 收成门** | L0-L4 stepper 主屏展开 | 主屏只显 `level` 一句(可推演/差一步:X);完整阶梯进抽屉 |
| **UX-5 世界完整度改名** | 显示文案"世界完整度"(`worldCompleteness.pct`) | **仅改显示文案**→「本次推演备料完整度」;契约字段名 `worldCompleteness` **不改**(避免全链 rename) |

---

## §3 逐项锚点 + 改法

### UX-2 信任条(核心·一行取代多块)
读现有 `SimCertification`,拼一行(全部字段已在,零新取数):
- `可推演` ← `cert.canEnterSimulation`(true=✅可推演 / false=⚠暂不可推演)。
- `备料 N%` ← `cert.worldCompleteness.pct`(<100% 才追加"缺 X":X = `gaps` 里 DERIVATION/PROPAGATION 类计数)。
- `未接入` ← `deriveTrustDims` 里 `hasData=false` 的维(时序/数据信任 RESERVED)→ 显"🔒 时序/数据信任未接入",**不显假分数**(守诚实红线)。
- `暂不可推演` 时,信任条给一键 CTA:`[去补:发布本体 / 补派生规则]`(跳 DataBuilder/本体页)。

### UX-3 三雷达移抽屉(保留函数·只移位置)
- `deriveHealthDims`(`:292`,6 维:规则覆盖/利用率/闭包/周期安全/可观测/激活)· `deriveTrustDims`(`:310`,4 维,2 维 RESERVED)· 三维准备度 `cert.dims` — **三个都留着**(它们是诚实投影,`src` 溯源文案是价值),只把 JSX 渲染块从主屏挪进 `<details>`/抽屉。
- **别在抽屉里也堆三张全尺寸雷达**:抽屉里健康6维 + 信任4维可折叠成两个小雷达 + "查看溯源"悬浮;三维准备度是最有决策含义的,可留抽屉顶部。

### UX-5 改名(仅文案)
- 前端所有"世界完整度"显示文案 → 「本次推演备料完整度」;`entering[]` 清单标题 → 「本次推演将用到的料」。
- **契约 `sim.ts` 的 `worldCompleteness` 字段名保持不变**(它是数据契约,rename 会波及后端/CLI/测试)。改的是 label,不是 key。

---

## §4 RL3 / 契约边界(必读·别越界)
**只动 `apps/frontend-shell/src/views/sim/SandboxView.tsx` 的呈现。以下一律不碰:**
- ❌ `apps/datacore/src/sim/certification.ts`(`deriveCertification` 投影函数)。
- ❌ 契约 `packages/contracts/src/sim.ts`(`SimCertification` 结构/字段名/阈值口径)。
- ❌ 端点 `GET /a/v1/sim/sessions/:id/certification`、`deriveHealthDims/deriveTrustDims` 的**计算逻辑**(只移它们的渲染位置)。
> 越界即违 RL3(重造就绪算法)。本单的价值恰恰是"底层判据一个字不改,只把体检从主屏挪进抽屉"——所以它零风险、可快速回退。

---

## §5 砍 / 留 / 移 决策表(dev 据此分派每维)

| 指标 | 决策 | 理由 |
|---|---|---|
| `canEnterSimulation`(总闸) | **留·升主屏**(信任条) | 决策者唯一真正需要的 1 bit |
| `worldCompleteness.pct` | **留·升主屏**(改名"备料完整度") | "缺多少料"对是否采信推演有直接意义 |
| L0-L4 阶梯 | **移抽屉** | 过程量·建模者关心;主屏用 `level` 一句代 |
| 三维准备度(结构/知识/行为) | **移抽屉**(抽屉顶部) | 有决策含义但非主屏级 |
| 健康6维雷达 | **移抽屉·可折叠** | 与 L0-L4 高度重叠(闭包=同 closure/周期安全=同 Fanout/可观测=同维),spec 自认补竞品(`§128`) |
| 信任4维雷达 | **移抽屉·折叠** | 4 维 2 维永久 RESERVED,主屏摆半空雷达像坏了;抽屉里诚实标 🔒 |
| `entering[]` / `gaps[]` | **移抽屉** | 明细清单·建模者补料时看 |

---

## §6 验收(green→red 自证)
- **主屏**:进沙盘,首屏第一眼是**提问框 + [开始推演]**,信任信息只有一行(`sim-init-wizard.test.tsx` / 相关 tsx 断言主屏不再渲三张全尺寸雷达)。
- **信任条**:`canEnterSimulation=false` 时显"暂不可推演 + 一键去补";`worldCompleteness.pct<100` 显"备料 N%(缺 …)";RESERVED 维显"🔒 未接入"不显数字。
- **抽屉**:点 `[查看完整体检]` 才出现 L0-L4/三雷达/entering/gaps;`data-testid=sandbox-radar` 仍存在(只是在抽屉内)。
- **改名**:全屏无"世界完整度"文案,代之"备料完整度";契约 `worldCompleteness` 字段名未变(后端/CLI 测试全绿)。
- **RL3 红自证**:`git diff` 只含 `SandboxView.tsx`(+可能新增抽屉子组件);`certification.ts`/`sim.ts` **零改动**——若有改动=越界打回。
- **全局**:`pnpm --filter frontend-shell test` 全绿;`debattery:check` 绿(呈现层零业务常数);`node scripts/check-prd-ontology.mjs` 认本单 §0。

## §7 别做清单
- ❌ 删 `deriveHealthDims/deriveTrustDims` 或任何投影维(诚实信号要留,只移位)。
- ❌ 给 RESERVED 维编一个假分数填满雷达(违诚实红线)。
- ❌ rename 契约字段 `worldCompleteness`(只改 UI label)。
- ❌ 改 `deriveCertification` 或阈值口径(违 RL3)。
- ❌ 把体检从本页彻底移除(违 R17 一页看全;是折叠进抽屉,不是删)。

## 附录 · 证据锚点
`SandboxView.tsx:224-270`(自绘就绪雷达 `sandbox-radar`)/`:292`(deriveHealthDims 6维)/`:310`(deriveTrustDims 4维)/`:399`(准备度块)/`:699-701`(whatIf 注入)/`:733`(AI 指挥台提问条)· 契约 `sim.ts:110-143`(SimCertification)· 后端 `sim/certification.ts`(deriveCertification·不动)· `SPEC-sandbox-readiness-certification.md §222`(现主屏布局·待回写)/`§128`(健康/信任雷达=补竞品)/`§2.5:148-150`(时序/数据信任 RESERVED)/`§5`(投影函数 RL3 边界)· 母体 §2.I/§5(R14/R6/R13/RL3/R17)/§8(G-8)。
