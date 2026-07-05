import type { AppConfig } from "../config.js";

/**
 * ONTO-SCEN-LAUNCH-DET（PRD-scenario-ontogenesis §2.5）：B→A 服务间角色通知。
 *
 * 复用 WO-ALERT 的 NotificationService 消费面（前端铃铛/通知中心=收件箱，refType/refId 深链）——
 * B 侧场景缺口开 GrowthTicket 后，经 A 的服务间路由 `POST /a/v1/notifications/notify-role`
 * （x-service-token，与 refs/report 同凭证范式）扇出给责任角色。fire-and-forget：
 * A 不可达不影响任务终态与工单落库（通知是旁路，不是真相源）。
 */
export interface RoleNotification {
  role: string;
  kind: string;
  title: string;
  body: string;
  refType?: string;
  refId?: string;
}

export type RoleNotifier = (tenantId: string, n: RoleNotification) => Promise<void>;

export function makeRoleNotifier(
  config: Pick<AppConfig, "DATACORE_BASE_URL" | "SERVICE_TOKEN">,
  fetchImpl: typeof fetch = fetch,
): RoleNotifier | undefined {
  const baseUrl = config.DATACORE_BASE_URL;
  const token = config.SERVICE_TOKEN;
  if (!baseUrl || !token) return undefined;
  return async (tenantId, n) => {
    try {
      await fetchImpl(`${baseUrl}/a/v1/notifications/notify-role`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-service-token": token,
          "x-tenant-id": tenantId,
          "x-service-caller": "agentcore",
        },
        body: JSON.stringify(n),
      });
    } catch {
      /* fire-and-forget：通知旁路失败不影响主流程 */
    }
  };
}
