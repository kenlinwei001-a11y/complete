# PRD 增量 · 本体服务原子规格（元模型 DDL / 派生公式 DSL / resolveSlice 切片语法）

| 项 | 值 |
|---|---|
| 版本 | v1.0（补全 平台 PRD §A4 与 QOS-PRD M2 的三处地基缺口；基线文档 Part B 追加裁决 #18 指向本文） |
| 解决问题 | 全文档集反复引用但从未原子化定义的三件事：① 本体存储 DDL；② 派生公式的声明语法与重算语义；③ resolveSlice 子图切片的声明语法。不补则开发 agent 必须自行发明平台地基 |

## 1. 本体元模型与实例存储（PostgreSQL DDL）

```sql
-- 元模型（场景包内容，版本化整体发布）
ontology_versions(id PK, tenant_id, version INT, status TEXT/*DRAFT|PUBLISHED*/, published_at,
                  UNIQUE(tenant_id, version));
object_types(id PK, tenant_id, ontology_version INT, type_key TEXT, display_name TEXT,
             definition JSONB, UNIQUE(tenant_id, ontology_version, type_key));
  -- definition: { properties:[{key, dataType:"string"|"number"|"boolean"|"date"|"enum"|"ref",
  --               required, enumValues?, refTo?, temporal?:bool /*变更需留历史*/}],
  --               primaryKey:string, domain:string, sourceBindings:[{connId,dataset,fieldMap}] }
link_types(id PK, tenant_id, ontology_version INT, link_key TEXT, from_type TEXT, to_type TEXT,
           cardinality TEXT/*1:1|1:N|N:N*/, prop_schema JSONB,
           UNIQUE(tenant_id, ontology_version, link_key));
derivation_specs(id PK, tenant_id, ontology_version INT, spec_key TEXT,
                 target_type TEXT, target_prop TEXT, formula TEXT/*§2 DSL*/,
                 deps JSONB/*编译期提取缓存，见 §2.3*/, status TEXT,
                 UNIQUE(tenant_id, ontology_version, spec_key));

-- 实例（活数据，跨本体版本存续；type_key 锚定语义）
objects(id PK, tenant_id, type_key TEXT, object_key TEXT/*业务主键*/, props JSONB,
        origin TEXT/*LIVE|SYNTHETIC*/, epoch BIGINT, updated_at,
        UNIQUE(tenant_id, type_key, object_key));
  -- 索引：(tenant_id, type_key)、GIN(props)、(tenant_id, epoch)
links(id PK, tenant_id, link_key TEXT, from_id FK, to_id FK, props JSONB,
      UNIQUE(tenant_id, link_key, from_id, to_id));
  -- 索引：(tenant_id, link_key, from_id)、(tenant_id, link_key, to_id)  ←反向导航/反向依赖必需
object_prop_history(id BIGSERIAL, object_id FK, prop TEXT, value JSONB,
                    valid_from TIMESTAMPTZ, recorded_at, provenance JSONB);
  -- 仅 temporal=true 的属性在值变更时 append；当前值始终在 objects.props（读路径不碰 history）
  -- 大体量时序不进此表（A8 红线不变：那归 ts_points）
derivation_runs(id PK, spec_id FK, object_id FK, value JSONB,
                inputs JSONB/*[{objectId,prop,value}]*/, epoch BIGINT, ran_at);
```

**快照语义**（全文档集 `snapshotVersion` 的最终定义）：`snapshotVersion = "{ontology_version}.{epoch}"`。`epoch` 为租户级单调序列，**每个写入批次**（连接器同步批/对象化作业/派生运行/Action 写回）+1，批内所有行打同一 epoch。求解器/切片返回当时 epoch；推演复算 = 按 `epoch ≤ N` 读（本期实现为"当前值+派生运行记录"组合回放，行级历史回溯到 temporal 属性为止——完整 MVCC 快照列为 v2，限制写入基线声明）。

**本体版本与实例的关系**：发布新本体版本不迁移实例；新增属性对旧实例为 null；删除/改型属性在发布校验时若有实例数据 → 要求提供迁移声明（`dropData:true` 或重命名映射），否则拒绝发布。

## 2. 派生公式 DSL

### 2.1 文法（EBNF）

```
formula    := expr
expr       := or_expr
or_expr    := and_expr ( "OR" and_expr )*
and_expr   := cmp ( "AND" cmp )*
cmp        := add ( ("=="|"!="|">"|">="|"<"|"<=") add )?
add        := mul ( ("+"|"-") mul )*
mul        := unary ( ("*"|"/") unary )*
unary      := "-"? factor
factor     := NUMBER | STRING | "true" | "false"
            | propref | aggcall | func | "(" expr ")"
propref    := "this" "." IDENT                          // 目标对象自身属性
nav        := ("out"|"in") "(" IDENT ")"                // 沿 link_key 单跳导航（out=from→to）
aggcall    := ("SUM"|"MIN"|"MAX"|"AVG"|"COUNT")
              "(" nav ("." IDENT)? ("," "WHERE" IDENT "==" factor)? ")"
              // 对导航所得对象集聚合其属性；WHERE 为目标对象属性等值过滤
func       := "IF" "(" expr "," expr "," expr ")"
            | "COALESCE" "(" expr ("," expr)+ ")"
            | "CLAMP" "(" expr "," expr "," expr ")"
```

