# WO-69-ONTOLOGY-PRIMITIVES · 本体三缺口：列级 Security / Function 本体签名 / Interface

> 七要素体检结论：**Object Type / Property / Link Type 完整；Action Type 另有专单（#65 已派）；本单收剩下三项。**
>
> 三项有**严格依赖顺序**，不许并行做：**列级 Security → Function 签名 → Interface**。理由见 §四。

---

## 一、现状取证（**已核实**，dev 需自行复核）

### 缺口 A · Security 只有行级，列级为零

`packages/contracts/src/datacore.ts:233-247` `PermissionPolicySchema`：

```ts
{
  id, tenantId,
  resource: { kind: z.enum(["OBJECT_TYPE","CONNECTION","RULE_SET","ACTION_TYPE"]), key },
  grants: [{ role, ops: ("READ"|"WRITE"|"EXECUTE")[] }],
  rowFilter: z.string().optional(),      // ← 行级：有
}
```

- **无 PROPERTY 档**：`resource.kind` 四值里没有属性维度。
- **无列级字段**：全仓 grep `maskedProps` / `hiddenProps` / `allowedProps` / `propMask` / `columnPolicy` → **0 命中**。
- 行级执行在 `apps/datacore/src/authz.ts`（`AccessDecision.rowFilters` → 查询执行器 AND 上去），走 `ruledsl` 子集、支持 `${user.<path>}`。

→ 「谁能看哪些数据」有；**「谁能改哪些字段」完全没有**。用户原话：**Agent 不能改"别人的数据"** —— 这句话在列维度目前无法保证。

### 缺口 B · Function 能调，但没有本体级签名

求解器（~20 个）、规则引擎、LLM 都能被 Agent 调用（`invoke_solver` / `evaluate_rules`）。但**没有任何一处声明"这个 function 读哪个 ObjectType 的哪些 Property、写什么"**——目录里只有 `argHints`（字符串提示）。

最接近的是 DRIL 的 `ResourceInputOutput`（`packages/contracts/src/intelligence-resource.ts:35`）：
```ts
{ objectTypes?, linkKeys?, requiredProps?, shape?, example? }
```
但它是**投影产物**，且今天刚查出对 skill 的填充曾把 `requiredProps` 与 `shape` 接反；对 solver 则根本没填。

### 缺口 C · Interface 完全不存在

全仓 grep `interfaceKey` / `implementsInterface` / `InterfaceDef` / `ObjectInterface` → **0 命中**。无多态抽象机制。

---

## 二、《本体引用与影响》

- **对象类型**（§2）：`OntologyType` · `PropertyDef` · `PermissionPolicy` · `SolverDef` ·（新增）`ObjectInterface`
- **链路**（§3）：`AuthzService.decide → rowFilters → 对象查询执行器`（现有，本单扩列级）；`求解器目录 → DRIL 投影 → Agent 选型`（现有，本单补签名）
- **不变量**（§5）：**R3 entitlement 先于 authz**（功能关闭 = 不存在 → 404）· **R4 真值经 Action**（列级写权限是它的细化）· **R13 结论可溯源** · **R-一致**
- **门禁**（§7）：需新增列级权限门；DRIL `dril-registry:check` 需扩签名校验
- **断点**（§8）：本单**新增** `G-SECURITY-COLUMN-LEVEL`、`G-FUNCTION-SIGNATURE`、`G-NO-INTERFACE` 三行，并在各阶段完成时回写状态。
- **本单大幅改变对象类型与链路 → 每阶段交付都必须回写本体。**

---

## 三、🚦 范围边界

**允许改**：
- `packages/contracts/src/datacore.ts`（`PermissionPolicySchema` additive）、新增 `packages/contracts/src/object-interface.ts`
- `apps/datacore/src/authz.ts`、`ontology.ts`、`ontology-core.ts`、对象查询执行器、`catalog.ts`
- `apps/datacore/src/repo/**` + `migrations/*.sql`（**四方同步**：`repo.ts` 接口 + `pg.ts` + `memory.ts` + 迁移 SQL）
- `apps/datacore/src/synthetic/battery.ts`（种子数据）
- 新增门脚本 + 测试

