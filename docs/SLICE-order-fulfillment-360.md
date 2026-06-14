# 跨 6 域本体切片 order_fulfillment_360（产品履约全景）

## 1. 这是什么

一条**跨 6 个数据域**的本体切片：从一张销售订单出发，沿本体链路边一次检索出
该订单完成履约所牵涉的全部对象，跨越 产品 → 工厂 → 工艺 → 设备 → 供给 → 商务 六域。

```
Order(产品) ─order_for_model→ Model(产品) ─model_producible_at→ Base(工厂)
                                            Base ←line_belongs_to_base─ Line(工厂)
                                            Line ─line_has_process→ Process(工艺)
                                            Process ←equip_used_in─ Equipment(设备)
Model ─model_uses_material→ Material(供给)        （型号 BOM 用料）
Order ─order_of_customer→ Customer(商务)          （下单客户信用画像）
```

| 域 | 对象类型 | 在链中的角色 |
|----|----------|--------------|
| product 产品 | Order / Model | 履约起点、产品归属 |
| factory 工厂 | Base / Line | 产能落点、产线 |
| process 工艺 | Process | 工序口径（良率/利用率） |
| equip 设备 | Equipment | OEE 取数叶子 |
| supply 供给 | Material | BOM 用料 / 齐套 |
| commercial 商务 | Customer | 客户信用敞口 |

## 2. 实现要点

- **链路边**（`apps/datacore/src/synthetic/battery.ts` · `batteryLinkTypes()`）：在既有
  3 条边外新增 5 条 —— `line_belongs_to_base` / `line_has_process` / `equip_used_in` /
  `model_uses_material` / `order_of_customer`。
- **边实例生成**（`apps/datacore/src/synthetic/service.ts` · `instantiateBattery()`）：
  全部由对象 FK 确定性派生（Line.baseId / Process.lineId / Equipment.processId、型号 BOM
  错位选 4 料覆盖全 8 料、订单按序轮转绑定客户），同 seed 字节级一致。
- **切片定义**（`batteryBuiltinSlices()`）：合成即落库（`repos.sliceSpecs`），无需外部脚本
  即可 `resolve`；`root.selector.byKey = "{{args.so}}"` 选定根订单 → 展开该订单完整履约树。
- **检索入口**：`POST /a/v1/ontology/slices/order_fulfillment_360/resolve`，body `{ args: { so } }`。
  逐跳应用 A6 行级过滤（不可见节点及其子树被剪枝）。
- **契约 fixture**：内置 1 条（首单 `SO-10001` 全链可达 8 类节点 + 7 类链路），
  `POST /a/v1/ontology/slice-contracts/run` 校验。

## 3. 两场景都经它检索再推演

| 场景 | 求解器 | 切片用法 |
|------|--------|----------|
| ① 交期风险推演 | `affected_orders`(常州) | 命中受影响订单后，逐单经切片检索完整履约链，并集去重得「完整推演节点」 |
| ② 月度规划体检 | `plan_audit` | 体检前对代表订单（每型号交期最早一张）经切片检索跨域输入（供给齐套 / 商务信用 / 工厂产能） |

`scripts/provision-enterprise.mjs` 第 5b 步、`scripts/slice-scenarios-excel.mjs`
均按此「先切片检索 → 再推演」顺序执行。

## 4. 复现 Excel 证据

```bash
pnpm --filter datacore build
node scripts/slice-scenarios-excel.mjs L      # 输出 deliverables/跨域切片-两场景推演节点.xls
```

Excel（SpreadsheetML 2003，Excel 可直接打开）含 5 个工作表：

1. **概览** —— 切片链路、6 域、数据规模、两场景求解结论。
2. **场景①推演·节点明细** —— 受影响订单履约链全部节点（按域分组），每节点列：
   数据域 / 类型 / 中文名 / 主键 / 履约链角色 / 关键属性 / 来源系统绑定（输入源）/ 覆盖订单数。
3. **场景①·链路血缘** —— 节点间上下游边（linkKey + 跨域语义 + 上下游域）。
4. **场景②体检·节点明细** —— 代表订单跨域输入节点（同列结构）。
5. **场景②·链路血缘**。

> 本次导出 scale=L（200 单）；生产档 XL=10⁴ 单，履约链**结构与 scale 无关**，
> 仅订单/物料批次数量放大。

## 5. 回归锁

`apps/datacore/test/slice-order-fulfillment.test.ts`（4 用例）：
- SL1 合成即落库、首单全链可达 6 域 8 类节点 + 7 类链路；
- SL2 同 seed 重跑节点/边集合字节级一致；
- SL3 A6 行级过滤（base_manager:常州 只见常州可达子树）；
- SL4 切片契约 `slice-contracts/run` 全绿。
