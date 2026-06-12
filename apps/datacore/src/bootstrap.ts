import type { Logger } from "pino";
import { AuthService } from "./auth.js";
import type { Repos } from "./repo/repo.js";

export const DEFAULT_TENANT = "default";

export type BootstrapStatus =
  | "CREATED" // users 表为空 + 环境变量齐备 → 已创建 platform_admin
  | "SKIPPED_NONEMPTY" // users 表非空 → 幂等跳过（pg 重启 / 已有种子）
  | "BLOCKED"; // users 表为空且未配置环境变量 → /readyz 503（原因在日志明示）

/**
 * 管理平台增量 §1 Bootstrap（最高优先）。
 *
 * 启动顺序与优先级（server.ts 按此实现，DEPLOY.md 同步成文）：
 *   1. bootstrap 检查先于 SEED_DEMO 的播种决策执行：检查时刻 users 表为空 + 配置了
 *      BOOTSTRAP_ADMIN_EMAIL/BOOTSTRAP_ADMIN_PASSWORD → 在自动创建的 `default` 租户下
 *      创建 platform_admin（幂等：表非空则整体跳过）。
 *   2. 之后才执行 SEED_DEMO=1 的 demo 租户播种 —— 两者可叠加：BOOTSTRAP 创建超管、
 *      SEED_DEMO 创建演示账号，互不影响。
 *   3. 表为空 + 未配置 BOOTSTRAP 变量 + SEED_DEMO≠1（即播种后表仍为空）→ /readyz 503，
 *      日志明示原因（BOOTSTRAP_REQUIRED）；SEED_DEMO=1 播种出的演示账号使表非空 → 不 503。
 *
 * platform_admin 是唯一跨租户角色：建租户、建各租户首个 tenant_admin、管理行业模板；
 * 不出现在任何租户的业务数据策略中（authz.ts 对其一律拒绝业务数据访问）。
 */
export async function bootstrapPlatformAdmin(
  repos: Repos,
  env: { email?: string; password?: string },
  log: Logger,
): Promise<BootstrapStatus> {
  const total = await repos.users.countAll();
  if (total > 0) {
    log.debug({ users: total }, "bootstrap: users table non-empty, skipping (idempotent)");
    return "SKIPPED_NONEMPTY";
  }
  if (!env.email || !env.password) {
    log.error(
      "bootstrap: users 表为空且未配置 BOOTSTRAP_ADMIN_EMAIL/BOOTSTRAP_ADMIN_PASSWORD —— " +
        "无法创建平台超管；若 SEED_DEMO=1 将以演示账号继续，否则 /readyz 返回 503（BOOTSTRAP_REQUIRED）",
    );
    return "BLOCKED";
  }
  const now = new Date().toISOString();
  const tenant = await repos.tenants.get(DEFAULT_TENANT, DEFAULT_TENANT);
  if (!tenant) {
    await repos.tenants.put({
      id: DEFAULT_TENANT,
      tenantId: DEFAULT_TENANT,
      key: DEFAULT_TENANT,
      name: "平台默认租户",
      status: "ACTIVE",
      createdAt: now,
    });
  }
  await repos.users.put({
    id: `usr_${DEFAULT_TENANT}_platform_admin`,
    tenantId: DEFAULT_TENANT,
    username: env.email,
    email: env.email,
    displayName: "平台超管",
    passwordHash: await AuthService.hashPassword(env.password),
    roles: ["platform_admin"],
    attributes: {},
    status: "ACTIVE",
  });
  log.info({ email: env.email, tenant: DEFAULT_TENANT }, "bootstrap: platform_admin created");
  return "CREATED";
}

/**
 * /readyz 探针的 bootstrap 闸（动态判定，幂等）：users 表为空且未配置 BOOTSTRAP 变量
 * → 返回 503 原因字符串；否则 null（就绪）。
 */
export function bootstrapReadiness(repos: Repos, env: { email?: string; password?: string }) {
  return async (): Promise<string | null> => {
    if (env.email && env.password) return null;
    const total = await repos.users.countAll();
    if (total > 0) return null;
    return "BOOTSTRAP_REQUIRED: users 表为空且未配置 BOOTSTRAP_ADMIN_EMAIL/BOOTSTRAP_ADMIN_PASSWORD（或 SEED_DEMO=1）";
  };
}
