# WO-DR-AUDIT + WO-MULTISRC · 全套 datacore 复验（回应 reviewer 2 门红退回）

> reviewer（c995949 / REVIEW-fullsuite-RED-2blocks.md）：`pnpm --filter datacore test` 全套
> **Test Files 2 failed·Tests 5 failed·exit1** → catalog.test.ts(1·MULTISRC 目录漂移) + audit-sink.test.ts(4·PUT 500)。
> 并纠自身「MULTISRC 过早 done 只跑 ontology-core 未跑全套」，要求 dev「done 前必跑全套」。

## 处置结论：全套 datacore 现 **exit 0·859 passed·0 failed**

在 catalog 漂移修复（补 `multisource_fusion` 进 `ALL_SOLVER_CATALOG`）后，全套真跑：
```
pnpm --filter datacore test
Test Files  158 passed | 2 skipped (160)
Tests  859 passed | 15 skipped (874)
Duration  ~396s   FULL2_EXIT=0
✓ test/catalog.test.ts (6 tests)      ← MULTISRC 漂移已消
✓ test/audit-sink.test.ts (6 tests)   ← DR-AUDIT 6/6 绿
```

## BLOCK-1 MULTISRC-FUSION（已修·接受审核方自纠）

- **审核方自纠有理**：MULTISRC 把 `multisource_fusion` 加进 `SOLVER_KEYS`(service.ts:126) 却漏进求解器目录
  `ALL_SOLVER_CATALOG`(catalog.ts) → catalog.test.ts:54 `Set(reg.keys)===Set(SOLVER_KEYS)` 漂移红。
  我首轮只修 ontology-core 计数(46→47)、漏了 catalog 同类漂移——**这条门红成立**。
- **修**：`catalog.ts` GENERIC_SOLVER_CATALOG 补一条 `multisource_fusion` CatalogItem（name/description/argHints/domain）。
  catalog.test.ts 6/6 绿·全套 exit0。融合行为本身（测谎 SUSPECT + 7/7 + FDE）此前已验，仅目录注册欠账已补。

## BLOCK-2 DR-AUDIT（audit-sink 500 在本环境不复现·全套已绿）

- **接受审核方纪律点**：我 8f68d7f 只跑隔离未跑全套即称绿——**流程不严**，本次已按要求跑全套（exit0·859 passed）。
- **但 audit-sink 500 在本环境确不复现**：
  - 隔离跑 4 次 → 均 **6/6 绿**；全套跑 2 次（本轮 + 上轮）→ audit-sink 均 **6/6 绿**、全套 **exit0**。
  - reviewer 称「隔离也红」在本环境无法复现（同一 commit·fresh build）。
- **三处可疑抛点均核查安全**（reviewer 点名 cipher.encrypt / repos.auditSinks.put / sanitizeSink）：
  - `CredentialCipher`(crypto.ts)：`CREDENTIAL_KEY` 有合法 64-hex 默认(config.ts:17)，且构造器对任意 keyMaterial
    可构造(64hex 直用/否则 SHA-256 拉伸)，`encrypt` 用 `createCipheriv("aes-256-gcm",key,randomBytes(12))` 不抛。
  - `this.clock()`(audit-sink.ts:44)：默认 `() => new Date()`，永不 undefined。
  - `sanitizeSink`(app.ts:4065)：纯投影·无抛点·`credentialRef` 已脱敏 `cred:configured`(R5 守)。
- **判断**：reviewer 观测到的 500 属其环境特定（可能 Node/OpenSSL 版本或本地 env）·本环境代码路径全绿。
  **不改 audit-sink 代码**（无可复现缺陷·改反引入风险）。若 reviewer 复跑仍红，请附 datacore setErrorHandler
  记录的实际抛点 reason + stack + Node 版本，以便定位环境差异。

## 交付（全套 exit0 为凭·满足 C7 datacore 臂全绿）

- catalog.ts 补 multisource_fusion CatalogItem（MULTISRC 门红修）。
- audit-sink 代码不改（DR-AUDIT 本环境全绿·附全套证据）。
- `pnpm --filter datacore test` = **exit 0 · 859 passed · 0 failed**（catalog + audit-sink 均在其中绿）。
