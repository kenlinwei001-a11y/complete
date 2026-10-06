# 断点接续档 · WO-SEMANTICS-DECLARED（系统重启前落盘）

> 2026-10-06 · 分支 `claude/semantics-declared` · **重启后先读本件**

## 一、已推送的进度（重启不丢）

```
claude/semantics-declared → 3b8b7fd84（+ 本件）
  3b8b7fd84  在场实例登记
  75f7d1e26  第2+3步：播种值+C2守卫 ⇒ 8.09 消失、三臂精确线性   ★ 核心成果
  6d636682b  第2+3步精确改法 + 4051/4052 A/B 自决
  695aeb142  第1步：STATE_VAR_SEMANTICS 声明表（行为中立）
  80fd1e815  LOOP 产物入册（B/C 全部证据 + 探针）
  1b7476787  根因认定 LOOP 收敛（三方一致）
```

**核心成果**：`Order.costPressure` 的 −8.09（来自「C2 基值恢复 × 出口软拐点投影」的复合不动点）
已消失；改后三臂**精确线性**（`-3/-1 = 3.000000000`，`-20/-1 = 20.000000000`）。

## 二、⚠ 系统重启 ⇒ 所有实例会死，重启后按此恢复

| 端口 | 重启前 | 重启后是否需要 |
|---|---|---|
| **4051** | datacore **改前臂**（PID 20527，`PORT=4051 SEED_DEMO=1 node --max-old-space-size=8192 dist/server.js`，cwd=`/tmp/wt-ab/apps/datacore`） | **按需**。其行为基线已全部入册（改前读数 82.291509 等），**不重起也能引用**。仅当要重跑 C 判据①反证（"只改系数应无效应"）时才需要 |
| **4052** | datacore **改后臂**（PID 85770，同上但 `PORT=4052`） | **✅ 需要**。改后代码就在当前分支 ⇒ 重起即得 |
| **5293** | 前端 `vite preview` 5293（服务本树 `dist`，**改前内容**） | 按需 |
| **5294** | 前端 `vite dev` 5294（**改后**，env 覆盖 `VITE_DATACORE_URL=http://127.0.0.1:4052`，**不写 dist**） | **✅ 需要**（做 ① 屏上 dump 用） |
| 4043 | agentcore | 按需 |

**重启后恢复 4052 一条命令**：
```
cd /tmp/wt-ab/apps/datacore && PORT=4052 SEED_DEMO=1 nohup node --max-old-space-size=8192 dist/server.js > /tmp/dc4052.log 2>&1 &
# 等 ~25s 预热，然后自证：curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4052/a/v1/health  （401=活着）
```
⚠ **重起前先 `pnpm --filter datacore... build`**（`dist` 可能不是最新的）。

**重启后恢复 5294**：
```
cd /tmp/wt-ab/apps/frontend-shell && VITE_DATACORE_URL=http://127.0.0.1:4052 VITE_AGENTCORE_URL=http://127.0.0.1:4043 \
  nohup node node_modules/vite/bin/vite.js --port 5294 --host 127.0.0.1 --force > /tmp/fe5294.log 2>&1 &
```

## 三、⚠ 断在哪（如实）

**① 屏上焊死 —— 未完成。** 驱动已跑起来，但 **10 分钟工具超时被杀（exit 143 = SIGTERM，不是失败）**。
- 驱动：`/private/tmp/wo-console-e2e/driver/drive-3pert-joint.mjs`（仓外既有件，未改）
- 跑法：`cd /private/tmp/wo-console-e2e && FE_BASE=http://127.0.0.1:5294 WANT_LIST=due-change HOWMANY=1 RUN_TAG=postfix EV_DIR=/tmp/screen-4052 node driver/drive-3pert-joint.mjs`
- **⇒ 下次用 `run_in_background` 跑，别用前台（它比 10 分钟长）**
- 产物（若有）：`/tmp/screen-4052-run.txt` / `.rc` / `/tmp/screen-4052/`
- ⚠ **`/tmp` 重启会清空** ⇒ 上面这些路径重启后大概率蒸发，**重跑即可**

**② 13 格逐格裁 —— 未开工。** 判据在册（消费端量纲定 owner），清单见 `WO-AB-DUALWRITER-census.txt` 14 格。

**③ `props.costPressure = 115` 名实归位 —— 已定解、未动代码。**
**解法已纠正**：**不是**退役规格（`seed-derivation-specs.ts:189-192` 有仓主明令「⛔ 不许再退役」），
**而是新增 `Order.creditUtilization`**（新增 ≠ 退役，守禁令）。详见 `WO-AB-NEXT-3ITEMS.md`。
**危害实测为 0**：`props.costPressure` 现有消费者只剩播种路，而它已被改掉（DEVIATION 格不读 props）；
前端两处 `preferStateVars` 引的是状态量**名**、从**世界态**读。

## 四、重启后第一件事

1. 读本件 → 2. `pnpm --filter datacore... build` → 3. 起 4052 → 4. 起 5294 → 5. **后台**跑屏上 dump（① ）
