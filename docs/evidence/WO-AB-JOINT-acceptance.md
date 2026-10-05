# WO-AB-JOINT · 接缝复验（#71）：(b) 消费端减静息点 × 病B 传导核减源侧静息点

**树**：集成分支 `claude/integrate-ab` tip `e9bfa1ed8` —— **基座是两个 dev 的共同祖先 `2b384f30c`**（P3 第9阶段），
`merge --no-ff 886fb4d0c`（dev B）入 `6231550d9`（dev A）。**零冲突**，只带进 dev B 那 4 个提交（7 文件）。

> ⚠ **为什么基座不是 canonical**：canonical tip `b9fa5e1ce` 与 dev A 的基 `14864ea2a` 不同线，
> 在 canonical 上 cherry-pick dev A 会在 `synthetic/battery.ts` 冲突（实测）。
> 两个 dev 的**共同祖先恰是 `2b384f30c`**，且两边改的是不相交文件 —— 那才是集成该踩的地方。
> **⇒ 本档量的是「A+B 两处修复合起来对不对」，不是「能不能并进 canonical」。** 后者是另一张单。

## 树龄探针（防「我量的是哪棵树」）

| 树 | propagation.ts | 含义 |
|---|---|---|
| `/tmp/wt-base`（修前基线，canonical `fb9269b5a`） | **1629** 行 | 屏上基线那棵树 |
| `/tmp/wt-ab`（修后，`e9bfa1ed8`） | **1290** 行 | 本档 |

## 环境自证（⛔ 不是「进程在跑」）

| 件 | 端口 | PID | 自证 |
|---|---|---|---|
| datacore | **4051** | 20527 | `lsof` listener PID == spawn PID · cwd `/private/tmp/wt-ab/apps/datacore` · `/readyz {"status":"ready"}` |
| 探针 | — | — | `PORT=4051 TICKS=40 node docs/evidence/WO-MULTIPERT-baseline.mjs`（从 #68 `08850260b` 取入，**未改一行**） |

- 端口空闲用**真去 bind `0.0.0.0`** 验（非 127.0.0.1）；**金丝雀**：同法 bind 已知被占的 4031 ⇒ `EADDRINUSE` ✓ ⇒ 量法有效。
- ⛔ 全程未碰 4001 / 4002 / 4019 / 4041 / 5173（别人的部署）。
- 实例 `--max-old-space-size=8192` · `SEED_DEMO=1`（首次起漏了它 ⇒ `/readyz` 报 `BOOTSTRAP_REQUIRED`，非静默）。

---

## ①b · 三格读数 ÷ baseSnapshot（**本档最硬的正向证据**）

修前数值引自记忆 `costpressure-level-vs-deviation-arbitration` §③（**另一棵树、另一时刻、独立来源**）。

| 格 | base | **修前**（逐拍比值） | **修后 zero 臂逐拍** | 修后比值 |
|---|---|---|---|---|
| `obj_model_4680-NCM.costPressure` | 2.926300 | ×1 → ×0.325 → ×0.145 → ×0.696（非单调） | **恒 2.9263** | **全 1** |
| `obj_order_SO-3391.costPressure` | 90.384615 | ×1 → ×0.939 → ×0.920 → ×0.914 | **恒 90.384615** | **全 1** |
| `obj_customer_cust_14.receivablePressure` | 15.745200 | ×1 → ×2.574 → ×3.550 → ×4.154 | **恒 15.7452** | **全 1** |

**判据三条同时成立**：逐拍恒定 ∧ == 该格 `baseSnapshot` ∧ **⛔ 不是它的 2 倍**（比值恒 1，不是 ≈2）。

⇒ 病 B（`drive = 源读数 − 源侧静息点`）在这三格上**逐位证实**。
⇒ 顺带终审 dev A 的 (甲)/(乙) 之争：`rest` 是**钉死的锚**，读数精确停在它上面 —— **不是「死了」**。

