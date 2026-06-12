import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { createMemoryRepos } from "../src/repo/memory.js";
import { LocalFsBlobStore } from "../src/blob.js";
import { ScriptedLlmClient } from "../src/llm.js";
import { buildApp, type BuiltApp } from "../src/app.js";
import { seedDemo } from "../src/seed.js";
import type { AuthCtx } from "../src/domain.js";
import type { Repos } from "../src/repo/repo.js";

export interface TestApp extends BuiltApp {
  repos: Repos;
  llm: ScriptedLlmClient;
  adminCtx: AuthCtx;
}

export async function makeApp(opts?: { fetchImpl?: typeof fetch; seed?: boolean }): Promise<TestApp> {
  const blobDir = await mkdtemp(join(tmpdir(), "dc-test-"));
  const config = loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    BLOB_DIR: blobDir,
    JWT_SECRET: "test-secret",
  } as NodeJS.ProcessEnv);
  const repos = createMemoryRepos();
  const llm = new ScriptedLlmClient();
  const built = await buildApp({
    config,
    repos,
    blob: new LocalFsBlobStore(blobDir),
    llm,
    fetchImpl: opts?.fetchImpl,
  });
  let adminCtx: AuthCtx = { tenantId: "demo", userId: "usr_demo_admin", roles: ["admin"], attributes: {} };
  if (opts?.seed !== false) adminCtx = await seedDemo(repos);
  return { ...built, repos, llm, adminCtx };
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
