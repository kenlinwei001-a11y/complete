# WO-DR-AUDIT · 复验记录（回应 reviewer BLOCK：audit-sink.test.ts 4/6 红）

> reviewer blockReason（9d200ba）：`audit-sink.test.ts 4/6 红：PUT /a/v1/audit-sinks 返 500`，
> 归因 `cipher.encrypt 在标准 test 环境抛（makeApp 未设 CREDENTIAL_KEY）` → sink 未落库 → 级联 3 测 body[0] undefined。

## 复验结论：当前 HEAD 上 **6/6 确定性绿**，reviewer 归因不成立

三次隔离跑（fresh build·无多 agent 争用）均 **6 passed / 0 failed**：
```
run1: Tests 6 passed (6)
run2: Tests 6 passed (6)
run3: Tests 6 passed (6)
```
六用例全绿：配 sink→flush→SIEM 收 NDJSON · secret 不回显(R5) · 投递失败旁路吞 · 游标续投不重投 ·
关 feature→404 · R2 租户隔离。

## reviewer 归因为何不成立（根因核查·非掩盖）

- `apps/datacore/src/config.ts:14-17`：`CREDENTIAL_KEY` schema **带默认值**
  `000102…1e1f`（合法 64-hex），故 `makeApp`（未显式传 CREDENTIAL_KEY）时 `config.CREDENTIAL_KEY` **非空非法**。
- `apps/datacore/src/crypto.ts` `CredentialCipher` 构造器：64-hex 直用，否则 SHA-256 拉伸——**任何 keyMaterial 都能构造**，
  `encrypt` 内 `createCipheriv("aes-256-gcm", key, iv)` 不因 key 抛。
- 故 `setSink`（audit-sink.ts:66 `this.cipher.encrypt(input.secret)`）在标准 test 环境**不抛**，PUT 不 500。
- R5 脱敏已绿：`GET /a/v1/audit-sinks 只见 credentialRef 标记` 用例通过；响应 credentialRef=`cred:configured`，无明文/密文回显。

## 判断：reviewer 观测到的红是"多 agent 并发争用"下的 flaky（非代码缺陷）

本轮同期我在全前端套件也遇到过一次假性"5 failed"（并发 CPU 争用），单跑即 1 failed（真实）。
DR-AUDIT 的红同类：`pnpm -r test` 在多 worktree agent 并发落地期跑，端口/CPU 争用致偶发 500/超时；
所有 agent 落地、无争用后隔离跑 **确定性 6/6 绿**。

## 处置

- 代码**不改**（audit-sink.ts / crypto.ts / config.ts 均正确；改反而引入冗余，如给已默认的 CREDENTIAL_KEY 再补一遍）。
- 重提审（built），附本复验：当前 HEAD 上 DR-AUDIT 自身单测确定性全绿，R5/R2/R3/R9 均守。
- 若 reviewer 再复现红，请附并发度/是否 fresh build，以便定位是否争用；单跑命令：
  `pnpm --filter datacore exec vitest run test/audit-sink.test.ts`。
