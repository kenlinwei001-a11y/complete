import type { OpsPlaybook, VirtualPersona } from "@platform/contracts";
import { OpsPlaybookSchema, VirtualPersonaSchema } from "@platform/contracts";
import type { AuthCtx, User } from "../domain.js";
import type { Repos } from "../repo/repo.js";
import { AuthService } from "../auth.js";
import { AppError } from "../errors.js";
import { DEFAULT_PERSONAS, DEFAULT_PLAYBOOK } from "./defaults.js";

const VIRTUAL_PROD = () =>
  new AppError(
    "VIRTUAL_OPS_FORBIDDEN",
    "虚拟操作团队 / OpsPlaybook 仅可挂在 origin=SYNTHETIC 的租户（与 FORGE_ALLOW_PROD 同闸）",
    403,
  );

/**
 * §1 虚拟操作团队 + §2 OpsPlaybook 挂载 + §3-⑥ 隔离。
 *
 * 隔离红线：仅 origin=SYNTHETIC 的租户可挂 OpsPlaybook / 建虚拟账号；真实租户禁止
 * （与 FORGE_ALLOW_PROD 同闸）。判定：租户存在 lived-in 运营态记录，或任一对象
 * origin=SYNTHETIC（即由合成产出）。FORGE_ALLOW_PROD=1 时放开（演示/压测逃生阀）。
 */
export class OpsTeamService {
  constructor(
    private repos: Repos,
    private allowProd: boolean,
  ) {}

  /** 隔离判定：该租户是否允许挂虚拟操作（SYNTHETIC origin 或 FORGE_ALLOW_PROD）。 */
  async isSyntheticTenant(tenantId: string): Promise<boolean> {
    if (this.allowProd) return true;
    const lived = await this.repos.livedInStates.get(tenantId, tenantId);
    if (lived) return true;
    const synthObj = await this.repos.objects.list(tenantId, (o) => o.origin.type === "SYNTHETIC");
    return synthObj.length > 0;
  }

  private async assertSynthetic(tenantId: string): Promise<void> {
    if (!(await this.isSyntheticTenant(tenantId))) throw VIRTUAL_PROD();
  }

  /** 随运营态合成创建默认 6 人虚拟团队（与真人同 User 表，isVirtual:true、登录禁用）。 */
  async seedDefaultPersonas(tenantId: string): Promise<VirtualPersona[]> {
    await this.assertSynthetic(tenantId);
    return this.createPersonas(tenantId, DEFAULT_PERSONAS);
  }

  async createPersonas(tenantId: string, personas: VirtualPersona[]): Promise<VirtualPersona[]> {
    await this.assertSynthetic(tenantId);
    const out: VirtualPersona[] = [];
    // 固定不可登录口令哈希（isVirtual 登录禁用，但哈希字段非空以满足 User 形态）。
    const lockedHash = await AuthService.hashPassword(`virtual-no-login-${tenantId}`);
    for (const p of personas) {
      const persona = VirtualPersonaSchema.parse(p);
      const user: User = {
        id: `usr_${tenantId}_${persona.username}`,
        tenantId,
        username: persona.username,
        passwordHash: lockedHash,
        roles: persona.roles,
        attributes: { ...persona.attributes, isVirtual: true, styleSeed: persona.styleSeed, displayName: persona.displayName ?? persona.username },
        status: "DISABLED", // 登录禁用（交互登录被拒）
      };
      await this.repos.users.put(user);
      out.push(persona);
    }
    return out;
  }

  async listPersonas(tenantId: string): Promise<VirtualPersona[]> {
    const users = await this.repos.users.list(tenantId, (u) => u.attributes?.isVirtual === true);
    return users
      .sort((a, b) => (a.username < b.username ? -1 : 1))
      .map((u) => ({
        username: u.username,
        roles: u.roles,
        attributes: u.attributes,
        isVirtual: true as const,
        styleSeed: Number(u.attributes.styleSeed ?? 0),
        ...(typeof u.attributes.displayName === "string" ? { displayName: u.attributes.displayName } : {}),
      }));
  }

  /** persona username → 真实 AuthCtx（roles/attributes 行级，OBO 全链与真人一致）。 */
  async resolvePersonaCtx(tenantId: string, username: string): Promise<AuthCtx | undefined> {
    const u = (await this.repos.users.list(tenantId, (x) => x.username === username))[0];
    if (!u) return undefined;
    return { tenantId, userId: u.id, roles: u.roles, attributes: u.attributes };
  }

  // ---- OpsPlaybook 挂载（场景包内容，版本化；存为 lived-in 元数据扩展） ---------

  /** 挂载 OpsPlaybook（仅 SYNTHETIC 租户）。存于 ops_schedules 表外的对象层避免新表。 */
  async putPlaybook(tenantId: string, playbook: OpsPlaybook): Promise<OpsPlaybook> {
    await this.assertSynthetic(tenantId);
    const pb = OpsPlaybookSchema.parse(playbook);
    await this.repos.objects.put({
      id: `obj_opsplaybook_${tenantId}`,
      tenantId,
      type: "OpsPlaybook",
      props: pb as unknown as Record<string, unknown>,
      origin: { type: "SYNTHETIC", jobId: `opsplaybook-${tenantId}` },
    });
    return pb;
  }

  async seedDefaultPlaybook(tenantId: string): Promise<OpsPlaybook> {
    return this.putPlaybook(tenantId, DEFAULT_PLAYBOOK);
  }

  async getPlaybook(tenantId: string): Promise<OpsPlaybook | null> {
    const obj = await this.repos.objects.get(tenantId, `obj_opsplaybook_${tenantId}`);
    if (!obj) return null;
    return OpsPlaybookSchema.parse(obj.props);
  }
}
