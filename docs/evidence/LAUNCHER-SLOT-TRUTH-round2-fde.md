# LAUNCHER-SLOT-TRUTH 二轮 — 词表接缝闭合实证（P0·S02 问合肥端到端）

日期 2026-07-05 · 真起 datacore(4021) + agentcore(4032) 内存模式（SEED_DEMO=1）· 真 curl 逐值对照。

## BLOCK 的两条断点（审核方 live-Kimi 复验·本轮修向）

| # | 断点 | 治 | 位置 |
|---|---|---|---|
| (a) | **CJK 标签无键解析**：datacore `getObject` 只认存储 id / 主键值；「合肥」只在 `props.name`（二级键 hefei）→ 唯一 score-1 候选也不自动绑 → 无谓澄清 | FIX-② `resolveUniqueByName`：全类型 getObject miss 后跨类型 `objects/query {name:key}` 精确匹配；**全局唯一**命中才自动绑定；多命中/零命中仍走域外澄清（不猜） | `router/slots.ts validateSlotValue` objectRef 裸串分支 |
| (b) | **objectRef 规范化压错键**：回填/选候选后规范化取 `data.objectId=obj_base_hefei`（datacore 序列化不一致：Base 载荷带 objectId·Model 不带）→ 模板 `{{slots.base.objectId}}` 压长 id 入求解器 → `affected_orders` 词表只认 `props.baseId=hefei` → 400 unknown base → FAILED | FIX-① `solverVocabObjectId`：规范化即存**求解器词表键（props 主键）**（约定主键 `<lcFirst(type)>Id` → 长 id 剥前缀且后缀须真是某 prop 值 → 兜底旧行为零回归）；两种载荷形态都对 | `router/slots.ts` objectRef 两分支（ObjectRef 形态 + 裸串形态）共用 |

单点治在 slots.ts 规范化处（审核方修向「或规范化时存 props 主键」路线）——**不触 orchestrator.ts :242/:556 活跃 hunk**。

## 真 datacore 载荷形状逐值（断点复现）

```
GET /a/v1/objects/Base/hefei          → 200 data={id:"obj_base_hefei",type:"Base",props:{baseId:"hefei",name:"合肥",orderCount:8,…}}
GET /a/v1/objects/Base/obj_base_hefei → 200 同上（长 id 也解析）
GET /a/v1/objects/Base/合肥            → 404 NOT_FOUND（断点 a：CJK 名 getObject 必 miss）
GET /a/v1/objects/Model/2170-NCM      → 200 data={id:"obj_model_2170-NCM",type:"Model",props:{modelId:"2170-NCM",…}}（无 objectId 字段）

POST /a/v1/solvers/affected_orders/invoke {"args":{"baseId":"hefei"}}          → 200 count=8, baseId=hefei
POST /a/v1/solvers/affected_orders/invoke {"args":{"baseId":"obj_base_hefei"}} → 400 VALIDATION_ERROR "unknown base: obj_base_hefei"（断点 b：修复前送入的长 id 即 live 400）
```

## S02 端到端（真管线 HTTP·三形态全 COMPLETED）

沙箱无 live Kimi 键 → 分类走 `deterministic:example-match`（extractedSlots={}），本轮显式「合肥」经真 HTTP
`POST /api/v1/queries/:id/clarification {"kind":"SLOT_FILLING","slotValues":{"base":"合肥"}}` 注入（与一轮同法·复刻抽取形态）。

```
① 问「合肥基地停产影响哪些订单？」（无 chip）→ AWAITING_CLARIFICATION → 澄清注入 base="合肥"
   → COMPLETED · slots.base={"objectType":"Base","objectId":"hefei","label":"合肥"}
   → 答案: 「本次回答所用参数：基地=合肥。」「受影响订单共 8 张，明细见上表」
   → 8 张 == GET Base/hefei props.orderCount=8 == solver baseId=hefei count=8（逐值对上）
   （FIX-② 唯一精确匹配自动绑·免二次澄清；FIX-① 求解器收到 hefei 非 obj_base_hefei·免 400）

② chip=ObjectRef{objectId:"obj_base_hefei",label:"合肥"}（候选回填/页面选中长 id 形态 = live 断点 b 的确切形状）
   → COMPLETED · slots.base.objectId="hefei" · 答案含「基地=合肥」「共 8 张」

③ Model 载荷形态（GET Model/* 无 objectId 字段）：chip=ObjectRef{objectId:"obj_model_2170-NCM"} + capacity_feasibility
   → COMPLETED · slots.model={"objectId":"2170-NCM","label":"2170 三元圆柱"} · 答案回显「型号=2170 三元圆柱、需求增量=0.2」
```

脚本/原始回执：`s02-hefei.sh` / `s02-hefei-b.sh` / `s02-model.sh` / `s02c-task{1,2,3}.json`（`docs/evidence/launcher-slot-truth-round2/`）。

## 齿检（revert→red）

- 新齿 `apps/agentcore/test/launcher-slot-truth-vocab-seam.test.ts` **13 例**：
  - ontology 替身**复刻真 datacore 语义与载荷形状**（getObject 只认 id/主键·不认 name；Base 载荷带顶层 objectId（live 实证形态）·Model 不带；queryObjects data 为数组 [{id,type,props}]）；
  - 求解器替身**词表严格**（只认 baseId="hefei"，否则抛 unknown base = live 400 形态）；
  - FIX-① 单元 4 例（Base 带 objectId / Model 无 objectId / Order.so 非约定主键剥前缀·后缀不在 props 不猜 / mock 扁平行兜底零回归）；
  - FIX-① 断点复现 3 例（ObjectRef 长 id 回填形态 → hefei；Model 长 id → 2170-NCM；裸串主键不被压长）；
  - FIX-② 4 例（「合肥」唯一精确匹配自动绑 objectId=hefei 免澄清 / 多类型同名**不**自动绑仍澄清 / 多同名有 chip → 落 chip+substitution 诚实横幅 / 域外「火星基地」仍 outOfDomain）；
  - e2e 2 例（问「合肥」无 chip → COMPLETED·solver 真收到 "hefei"·答案含合肥且含「基地=合肥」不含「基地=常州」；chip 长 id → COMPLETED·答案含「基地=合肥」）。
- **revert 自证**：临时还原两 FIX（objectId 压回 `data.objectId ?? key`、删自动绑）→ **7/13 红**（含两条 e2e）；恢复 → 13 绿。
- **一轮 16 齿全保**：`test/launcher-slot-truth.test.ts` 16 passed（未改动一字）。

## 测试/门

- `pnpm --filter agentcore test`（vitest run）→ **485 passed / 1 skipped**（+13 新齿·零回归）
- 四包 `pnpm -r build` 绿 · `pnpm gates` exit 0
- 本体回写：`docs/SYSTEM-ONTOLOGY.md` §8 G-3 追加「二轮·词表接缝闭合」+ `pnpm ontology:slices` 重生成（门 `ontology-slices:check` 守）
