# REVIEW · DR-AUDIT（灾备备份 + 外部审计 SIEM sink·R27·cb36895）→ 门红 BLOCK（自身单测 4/6 红）

> 审核方逐条真跑。**DR-AUDIT 自身新增单测 `apps/datacore/test/audit-sink.test.ts` 6 测中 4 红**（PUT /a/v1/audit-sinks 返 500）→ `pnpm -r test` RED → C7「四包全绿」不过。按纪律「门红不核发」BLOCK 退 dev 修。

## 判决：⛔ BLOCK（audit-sink PUT 500·自身 4/6 单测红·C7 回归不绿）

## 门红实据（真跑）
| 测 | 结果 | 证据 |
|---|---|---|
| 配 sink→flush→SIEM NDJSON | ❌ | `audit-sink.test.ts:52 expect(put.statusCode).toBe(200)` → **实际 500**·PUT /a/v1/audit-sinks 崩 |
| secret 不回显(R5) | ❌ | `test:95 body[0].credentialRef` → **body[0] undefined**(GET /audit-sinks 空·sink 未落库·级联自 PUT 500) |
| 投递失败旁路吞(不 5xx) | ❌ | 同上级联(无 sink) |
| 游标续投不重投 | ❌ | 同上级联(无 sink) |
| 关 feature→404 FEATURE_NOT_FOUND | ✅ | R3 门控通过 |
| R2 租户隔离 | ✅ | 跨租户不外送通过 |

## 根因 + 修向（钉 file:line）
- **根因**：`apps/datacore/src/audit-sink.ts:66 this.cipher.encrypt(input.secret)`（AES-GCM 加密 secret 落 credentialRef）在**标准 `pnpm test` 环境抛** → PUT 500。cipher=`new CredentialCipher(config.CREDENTIAL_KEY)`(app.ts:329/358)·而 `makeApp()`(test/helpers.ts) **未设 CREDENTIAL_KEY** → 加密路径抛 → PUT 500 → sink 未落库 → 后 3 测 body[0] undefined 级联红。
- **修向**（dev·任一）：① `makeApp` 默认注入一个测试 CREDENTIAL_KEY（与其它凭据测一致·最省）；② 或 audit-sink PUT 在 cipher 不可用时优雅降级不 500；③ 或 audit-sink.test.ts 传 `env:{CREDENTIAL_KEY:...}`。修后 4 测须转绿。
- **附·修后需一并核**：`test:55 expect(sink.credentialRef).toBe("cred:configured")` 期望**脱敏标记** "cred:configured"，而 audit-sink.ts:66 产 `cipher.encrypt`="enc:v1:…" → **路由层须把响应 credentialRef 脱敏为 "cred:configured"**（R5 不回显 enc:v1 密文·test:57 `not.toContain("enc:v1:")`）。确认路由脱敏在，否则修 500 后仍红。
- **C7 回归**：因上 4 红·`pnpm -r test` 非全绿·C7 不过。C1/C2(pg_dump/restore·docker+pg)本环境 docker daemon 未起·未及真跑(修单测后连同复验)。`check-audit-actor` 门 14 项通过(接线在)。

## 结论
- **BLOCK 退 dev 修 audit-sink PUT 500**（凭据加密路径·makeApp CREDENTIAL_KEY）令 4 单测转绿 + 确认 credentialRef 脱敏"cred:configured"(R5)。修后 `pnpm -r test` 全绿 + 审核方复核 secret 不回显(R5)/旁路吞/游标续投 + C1/C2 pg 备份恢复(有 docker 环境)。
- reviewer 不代改 dev 代码·门红退回。

---
*审核方 DR-AUDIT 门红 BLOCK（audit-sink PUT 500·自身 4/6 单测红·R5 凭据加密路径·精确 file:line + 修向）· 仅推 `claude/vigilant-knuth-b1nmxn` · 模型标识不入任何提交物*
