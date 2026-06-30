import type { ActionDraft } from "./domain.js";
import type { Repos } from "./repo/repo.js";
import type { ActionExecutor } from "./actions.js";
import { newId } from "./ids.js";
import { hashString } from "./prng.js";

/**
 * WO-ACTUATE · 决策出站写回适配器（S2 写回适配器的具体实现）。
 *
 * 决策（求解器/沙盘出的行动建议）经 R4 审批 EXECUTED 后，经一个可插拔"写回适配器"出站。
 * 现期 mock（确定性 echo + 回声对账 + 诚实标"写到 MOCK 非真 ERP"·R13）；真 ERP 协议留 config
 * 选择的一等 stub（未配端点诚实 WRITEBACK_NOT_CONFIGURED·不冒充真写）。
 *
 * `ActionExecutor`（actions.ts）= 本写回适配器接口（保留历史名向后兼容）；本文件落两个一等实现。
 */

/**
 * A. Mock 写回适配器（增强自历史 MockActionExecutor）。
 *
 * 与历史实现的差异：execute 成功后**自动 `repos.writebackEchoes.put`** 落写回值（ref=targetRef、
 * writtenValue=payload 快照）→ 使 `POST /a/v1/writeback-echoes/reconcile` 闭环不再靠手动 POST。
 * 确定性（R6）：targetRef/ref 由 `draft.id` hash 定，无时钟/随机。租户隔离（R2）：echo 带 draft.tenantId。
 */
export class MockWritebackAdapter implements ActionExecutor {
  readonly kind = "MOCK" as const;

  constructor(private readonly repos: Repos) {}

  /** 确定性 targetRef（由 draft.id hash 派生，与历史 MockActionExecutor 字节一致 R6）。 */
  static targetRefFor(draft: ActionDraft): string {
    return `MO-2026-${String(1000 + (hashString(draft.id) % 9000))}`;
  }

  async execute(
    draft: ActionDraft,
  ): Promise<{ ok: boolean; targetRef: string; target: { kind: "MOCK"; system: string } }> {
    const targetRef = MockWritebackAdapter.targetRefFor(draft);
    // 自动落写回回声：ref=targetRef（源系统对账锚），writtenValue=payload 快照（写回值）。
    await this.repos.writebackEchoes.put({
      id: newId("wbe"),
      tenantId: draft.tenantId,
      ref: targetRef,
      writtenValue: draft.payload,
      writtenAt: new Date().toISOString(),
      actionId: draft.id,
    });
    return { ok: true, targetRef, target: { kind: "MOCK", system: "mock-writeback" } };
  }
}

/**
 * C. 真 ERP REST 写回适配器 stub（`ErpRestWritebackAdapter`）。
 *
 * 未配 `WRITEBACK_ERP_BASE_URL` → execute 返 `{ok:false,error:"WRITEBACK_NOT_CONFIGURED"}`
 * （诚实降级·仿 `solvers/optimizer-client.ts` 的 OPTIMIZER_BASE_URL 未配范式·绝不假装写成功）。
 * 配了则按下方 REST 契约 `POST {baseUrl}/writeback` 出站；**body/响应映射实现留 TODO**（接口契约
 * 此处定义清楚·待真 ERP 接入再填）——本期系统全离线、无真 ERP 端点可写可验，真实现 = vaporware。
 *
 * REST 契约（待真 ERP 接入实现）：
 *   POST {baseUrl}/writeback
 *   Headers: content-type: application/json[, authorization: Bearer <token-from-credentialRef>]
 *   Body: { actionId, tenantId, actionTypeKey, payload }
 *   200 → { ok:true, targetRef:string }   非 2xx → { ok:false, error:string }
 *
 * 凭据（若 ERP 需鉴权）：经 credentialRef 取 AES-GCM 解密的密钥（no-secrets-echo·R5·绝不回显明文）；
 *   本 stub 不接受/不持有明文密钥参数。
 */
export class ErpRestWritebackAdapter implements ActionExecutor {
  readonly kind = "ERP_REST" as const;

  constructor(private readonly baseUrl?: string) {}

  async execute(
    draft: ActionDraft,
  ): Promise<{ ok: boolean; targetRef?: string; error?: string; target: { kind: "ERP_REST"; system: string } }> {
    const target = { kind: "ERP_REST" as const, system: "erp-rest" };
    if (!this.baseUrl) {
      // 诚实降级：未配真 ERP 端点 → 不冒充写成功（R13）。
      return { ok: false, error: "WRITEBACK_NOT_CONFIGURED", target };
    }
    // ── 真 ERP 接入再填（接口契约见上）。本期无真端点可写可验，故 stub。 ──
    // TODO(真 ERP 接入)：按 REST 契约 POST {baseUrl}/writeback；解析 200→targetRef / 非2xx→error。
    //   凭据经 credentialRef AES-GCM 解密后置入 Authorization（no-secrets-echo·R5）。
    //   const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/writeback`, {
    //     method: "POST",
    //     headers: { "content-type": "application/json" },
    //     body: JSON.stringify({ actionId: draft.id, tenantId: draft.tenantId,
    //       actionTypeKey: draft.actionTypeKey, payload: draft.payload }),
    //   });
    //   if (!res.ok) return { ok: false, error: `erp ${res.status}`, target };
    //   const body = (await res.json()) as { targetRef?: string };
    //   return { ok: true, targetRef: body.targetRef, target };
    return { ok: false, error: "WRITEBACK_ERP_STUB_NOT_IMPLEMENTED", target };
  }
}

/** D. config 选择：按 `WRITEBACK_TARGET` 构造写回适配器（默认 mock）。 */
export function buildWritebackAdapter(
  target: "mock" | "erp_rest",
  repos: Repos,
  erpBaseUrl?: string,
): ActionExecutor {
  return target === "erp_rest" ? new ErpRestWritebackAdapter(erpBaseUrl) : new MockWritebackAdapter(repos);
}