**禁止**：`apps/agentcore/**`、`apps/frontend-shell/**`（管理 UI 另开单）；contracts 破坏性改动。
**与 #65（ActionType 可演进 + 回写声明）有交叠风险** → `packages/contracts/src/actions.ts` **归 #65**，本单不碰。

---

## 四、为什么顺序不能反（**看懂再动手**）

```
列级 Security  ──→  Function 签名  ──→  Interface
   (最独立)          (需要知道读写什么)      (需要前两者当元数据基础)
```

- **Function 签名依赖列级 Security 的属性寻址能力**：签名要说"读 `Order.qty`"，就需要一套稳定的 `类型.属性` 寻址与校验；列级权限正好要建同一套。先做 Security = 顺手把寻址做扎实。
- **Interface 依赖 Function 签名**：Interface 的价值大头不在"继承 3 个字段"，而在"实现者自动获得一组行为"。没有 Function 签名，Interface 只能继承字段 → 做成空壳。用户提的「减少 30% 重复代码」那 30% 主要是**行为**（审批链、UI、Agent 工具），不是字段。
- **反过来做的代价**：先做 Interface → 它无法声明行为 → 后面补 Function 签名时 Interface 契约要改 → 违反自己刚立的开闭原则。

---

## 五、P1 · 列级 Security（本阶段独立可交付）

### 设计

`PermissionPolicySchema` **additive**：

```ts
/**
 * 列级（属性级）策略。行级 rowFilter 管"看哪些行"，本字段管"看/改哪些字段"。
 * 缺省（不配）= 沿用现状：该资源的所有属性按 grants 的 ops 处理（**向后兼容硬要求**）。
 */
propertyPolicy: z.object({
  /** 可读属性白名单。配了则**只有**列出的可读；未列出的在查询结果中被剔除（不是置 null——置 null 会被误读成"值为空"）。 */
  readable: z.array(z.string()).optional(),
  /** 不可读属性黑名单（与 readable 互斥，二选一；同时配 → 校验期报错，不许静默取其一）。 */
  denyRead: z.array(z.string()).optional(),
  /** 可写属性白名单。**写路径必须校验**：Action 提交、对象 PATCH、求解器回写全都要过。 */
  writable: z.array(z.string()).optional(),
  denyWrite: z.array(z.string()).optional(),
}).optional(),
```

### 执行点（**每一处都要接，漏一处就是绕过点**）

dev 必须先**穷举列出**所有读写路径，再逐一接。至少包括：
1. 对象查询执行器（读）
2. 对象详情/单取（读）
3. 对象 PATCH / 写回（写）
4. Action 提交与执行的回写（写）—— 与 #65 的 effects 声明有协同，**但本单只做校验，不碰 ActionType 契约**
5. 求解器上下文加载（读）—— 求解器读到不该读的字段，等于绕过
6. 时序 / 派生属性路径（读）

> **禁止只接一半**。本仓刚出过"同一能力只接了一半路径"的病例（解析器接在 REST 端点、前端走另一条路 → 静默错答）。dev 必须交出**路径穷举清单**并逐条标注接没接。

### 关键语义

- **剔除而非置空**：不可读属性从结果里**删掉键**，不是 `null`。置 `null` 会被下游误读成"业务上没有值"——那是伪造数据。
- **拒绝而非静默丢弃**：写不可写属性 → 明确报错（错误信封 `{error:{code,message,requestId}}`，code 建议 `PROPERTY_FORBIDDEN`），**不许静默忽略该字段然后返回成功**。
- **R3 先于 authz**：功能关闭时仍是 404 `FEATURE_NOT_FOUND`，列级策略不改变这一层。

---

## 六、P2 · Function 本体签名

### 设计

求解器目录项（`apps/datacore/src/catalog.ts` 的 `CatalogItem` 及其源）additive：

