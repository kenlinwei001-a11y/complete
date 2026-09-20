# WO-SOLVER-REGISTRY-CONSOLIDATE · 求解器注册表收口（**写错版**·回归夹具）

> ⚠ 这是夹具，不是真派单。五条前提**全部照抄 2026-09-12 那天被 dev 实测推翻的原话**，
> 一条都没自己编。premise-check 必须把这五条全点出来。

## 一、背景

今天求解器一共 **60** 个，注册表散在两处，agent 选型时要翻两遍。

`apps/datacore/src/solvers/args-schemas.ts` 是空的，只留了个壳 —— 求解器的 args zod
schema 还没有单一来源，本单要把它建起来。

规则库里规则 **39** 条，其中相当一部分只在注释里被提到过。

`lineGranularity` 零调用方，属于死代码，本单顺手删掉。

求解器的 description 是一句话，全量塞进 agent 的系统提示没有压力，直接拼串即可。

## 二、坐标

组合排产的 args 组装点在 `apps/datacore/src/solvers/service.ts:3512`。

## 三、范围边界

✅ `apps/datacore/src/catalog.ts` · `apps/datacore/src/solvers/args-schemas.ts`
⛔ 不碰前端