## 其余判据

| 判据 | 读数 | 判定 |
|---|---|---|
| ② 金丝雀 · 鉴别力 | ΔA 非零 · ΔB 非零 | ✅ **两个扰动都有鉴别力**（排除了「B 推不动读数」的假绿） |
| ③ A+B vs {A,B} | `A+B ≢ A` ∧ `A+B ≢ B` | ✅ B 的效应没被 A 吞掉 |
| ④ 确定性 | 同组同序重跑 ⇒ 逐拍读数串**逐字节相同** | ✅ |

---

## 🔴 未闭环两条（本档的新读数，**不是** A/B 引入的回归）

### ① 零扰动臂仍有残余位移（量级降一档，形态从发散变收敛）

```
修前（#68 基线，独立实例）  MARGIN.projected  t0 = -14.9700  →  t18 = -25.4300   ← 第一拍就不等于 rolling，且发散
修后（本档 zero 臂）        MARGIN.projected  [118.9 ×5拍] → 119.5797 → … → 收敛到 119.9111
                             MARGIN.rolling    恒 118.9000（40 拍）
                             (projected − rolling) = [0,0,0,0,0, 0.6797, 0.8905, …, 1.0111]
```

- **t0–t4 精确静息**：`projected == rolling`，delta **0.0000** —— **修前从第一拍就做不到**。
- **t5 起爬到 +1.0111 后收敛**（不是发散）。
- **动的是承载集里的其它格**：三格采样点恒定（见 ①b），而 `costPressure` 聚合 23.0367(t4) → 22.9197(t5) 同步在动，
  `COST.projected` 581.1000 → 580.4203。⇒ **不是这三格，是别处**。
- **t5 这个时刻未解释。⛔ 不许猜**：须按 `hop-trace-locates-seed-not-propagation` 的逐跳手算对照定位
  （先查是不是某条 `delayTicks` 边到期 / 某个非承载格先被 `saturateToDomain` 夹到位）。

### ② 🔴 `durationTicks` 不生效 —— 扰动被永久化（判据⑤ FAIL）

`startTick=0 durationTicks=5 ⇒ 生效 [0,5)，t≥5 应回退`。实测：

| t | 时长臂 | zero | A（永久） |
|---|---|---|---|
| 5 | 120.5567 | 119.5797 | 120.5567 |
| 16 | 120.9031 | 119.9107 | 120.8957 |

**t≥5 完全没有回到 zero 线**，一路贴在 A(永久) 那条线上。
⇒ **屏上「推演时长 30 天」正是靠 `durationTicks`** —— 它不生效意味着**用户设的时长形同虚设、扰动永久留在世界里**。
**⇒ 这条与 `docs/evidence/WO-SCREEN-BASELINE.md` 那份屏上基线直接相关，须并入同一处置。**

---

## 复现

```bash
git -C <repo> worktree add --detach /tmp/wt-ab <集成分支>
pnpm -C /tmp/wt-ab install --prefer-offline
pnpm -C /tmp/wt-ab --filter datacore... build        # 省略号带上依赖，避免漏包
cd /tmp/wt-ab/apps/datacore && PORT=4051 SEED_DEMO=1 node --max-old-space-size=8192 dist/server.js
cd /tmp/wt-ab && PORT=4051 TICKS=40 node docs/evidence/WO-MULTIPERT-baseline.mjs
```

原始 stdout：`WO-AB-JOINT-acceptance.txt`（7708 行）· rc：`WO-AB-JOINT-acceptance.rc`（`CAPTURED_RC=0`，由捕获的退出码写，⛔ 非 tail echo）。

**NOT-MEASURED**：凡本档未给出数字的项一律按 NOT-MEASURED 读，⛔ 不许拿别的臂的数推它。
本档**未量**：屏上（真前端）修后表现 —— 那需要另起前端实例，归 #71 下一段。