约束：导航**仅单跳**（多跳需求用中间派生属性接力——保持依赖图可分析）；聚合不可嵌套；公式长度 ≤2000 字符。

### 2.2 示例（产能金字塔，与 §S1.1 对应）

```
设备.capacity_h   = IF(this.takt > 0, 3600 / this.takt * this.availFactor * this.oee_current, 0)
工序.capacity     = IF(this.serpar == "并",
                       SUM(in(使用于).capacity_h),
                       MIN(in(使用于).capacity_h)) * this.yield_baseline * this.labor_factor
产线.capacity     = MIN(out(包含工序).capacity, WHERE serpar == "串")
                    + SUM(out(包含工序).capacity, WHERE serpar == "并")   // 简化口径，场景包可改
工厂.capacity     = SUM(in(归属基地).capacity)
```

### 2.3 编译与依赖

发布时解析为 AST → 提取依赖集 `deps = [{ typeKey, prop, via?: linkKey }]`（`this.x` → 自身类型；聚合 → 导航目标类型）→ 缓存进 `derivation_specs.deps`。依赖图节点 = `(typeKey, prop)`，边 = spec 依赖；**Kahn 拓扑排序，发现环 → 发布拒绝 `CYCLIC_DERIVATION`（输出环路径）**。

### 2.4 重算语义

- **触发**：变更集 `[(typeKey, prop, objectIds)]`（来源：对象化作业 / A8 快照写回 / Action 写回）→ 沿依赖图反向闭包确定受影响 spec → 受影响目标对象 = 经 links **反向导航**从变更对象解出（用 to_id 索引）→ 按拓扑序逐 spec 批量重算，仅算受影响对象。
- **求值规则**：任一输入 null → 结果 null（COALESCE 除外）；除零 → null 并记 `derivation_warnings`；数值用 decimal 定点（4 位小数），禁止浮点直算金额/产能。
- **每次写值**同时写 `derivation_runs`（inputs 快照 + epoch）——溯源弹窗"公式+输入"的数据源即此表。

## 3. resolveSlice 切片定义语法

```ts
interface SliceSpec {                       // 表 slices，场景包内容，版本化
  sliceKey: string; version: number;
  root: { typeKey: string; selector: { byKey?: TemplateValue; filter?: Record<string, TemplateValue> } },
  paths: Hop[][];                           // ≤4 条路径，共享同一 root；每条 ≤6 跳
  maxNodes: number;                          // 缺省 500，硬上限 1000；超出截断并置 truncated:true
}
interface Hop {
  linkKey: string; direction: "out" | "in";
  filter?: Record<string, TemplateValue>;    // 目标对象属性等值过滤（值可引用 {{args.x}}）
  limitPerNode?: number;                     // 每父节点展开上限，缺省 50
  project?: string[];                        // 节点属性投影（缺省全量 props）
}
```

**执行语义**：root 选择 → 逐路径逐跳**批量 IN 查询**展开（禁递归 CTE）；**每跳展开后立即过 A6 行级过滤——不可见节点连同其下游子树整体剪枝**（权限不泄露拓扑）；多路径结果按节点 id 合并去重。
**输出**：`{ nodes: [{ id, typeKey, objectKey, props }], edges: [{ linkKey, from, to }], truncated: boolean, snapshotVersion }`。

**示例**（QOS 演示用 `model_capacity_network`）：

```json
{ "sliceKey": "model_capacity_network",
  "root": { "typeKey": "Model", "selector": { "byKey": "{{args.modelId}}" } },
  "paths": [
    [ { "linkKey": "认证", "direction": "out" },
      { "linkKey": "包含产线", "direction": "out" },
      { "linkKey": "包含工序", "direction": "out" },
      { "linkKey": "使用于", "direction": "in", "limitPerNode": 10 } ] ],
  "maxNodes": 300 }
```

## 4. 验收用例

| # | 用例 | 预期 |
|---|---|---|
| O1 | DDL 约束 | (tenant,type,object_key) 唯一冲突 upsert 语义；epoch 批内一致且单调 |
| O2 | DSL 解析与依赖提取 | §2.2 四条公式 AST 正确；deps 与人工标注一致 |
| O3 | 环拒绝 | 构造 A.x→B.y→A.x → 发布拒绝且输出环路径 |
| O4 | 增量重算最小集 | 改 1 台设备 OEE → 仅其所在工序/产线/工厂链被重算（重算对象数断言）；derivation_runs 的 inputs 可回链 |
| O5 | 求值语义 | null 传播、COALESCE 兜底、除零→null+warning、decimal 精度（0.1+0.2==0.3） |
| O6 | temporal 属性 | 标记 temporal 的属性变更落 history，当前值读路径不查 history（查询计划断言） |
| O7 | 本体版本演进 | 删除有数据的属性 → 无迁移声明拒绝发布；新版本下旧实例新属性为 null |
| O8 | slice 执行 | 示例切片返回正确子图；limitPerNode 生效；maxNodes 截断置 truncated |
| O9 | slice 权限剪枝 | base_manager 视角：不可见基地的整条下游子树不出现（节点与边都不泄露） |
| O10 | 参数化 | {{args.modelId}} 注入式取值（含恶意字符串）只作为字面量参数，无注入面（参数化查询断言） |
