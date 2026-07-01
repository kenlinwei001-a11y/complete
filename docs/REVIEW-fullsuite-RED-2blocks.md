# REVIEW · 全套 datacore 回归红 → 2 单退回（含审核方自纠 MULTISRC-FUSION 过早 done）

> `pnpm --filter datacore test`（C7「四包全绿」判据的 datacore 臂·真跑）→ **Test Files 2 failed | 156 passed·Tests 5 failed | 854 passed·exit 1**。两处红：`catalog.test.ts`(1) + `audit-sink.test.ts`(4)。据「门红不核发」两单退回。**含审核方自纠**：我先前 MULTISRC-FUSION 标 done 未跑全套→漏 catalog 漂移，此处纠回。

## 硬证据（全套 datacore 真跑·C7 datacore 臂）
```
Test Files  2 failed | 156 passed | 2 skipped (160)
Tests  5 failed | 854 passed | 15 skipped (874)   exit=1
FAIL test/catalog.test.ts   (multisource_fusion 在 SOLVER_KEYS 未进 catalog)
FAIL test/audit-sink.test.ts (4/6·PUT /a/v1/audit-sinks 500)
```

## BLOCK-1 · MULTISRC-FUSION（审核方自纠·过早 done）
- **门红**：`apps/datacore/test/catalog.test.ts:54` `expect(new Set(reg.solvers.map(s=>s.key))).toEqual(new Set(SOLVER_KEYS))` → **红**。set diff 缺 `multisource_fusion`。
- **根因**：MULTISRC(27288da) 把 `multisource_fusion` 加进 `SOLVER_KEYS`(service.ts:126) 但**未加进求解器目录** `ALL_SOLVER_CATALOG`(`apps/datacore/src/catalog.ts`·grep=0)→ catalog≠SOLVER_KEYS 漂移→红（catalog 门守「新增求解器忘补目录描述即红」）。dev 首轮修了 `ontology-core` 计数(46→47)但**漏了 catalog 这条同类漂移**。
- **审核方自纠**：我先前 done MULTISRC 只复跑 `ontology-core generic_inference`(绿) **未跑全套 datacore**→漏 catalog.test.ts→**过早 done**。此为我方走捷径(未验 C7 全套绿即 done)，现纠回 BLOCK。**融合行为本身仍真跑通过**(FDE 原始 JSON 测谎 SUSPECT + 7/7 单测·无需重验)——**仅目录注册这条门红待补**。
- **一键修**（dev）：`catalog.ts` 给 `multisource_fusion` 补一条 `CatalogItem`(key+description+argHints·并入 SOLVER_CATALOG)→ catalog=SOLVER_KEYS→ catalog.test.ts 转绿。修后 `pnpm --filter datacore test` 应全绿。

## BLOCK-2 · DR-AUDIT（dev 争议不成立·全套硬证）
- dev 8f68d7f 称「audit-sink.test.ts 当前 HEAD 6/6 绿·reviewer 归因不成立」，但 8f68d7f **只改 docs+队列·未改代码**。
- **审核方全套真跑复核**（HEAD d5838d6）：`audit-sink.test.ts` **6 tests | 4 failed**（隔离跑 + 全套 datacore 跑**均红**·非隔离伪影）→ dev「6/6 绿」**factually 不成立**。
- **门红**：`audit-sink.test.ts:52` PUT /a/v1/audit-sinks **返 500**(expected 500 to be 200)→ sink 未落库→secret/flush/游标 3 测 body[0] undefined 级联红。
- **诚实纠正我方先前归因**：我先前归因「makeApp 未设 CREDENTIAL_KEY」**不精确**——`CREDENTIAL_KEY=… vitest` 重跑仍 4/6 红·`clock` 已默认注入。**500 真因需 dev 亮 app 端错误日志**(datacore setErrorHandler 记的 reason·test 层未透出)。但 **PUT 500 / 4 测红 这一事实 稳**(全套 exit1)。
- **修向**（dev）：亮 PUT setSink 500 的实际抛点(cipher.encrypt / repos.auditSinks.put / sanitizeSink 三者之一)·修至 PUT 200·4 测转绿·并确认 credentialRef 脱敏"cred:configured"(R5)。

## 结论
- **两单退回 BLOCK**·`pnpm --filter datacore test` exit1(5 红)→ C7 datacore 臂不绿。
- **审核方自纠纪律**：MULTISRC done 未跑全套=我方走捷径·主动纠回·这正是本项目要防的「绿(局部)测试≠能用(全套)」。以后 done 前必跑全套 `pnpm -r test` 确认零红。

---
*审核方 2 门红退回（全套 datacore exit1·catalog 漂移 + audit-sink 500·含审核方自纠 MULTISRC 过早 done + 诚实纠正 DR-AUDIT 归因）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
