# WO-SOLVER-REGISTRY-CONSOLIDATE · 求解器注册表收口（**订正版**·回归夹具）

> ⚠ 这是夹具，不是真派单。它和 `wo-wrong.md` 讲同一件事、同样五条前提，
> 只是每一条都改成了实测真值。premise-check 在这一份上必须**一条差异都不报** ——
> 「错的时候能抓」不度量「对的时候不吵」，噪声大的工具没人会跑第二次。

## 一、背景

今天求解器一共 **63** 个（`ALL_SOLVER_CATALOG`），注册表散在两处，agent 选型时要翻两遍。

`apps/datacore/src/solvers/args-schemas.ts` 是一层薄 re-export，真表在
`packages/contracts/src/solver-args.ts`，参数模式已有 **11** 条 —— 本单不是「建起来」
而是「把 datacore 侧剩下的消费方切过去」。

规则库里规则 **30** 条，其中相当一部分只在注释里被提到过。

`lineGranularity` 有 **6** 处 src 引用方（`portfolio.ts` 内 5 处读 + `service.ts` 1 处写），
不是死代码，本单不许删。

求解器的 description p90 **301** 字、max **714** 字，全量塞进 agent 的系统提示喂不起，
必须先做摘要层。

## 二、坐标

组合排产的 args 组装点在 `apps/datacore/src/solvers/service.ts:3512`。

## 三、范围边界

✅ `apps/datacore/src/catalog.ts` · `apps/datacore/src/solvers/args-schemas.ts`
⛔ 不碰前端
