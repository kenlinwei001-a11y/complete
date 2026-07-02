# REVIEW · SOLVER-BINDING-UI → ✅ DONE（G-17 命门前端·绑定可见+激活闭环真跑）

> 审核方真 curl + 真浏览器（chromium + 真 datacore4001/vite5200·非 mock）逐条闭合。判决 **DONE**：SolverBinding 绑定层前端可见 + DRAFT→激活→ACTIVE 闭环**真浏览器全程可达 + 前后端一致**（补 DONE 的 SOLVER-BINDING 后端"全 curl 无 browser"前端缺口）。

## 判决：✅ DONE（C1-C6 真验闭合）

| # | 断言 | 类型 | 证据 | 判 |
|---|---|---|---|---|
| C1 | SolversPage 行展开显 roleBindings(role→typeKey/fieldMap)+DRAFT/ACTIVE 徽章·非仅 argHints | browser | 展开 `solver-row-capacity_forecast`→`solver-binding-<id>` 渲染·role 行"base Base util→util"(role→typeKey→fieldMap)·状态徽章 **DRAFT**·激活按钮在 | ✅ |
| C2 | DRAFT→点激活→ACTIVE（前端全程可达） | browser | 点 `solver-binding-activate-<id>`→状态徽章 **DRAFT→ACTIVE**·activate POST **200** | ✅ |
| C3 | 前端激活真落库（非 UI 装饰） | curl | 前端点激活后 `GET /a/v1/solvers/capacity_forecast/bindings`→该 binding **status==ACTIVE**（真调 activate 端点落库） | ✅ |
| C4 | 激活后 invoke 求解器→真答案（非未绑定拒答） | curl | 绑定 ACTIVE 后 `invoke capacity_forecast{modelId:4680-NCM}`→**真答案 gap=35.1793/p50=5.1836/p90=4.8207**·SYNTHETIC（求解器认得 Base 出答案·非拒答） | ✅ |
| C5 | endpoints 补 solver-binding 端点·类型自 contracts | gate | `endpoints.ts` 加 `fetchSolverBindings`/`activateSolverBinding`/`suggestSolverBindings`·`SolverBinding` import 自 `@platform/contracts`(未重定义) | ✅ |
| C6 | 四包全绿 + 牙齿 | gate | `solver-binding-ui.test.tsx` **4/4**(绑定可见 role/typeKey/fieldMap + DRAFT→activate→ACTIVE + 空态 + suggest)·build 退0 | ✅ |

## 命门闭合（G-17·前端物理走不通 → 走通）
此前 SOLVER-BINDING 后端 CRUD+自动草案+activate 端点齐备，但前端 `solver-binding` 零命中·SolversPage 只显 argHints 文本·激活那步 UI 永远走不到。本单补：`SolversPage` 行展开 `SolverBindingPanel`（绑定层可见 role→typeKey/fieldMap + DRAFT/ACTIVE 徽章 + 激活按钮 + suggest + 空态）+ `endpoints.ts` 三端点（类型自契约）。**"上传自有类型→求解器认得→真答案"链前端物理走通**（真浏览器点激活→ACTIVE→求解器出真答案·前后端逐值一致）。

## 诚实边界
- 审核方用 **curl 手播一个 DRAFT 绑定**（grounded base→Base·util→util）驱动前端激活闭环——**publish→自动 DRAFT 草案**触发本身是 SOLVER-BINDING 后端（已 DONE·curl 验），前端消费 `GET bindings` 显任何 DRAFT（不论来源）·故 C2 全链由组合成立；suggest 端点在 demo 全已绑定态返 0（无未绑定类型可建议·非缺陷）。真 realco 上传自有类型全链在 fresh 租户可再拍。

## 本体引用与影响
- 链路：`建模发布→自动 DRAFT 绑定草案(RL4)→SolversPage 可见+激活→ACTIVE→resolveSolverType 认得→求解器真答案`。
- 不变量：R2(租户隔离)·RL4(DRAFT 须人工 activate 才生效·resolveSolverType 只认 ACTIVE)·R1(类型自契约不重定义)·DF.8(绑定接地校验)。断点：G-17(绑定层前端缺口·本单闭)·G-VIS-1。