```ts
/** 本体级签名：这个 function 读什么、写什么。供影响分析与 Agent 选型（非自由文本）。 */
ontologySignature: z.object({
  reads: z.array(z.object({
    typeKey: z.string(),
    propKeys: z.array(z.string()).optional(),  // 省略 = 全属性
    linkKeys: z.array(z.string()).optional(),
  })).optional(),
  writes: z.array(z.object({ typeKey: z.string(), propKeys: z.array(z.string()) })).optional(),
  /** 是否确定性（同输入同输出）——已有 isDeterministic 则复用，勿另起。 */
}).optional(),
```

### 硬要求

1. **签名必须与实际读写一致**，不是文档。加一条门：抽样若干求解器，**实跑**并记录其真实访问的类型/属性，与声明比对，不一致即红。
   - 这一条是本阶段的**头号判据**。没有它，签名就是又一份会过期的手写清单（本仓已有多例）。
2. **不许自造命名**：`typeKey`/`propKeys` 必须能在已发布本体里解析到，解析不到即红。
3. 与 DRIL 的 `ResourceInputOutput` **对齐而非重复**：投影层从 `ontologySignature` 派生，**不要两处各填一份**（今天刚修过 `requiredProps`/`shape` 接反的事故，就是因为投影层自己猜语义）。

---

## 七、P3 · Interface

### 设计

新增 `packages/contracts/src/object-interface.ts`：

```ts
export const ObjectInterfaceSchema = z.object({
  id: z.string(),           // itf_
  tenantId: z.string(),
  key: z.string(),          // 如 "Approvable"
  version: z.number().int(),// 可演进（对齐 Skill/Workflow 的既有写法）
  name: z.string(),
  /** 业务定义（与 WO-63 的 businessDefinition 同构·复用不另起） */
  businessDefinition: z.object({ statement: z.string(), excludes: z.string().optional() }).optional(),
  /** 接口要求实现者具备的属性（字段继承） */
  properties: z.array(z.object({
    propKey: z.string(), dataType: z.string(), unit: z.string().optional(),
    description: z.string(), required: z.boolean().default(true),
  })),
  /** 接口要求/提供的行为（行为继承·价值大头在这） */
  actions: z.array(z.object({ actionTypeKey: z.string(), required: z.boolean().default(true) })).optional(),
  functions: z.array(z.object({ solverKey: z.string() })).optional(),
  status: z.enum(["DRAFT","PUBLISHED","RETIRED"]),
});
```

`OntologyType` additive：`implements: z.array(z.object({ interfaceKey: z.string(), version: z.union([z.number().int(), z.literal("latest")]) })).optional()`

### 硬要求

1. **一致性校验（发布门）**：类型声明 implements 某接口 → 必须真的具备接口要求的全部属性（键名 + dataType 兼容）与行为；缺一即拒绝发布，**报出缺哪一项**。
2. **多实现（组合优于继承）**：一个类型可同时实现 N 个接口。**不引入类型继承（`extends`）**——本平台现在是扁平的，别把深继承的坑一起引进来。
3. **冲突处理**：两个接口要求同名属性但 dataType 不同 → 发布期报错，**不许静默取其一**。
4. **查询能力**：能按接口查"所有实现 Approvable 的对象类型"，并据此做影响分析（改接口 → 列出受影响的类型/Action/视图）。
5. **开闭**：接口本身有 `version`；改接口不得让已发布的实现者静默失效——升级路径必须显式（要么新版本并存，要么发布期拒绝并给出迁移清单）。

### 验收（用用户给的例子直接验）

种一个 `Approvable` 接口（`approver` / `approvedAt` / `amount`），让**至少两个**现有类型实现它，断言：
- 两个类型都自动具备三个属性
- 在接口上加第四个属性 → 两个实现者**同时**被要求补齐（发布门拦住），**不需要分别改两处**
- 删掉其中一个类型的某个必需属性 → 发布门红并指出缺哪个

---

## 八、SEAM 红咬（每条可变异反证）

