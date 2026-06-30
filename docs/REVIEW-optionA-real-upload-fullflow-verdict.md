# 复核 · option A 真跑现有上传全流程——真实 Excel 端到端裁决（钉最深断点 B3）

> 审核方**亲手以用户身份真跑**（非读 dev 声明·非测试绿）：造真实锂电业务 Excel → 真起 datacore → 真走上传→建模→归域→发布→物化→求解器。**这是反代理纪律的第一个真证明**——回答用户多会话追问的"真连接器接入臂能不能用、真实数据能不能出真答案"。证据全程留 `scratchpad/optA-evidence.log`。

## §0 一句话裁决
**真实业务 Excel 能端到端走到"物化成对象"（18 个真对象真落库），但 canonical 求解器拒绝它**——`order_fullchain` 报 `需先合成 Order`。根因：**上传产出的对象类型 key 来自表名（`Orders`/`Bases`），canonical 求解器硬编码认 `Order`/`Base`/`Line`，中间缺"上传类型→求解器 schema"映射/绑定层**。这正是 demo 为何走"合成捷径"：合成路产 canonical 类型→求解器吃；真上传路产表名类型→求解器不认。

## §1 真跑账（每步真响应·非应该能）
| 步 | 动作（真 curl） | 真结果 | 判定 |
|---|---|---|---|
| 1 上传 | `POST /a/v1/uploads` 真 .xlsx ×3 | 3 个 **`file_upload`** 连接(非 mock_erp)+ 3 RawDataset(orders 10/bases 3/material_balance 5)+字段类型推断 | ✅ 真 |
| 2 入库 | `GET /a/v1/raw-datasets` | 行真在 DB·可查·schema+samples | ✅ 真 |
| 3 建模(无LLM) | `POST /a/v1/modeling/derive` | 确定性产草稿(Orders/Bases/MaterialBalance) | ✅ 真 |
| 4 归域 | 注册域 sales/factory/material + `PATCH draft setDomain` | 草稿 DRAFT→REVIEWED | ✅ 真（但需手动） |
| 5 发布 | `POST .../publish` | PUBLISHED | ✅ 真 |
| 6 物化 | `POST .../materialize` | **18 ObjectInstance 真落·0 隔离**(Orders 10/Bases 3/MaterialBalance 5·readiness 100) | ✅ 真 |
| 7 **求解** | `POST /a/v1/solvers/order_fullchain/invoke` | **`VALIDATION_ERROR: order_fullchain 需先合成 Order`** | ❌ **拒** |

## §2 三个真断点（option A 实证·B3 最深）
- **B1**（◐ 已有绕路）：`/modeling/suggest` LLM-gated(`LLM_PURPOSE_UNBOUND`)；`/derive` 确定性无 LLM 已在——前端不自动降级=UX 缺口(对 L5049)。
- **B2**（🔴 摩擦）：fresh 租户上传后 publish 卡——0 注册域 + 必须手动 `setDomain` 逐类型归域才能发布。**"上传≠开箱即用本体"**。
- **B3（🔴 最深·命门）**：**canonical 求解器硬编码认 `Order`/`Base`/`Line`/`Model`(`service.ts:1721 probeTypes`)，上传产表名类型 `Orders`/`Bases` → 求解器拒("需先合成 Order")**。**缺"上传类型→求解器 schema"映射/绑定层**。→ 真实数据物化了也**喂不进求解器=出不了真答案**。

## §3 给"模拟真实业务全流程"的真答案 + 该补什么
- **真答案**：现有路径"真上传→真建模→真物化"**通**；"真物化→真求解器答案"**断在 B3**。所以"真实数据出真答案"**目前做不到**——不是接入臂缺，是**接入臂与求解器之间缺映射层**。
- **该补（WO 方向·待派）**：
  1. **求解器 schema 由本体绑定驱动**（仿 `opt-binding.ts` role→本体类型/字段 + DF.8 接地），而非硬编码 type key——则任意类型名经绑定可喂求解器。**这是真正的解**（行业无关·R14）。
  2. 或 上传建模时加**类型→canonical 映射层**（type-key + field 对账，复用 `reconcileDataset` 确定性对账 `modeling.ts:592`）。
  3. 两者都与 **N1 多源融合**同源（不同源/不同名 → 同一 canonical 对象），是"真实数据能用"的命门。

## 本体引用与影响
- **链路实证**：`上传(file_upload)→RawDataset→/derive 确定性建模→归域→publish→materialize(18对象)→[断]求解器`（本体§3 数据→本体→推演链·真跑钉断点在"本体→求解器"接缝）。
- **不变量**：R6（确定性建模/物化字节稳）·R13（连接 file_upload 非合成·诚实）。
- **断点**：B3 = 本体对象 ↔ 求解器 schema 的接缝断（新登记建议 **G-17「上传类型→求解器 schema 映射层缺失」**）；B2 归域摩擦(G-6 续)；B1 无 LLM 建模 UX(L5049)。
- **回写**：建议把 B3 提为高优——它是"真实数据全流程"能不能用的命门，且与 N1 同源。

---
*审核方亲手真跑实证（design+review·以用户身份走通+钉断点·非读 dev 声明·非测试绿·证据 scratchpad/optA-evidence.log）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
