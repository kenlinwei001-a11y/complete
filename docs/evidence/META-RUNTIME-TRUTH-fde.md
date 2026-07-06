# FDE · META-RUNTIME-TRUTH（WO-4·PRD-trustworthy-self-accounting §3.5）

> 根治 **P2 meta 镜像谎言**：「用平台查平台自己」此前返回的是 §8 markdown 的 ✅/◐ 声称
> （`meta/parse.ts parseBreakpointRow` 读 emoji 投影 FIXED），非运行时真相——`meta:sync` 只校验
> 可解析、不校验声称为真。本单让 `SystemBreakpoint.status` **交叉核对该断点关联的现成 reality-judge
> 运行时裁决**：声称 FIXED 但判据不通 → `DRIFT`；判据通 → `FIXED`；无可运行判据 → `UNCHECKED`。

本 FDE 记 **DRIFT / FIXED / UNCHECKED 三态真产出**（真跑判据·非文档声称）。

---

## 0. 机制（不新建判据·复用现成门）

- 派生纯函数 `deriveRuntimeStatus(claimedStatus, judge?)`（`apps/datacore/src/meta/parse.ts`·R6）：
  - `claimedStatus !== "FIXED"` → 原样透传（PARTIAL/OPEN 未自称已修，无谎可揭）
  - 声称 FIXED · 判据 `ran=true,passed=false` → **`DRIFT`**（本体谎言曝光）
  - 声称 FIXED · 判据 `ran=true,passed=true` → **`FIXED`**（印证）
  - 声称 FIXED · 无判据 / `ran=false` → **`UNCHECKED`**（诚实边界·不默认信 emoji）
- 判据 = 断点 §8 行内引用的现成门（`check-*.mjs`/`xxx:check`），由 `scripts/meta-runtime-truth.mjs`
  真跑（`spawnSync node scripts/check-*.mjs`）。
- **诚实边界（判据白名单）**：只纳「无需活服务、静态可跑」的门：`debattery / boundary-singlesource /
  no-orphan-source / no-fake-done / no-hardcoded-rules / rule-closure / method-determinism /
  solver-license / datadep-manifest / chain`。需活双服务的运行时门（`ontogenesis-runtime / sim /
  propagation / tracing` 等）**诚实归 UNCHECKED**，绝不因判据跑不起来误报 DRIFT。
- `claimedStatus` 恒保留 §8 emoji 声称——供审计对照「声称 ↔ 运行时真相」两张皮。

---

## 1. FIXED + UNCHECKED 三态之二（真跑现成门·活体本体）

`node scripts/meta-runtime-truth.mjs`（对真实 `docs/SYSTEM-ONTOLOGY.md`·真跑白名单门）：

```
META-RUNTIME-TRUTH · 断点声称 ↔ 运行时判据交叉核对

  G-1   声称=UNKNOWN  → ·UNKNOWN | 判据: —
  G-2   声称=UNKNOWN  → ·UNKNOWN | 判据: —
  G-3   声称=PARTIAL  → ·PARTIAL | 判据: —
  G-4   声称=UNKNOWN  → ·UNKNOWN | 判据: —
  G-5   声称=FIXED    → ✓FIXED   | 判据: boundary-singlesource:check=PASS,debattery:check=PASS
  G-6   声称=FIXED    → ?UNCHK   | 判据: —
  G-7   声称=UNKNOWN  → ·UNKNOWN | 判据: —
  G-8   声称=FIXED    → ✓FIXED   | 判据: chain:check=PASS,datadep-manifest:check=PASS
  G-9   声称=PARTIAL  → ·PARTIAL | 判据: —
  G-10  声称=PARTIAL  → ·PARTIAL | 判据: —
  G-11  声称=FIXED    → ?UNCHK   | 判据: —
  G-12  声称=FIXED    → ✓FIXED   | 判据: debattery:check=PASS,method-determinism:check=PASS,solver-license:check=PASS
  G-13  声称=FIXED    → ✓FIXED   | 判据: no-orphan-source:check=PASS
  G-14  声称=FIXED    → ?UNCHK   | 判据: —
  G-15  声称=FIXED    → ?UNCHK   | 判据: —

计: UNKNOWN=4 · PARTIAL=3 · UNCHECKED=4 · FIXED=4

✓ 无 DRIFT：所有已交叉核对的 FIXED 断点，运行时判据均通过（或诚实 UNCHECKED）。
EXIT=0
```

- **FIXED 真产出**：G-5 / G-8 / G-12 / G-13——声称 FIXED，其 §8 引用的静态门**真跑全 PASS** → 印证。
- **UNCHECKED 真产出**：G-6 / G-14（§8 行无门引用）、G-11（引 `sim/propagation` 需活服务·未纳白名单）、
  G-15（引 `tracing` 未纳白名单）——**声称 FIXED 但无可运行判据 → 诚实 UNCHECKED**，不默认信 emoji、
  不假 FIXED。这正是「别为了全绿假装所有断点都 runtime-verified」的诚实边界。

