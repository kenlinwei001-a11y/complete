# 评审核发 — A6 两尾巴收口（dev 提交 `afb0313` · 证据 `docs/evidence/A6-tails-fde.md`）

> **角色**（铁律0.5）：审核方独立复验，非开发。判据 = 蒙眼对抗式（读 diff/跑测试/真 socket 复跑，不信文档）。
> **核发**：**尾巴① 闭合 ✅；尾巴② 功能闭合 ✅（审核方真 socket 独立复跑值逐位吻合）但「真 socket」未固化为自动回归 ◐**——建议补一个真 listen e2e 或在文档明示「手测复现」。

---

## 尾巴① 电池收编·字节不变 — ✅ 闭合（按构造证明，非仅信测试）

**对码核（git diff afb0313 · battery.ts）**：
```
- util: round(0.62 + rng() * 0.35, 2)      →  + util: uniformDomain(rng, 0.62, 0.35, 2, "util")
- gwh:  round(6 + rng() * 36, 1)           →  + gwh:  uniformDomain(rng, 6, 36, 1, "gwh")
uniformDomain → sampleValueDomain({shape:"uniform", band:[lo, lo+range], precision})
uniform 分支（value-domains.ts:82-85）：v = lo + rng()*(hi-lo); return round(v, precision)
```
代入 `hi=lo+range` → `round(lo + rng()*range, p)` = **原内联式逐位一致**·**单次 rng 抽样**（PRNG 序列不移位）。
**关键正确性**：电池路显式传 `shape:"uniform"`，**覆盖**值域库 `util:{shape:"normal"}` 默认 → 电池仍走 uniform、字节不变；normal 仅作用于通用路（a6-reference）。dev 此处处理严谨。
**测试 oracle（审核方独立跑·非信文档）**：`vitest run scale-baseline + synthetic + synthetic-field-alignment + a6-value-domains` → **20/20 passed**（含 SY1「seed42 rerun deep-equal」、E12「XL 同 seed 字节级复现」）。
**结论**：字节不变**按代数构造成立** + R6 标尺绿 → 电池路与通用路现共享单一值生成入口、零字节漂移。诚实边界（dev 自承）：乘性 `unitPrice`=base×factor 因浮点次序保留内联，未强收——合理。

## 尾巴② 全服务 e2e 真 HTTP socket — ✅ 功能复现 / ◐ 未固化为自动回归

**审核方真 socket 独立复跑**（临时 datacore :4011·`SEED_A6_DEMO=1`·真 curl，非 app.inject）：
| 判据 | 结果 |
|---|---|
| POST `/a/v1/synthetic/jobs`(a6-reference·seed42) | **HTTP 202** ✓ |
| Order.util 落业务区间[0.62,0.95] | **10/12 ≥8** ✓ |
| autoPlant 越线(>0.95) | **2 ≥2** ✓ |
| util 值 | `0.7,0.73,0.75,0.77,0.79,0.81,0.84,0.84,0.9025,0.9025,0.9975,0.9975`——**与 dev 文档报告值逐位吻合** |
| R6 同 seed 重跑 run1==run2 | **逐位一致** ✓ |

**✅**：a6-reference 模板（valueDomain `util:normal` + autoPlant 从 BLOCK 规则 `util>0.95` 反推）经**真 HTTP socket**真跑——值落区间、越线植入、R6 全过，**审核方亲手复现非信文档**。

**◐ 诚实缺口（核发附带）**：A6 提交**未新增任何测试文件**（改动仅 seed/config/server/battery×2/docs）。
- 文档头「全服务 e2e ✅ — 真 HTTP socket（**非 vitest app.inject**）」中的「真 socket」是 **dev 手跑 curl + 审核方本次手跑复现**，**非提交物里的自动化测试**；
- 唯一自动化的 `test/a6-value-domains.test.ts` **用 `app.inject`**（进程内注入，正是文档说「非」的那个）——它验了逻辑（已绿），但**不覆盖真 TCP socket 路径**；
- 即：真 socket 路径**无自动回归**，未来若 HTTP 栈（路由/序列化/中间件）回归，CI 不会抓到。
- 缓解：`SEED_A6_DEMO` 已提交 → 手测**可复现**（审核方本次即复现）；风险低（合成端点逻辑已被 app.inject 测覆盖），但「✅ 全服务 e2e」措辞略超 committed 实况。

**建议（非阻断）**：① 补一个 `test/a6-e2e-socket.test.ts` 用 `app.listen(0)` 真起 socket + `fetch` 打 a6-reference（仿 `opt-real-sidecar.integration.test.ts` 的真 socket 范式），把尾巴②固化为回归；或 ② 文档把「真 HTTP socket」明确标注为「手测复现（seed 已提交可复跑）」而非「e2e ✅」。

---

## 核发结论

- **尾巴① 电池收编·字节不变 = 闭合 ✅**（diff 证明逐位等价 + R6 标尺 20/20 + 单 rng 不移位）。
- **尾巴② 全服务 e2e = 功能闭合 ✅**（审核方真 socket 复跑值逐位吻合 + R6 一致），**但真 socket 未固化为自动回归（◐）**——补一个真 listen e2e 即完全闭合；当前措辞建议据实标注。
- 本体回写（§2.A SyntheticJob 电池路已收编/全服务 e2e）属实，与改动一致。