| # | 阶段 | 断言 | 变异（必须变红） |
|---|---|---|---|
| S1 | P1 | 配 `denyRead: ["unitPrice"]` 的角色查对象 → 结果里**没有该键**（不是 null） | 改成置 null → S1 红 |
| S2 | P1 | 该角色写 `unitPrice` → 明确报错 `PROPERTY_FORBIDDEN`，**且值未被写入** | 改成静默忽略并返回成功 → S2 红 |
| S3 | P1 | **求解器上下文**也受列级约束（不是只有 REST 层） | 只在 REST 层接、求解器路径不接 → S3 红 |
| S4 | P1 | 未配 `propertyPolicy` 的既有策略行为**逐字节不变** | 让缺省变成"全部不可读" → S4 红（向后兼容硬底线） |
| S5 | P2 | **实跑求解器记录真实读写，与声明签名比对**，不一致即红 | 声明少写一个实际会读的属性 → S5 红 |
| S6 | P2 | 签名里的 `typeKey`/`propKey` 必须在已发布本体里解析得到 | 写一个不存在的属性 → S6 红 |
| S7 | P3 | 接口加一个属性 → **所有实现者**同时被发布门要求补齐 | 只校验其中一个实现者 → S7 红 |
| S8 | P3 | 两接口同名属性 dataType 冲突 → 发布期报错 | 改成静默取其一 → S8 红 |
| S9 | P3 | 能查"所有实现 X 接口的类型"并给出影响面 | 查询漏掉某实现者 → S9 红 |

> **S3 与 S5 是本单最容易被做成假绿的两条**：S3 因为"只接一半路径"是本仓高频病；S5 因为"声明与实际不符"是所有手写清单的宿命。这两条必须实跑取证，不许读代码下结论。

---

## 九、验收清单（按阶段）

**P1 列级 Security**
- [ ] 读写路径**穷举清单**已交，逐条标注接没接
- [ ] S1–S4 各有变异反证两次输出
- [ ] 仓储四方同步（接口 / pg / memory / 迁移 SQL）
- [ ] 本体 §8 新增 `G-SECURITY-COLUMN-LEVEL` 并标状态

**P2 Function 签名**
- [ ] 至少覆盖 8 个高频求解器
- [ ] S5–S6 各有变异反证两次输出，S5 必须是**实跑比对**
- [ ] DRIL 投影改为从签名派生，**未新增第二份手填清单**

**P3 Interface**
- [ ] `Approvable` 例子端到端跑通（两个实现者 + 加属性同时生效）
- [ ] S7–S9 各有变异反证两次输出
- [ ] 未引入类型继承（全仓无 `extends` 语义）

**全阶段**
- [ ] `npx tsc -p apps/datacore/tsconfig.json --noEmit` 真退出码 0
- [ ] 本体 §2/§3/§5/§8 已回写
- [ ] **诚实边界**：哪些路径没接、哪些求解器没签名、为什么

---

## 十、反假绿纪律

1. **退出码显式捕获**：`out="$(cmd 2>&1)"; rc=$?`。禁止 `cmd | tail; echo $?`。
2. **vitest 不做类型检查**，必须另跑 `tsc --noEmit` 看真退出码。
3. **变异反证**：每条断言改坏→红、还原→绿，两次输出都贴。
4. **剔除 ≠ 置空，拒绝 ≠ 静默忽略**：这两条是列级安全的语义底线，做错就是把"没权限"伪装成"没有值"/"写成功了"。
5. **签名必须实跑校验**：手写清单一定会过期，唯一防线是拿实际行为去比对。
6. **不许只接一半路径**：交路径穷举清单，逐条标注。
7. **"权限做完了"这句话**，除非 S3 有实跑取证，否则不许写——只在 REST 层接的列级权限，等于没做。

---

## 十一、交付方式

- 分支 `claude/handoff-wo-69-ontology-primitives`，**不碰正线**。
- **三阶段分别 push、分别复验**，P1 未过不进 P2。
- 审核方复验：五包 gate + 新门 + **亲手用受限角色登录看字段是否真的消失/改不动**（绿测试≠能用）。
