import type { BuiltApp } from "../src/app.js";
import type { ScriptedLlmClient } from "../src/llm.js";
import type { AuthCtx } from "../src/domain.js";
import type { Repos } from "../src/repo/repo.js";
import { createBareTestApp, ensureWorldSnapshot, restoreWorldFromSnapshot } from "./world-snapshot.js";

export interface TestApp extends BuiltApp {
  repos: Repos;
  llm: ScriptedLlmClient;
  adminCtx: AuthCtx;
}

export async function makeApp(opts?: { fetchImpl?: typeof fetch; seed?: boolean; env?: Record<string, string>; seeding?: () => boolean; bootstrapRequired?: () => Promise<string | null>; processClock?: () => Date }): Promise<TestApp> {
  // WO-SNAPSHOT-RESTORE：实现委托给 world-snapshot.createBareTestApp（同一实现逐行搬过去，
  // 放在那边是为了让快照构建器能造 app 而不与 helpers 形成 import 环）。签名与语义不变。
  return createBareTestApp(opts);
}

/** X-Debug-User header (dev auth fallback). */
export const debugUser = (tenant: string, user: string, roles: string) => ({
  "x-debug-user": `${tenant}:${user}:${roles}`,
});

export const ADMIN = debugUser("demo", "admin", "admin");
export const PLANNER = debugUser("demo", "planner", "planner");
export const BASE_MANAGER = debugUser("demo", "base_manager", "base_manager:常州");

export function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

/**
 * Seed the battery synthetic dataset (objects + links + 90d ts history + params + specs).
 *
 * WO-SNAPSHOT-RESTORE：默认走**快照还原**（同 (kind="base", seed) 的世界合成一次 → v8 字节 →
 * 各文件还原，构建点带双跑自证；还原 ≡ live 的等价论证与世界态非确定枚举见
 * world-snapshot.ts 头注与 docs/evidence/WO-SNAPSHOT-RESTORE-ledger.md §6/§10）。
 * 语义与今天的 live POST 逐字节相等（验收① 探针实证 seed 42/7 双证 unexpected=0），
 * 签名不变 ⇒ 808 个调用点零修改。
 *
 * 逃生口：`DC_SEED_LIVE=1` ⇒ 回到原 live POST 路径（真合成）—— 用于 before/after 对照测量、
 * 快照机制自身调试、以及怀疑快照失真时的一键复核。
 */
export async function seedBattery(t: TestApp, seed = 42): Promise<void> {
  if (process.env.DC_SEED_LIVE === "1") {
    const res = await t.app.inject({
      method: "POST",
      url: "/a/v1/synthetic/jobs",
      headers: ADMIN,
      payload: { industry: "battery-manufacturing", scale: "S", seed },
    });
    if (res.statusCode !== 202) throw new Error(`synthetic job failed: ${res.body}`);
    return;
  }
  const { buf } = await ensureWorldSnapshot("base", seed);
  await restoreWorldFromSnapshot(t.repos, buf);
}

// headers 显式标 Record<string, string>：不标时会从默认值 ADMIN 推成 `{ "x-debug-user": string }`，
// 于是调用方传别的租户头（或大小写不同的 "X-Debug-User"）就报 TS2345 —— 而 HTTP 头本就大小写无关。
export const invokeSolver = (t: TestApp, solverKey: string, args: Record<string, unknown>, headers: Record<string, string> = ADMIN) =>
  t.app.inject({ method: "POST", url: `/a/v1/solvers/${solverKey}/invoke`, headers, payload: { args } });

export const ORDERS_CSV = `so,cust,model,qty,due,status
SO-00001,星辰汽车,4680-NCM,1200,2026-07-15,OPEN
SO-00002,蓝海储能,S192-LFP,800,2026-07-20,OPEN
SO-00003,极光电动,4680-NCM,500,2026-08-01,CONFIRMED
SO-00004,星辰汽车,L300-NCM,950,2026-08-10,OPEN
SO-00005,云岭新能源,S192-LFP,300,2026-08-15,CONFIRMED
SO-00006,蓝海储能,4680-NCM,700,2026-09-01,OPEN
`;

export const MODELS_CSV = `modelId,modelName,chemistry
4680-NCM,4680 三元圆柱,NCM
S192-LFP,S192 储能电芯,LFP
L300-NCM,L300 三元长电芯,NCM
`;