## 2. DRIFT 第三态（受控故障注入·真跑判据不通）

为坐实「判据真跑不通 → DRIFT」是真运行时路径产出（非硬编码），对一个白名单门（`check-debattery.mjs`）
**受控注入一次真实失败**（`process.exit(1)`），再真跑跑批器（可逆·跑后即还原）：

```
node scripts/meta-runtime-truth.mjs --strict   # debattery 真返回非 0

  G-5   声称=FIXED    → ✗DRIFT   | 判据: boundary-singlesource:check=PASS,debattery:check=FAIL
  G-12  声称=FIXED    → ✗DRIFT   | 判据: debattery:check=FAIL,method-determinism:check=PASS,solver-license:check=PASS
  ...
计: UNKNOWN=4 · PARTIAL=3 · UNCHECKED=4 · DRIFT=2 · FIXED=2

✗ 发现 2 处本体谎言（声称 FIXED 但运行时判据不通）：G-12, G-5
EXIT=1
```

还原后 `node scripts/check-debattery.mjs` EXIT=0、跑批器回落无 DRIFT。**证：断点声称 FIXED 一旦其运行时
判据真跑不通，meta 层立刻曝光为 DRIFT（本体谎言）**——这是 P2「镜像文档谎言」的根治：本体不再能只靠手打
emoji 冒充已修。

## 3. 齿（`datacore/test/meta-ontology.test.ts`·纯函数三态 + 落库 + revert→红）

- `deriveRuntimeStatus`：`FIXED+判据不通→DRIFT` · `FIXED+判据通→FIXED` · `FIXED+无判据→UNCHECKED` ·
  `PARTIAL/OPEN` 不被覆盖。
- 齿①：`parseMetaOntology(md,idx,{judgeResults:{G-90:{ran:true,passed:false}}})` → 断点 `status=DRIFT`、
  `claimedStatus=FIXED`（两张皮留痕）。
- 齿②：判据通→FIXED（不误报 DRIFT）；`{judgeResults:{}}`（无该断点判据）→ UNCHECKED（诚实·非假 FIXED）。
- 齿③：`sync(ctx,{ontologyMd,prdIndex},{judgeResults:{G-90:{ran:true,passed:false}}})` 落库元对象
  `status=DRIFT`——「用平台查平台自己」的对象库反映运行时真相，非 §8 emoji。

亲跑（前台·读退出码）：

```
npx vitest run test/meta-ontology.test.ts --dir apps/datacore
Tests  14 passed (14)   EXIT=0
```

**revert 自证（green→red）**：把 `deriveRuntimeStatus` 改回「只信 emoji」（`return claimedStatus`）→
重建重跑 → `4 failed`（齿①②③ + 三态断言全塌·`expected 'FIXED' to be 'DRIFT'`）EXIT=1；还原后回绿。

## 4. 不破既有

- `node scripts/check-meta-sync.mjs` EXIT=0（断点 15 · 不变量 17 · 元投影可解析）。
- `node scripts/check-ontology-writeback.mjs` EXIT=0（42 门 §7 漏登 0）。
- `node scripts/build-ontology-slices.mjs --check` EXIT=0（母体↔切片一致）。
- `pnpm --filter datacore build` 0 err。
- 向后兼容：`parseMetaOntology(md,idx)`（不传 judgeResults）与 `metaOntology.sync(c)`（app.ts 生产路由）
  维持读 §8 声称——断点 props 仅**新增** `claimedStatus/runtimeStatus/runtimeChecked/judge/judgeRefs`
  （additive），既有 sync/parse 测试不动。

## 5. 诚实边界（钉死·非全绿假装）

- **接判据交叉核对的断点**：G-5 / G-8 / G-12 / G-13（各引 ≥1 静态白名单门·真跑印证 FIXED）。
- **诚实 UNCHECKED（无可运行判据）**：G-6 / G-11 / G-14 / G-15——或无门引用、或引用需活双服务的运行时门。
  **绝不假 FIXED、绝不误 DRIFT**。
- 跑批器 `report-only`（**不入 `pnpm gates`**）：判据白名单只纳静态可跑门，避免需活服务的门在 CI 误红；
  `--strict` 供未来「meta 谎言即红」入门用。
- **未做（诚实·分期）**：把 status DRIFT 检测接进 `/a/v1/meta/sync` HTTP 路由自动跑判据（每次 sync spawn
  多门·重且可能阻塞请求）——现经 `scripts/meta-runtime-truth.mjs` 跑批 + `sync(...,{judgeResults})` 可注入
  路径提供；不变量真值全量校验（非仅断点 FIXED 声称）仍属后续。
