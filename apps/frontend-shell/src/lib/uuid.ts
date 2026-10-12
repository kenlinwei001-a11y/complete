/**
 * 安全 UUID（修 Bug·P0）：`crypto.randomUUID` 仅在**安全上下文**（https / localhost）存在。
 * 部署态 = 网关 nginx:80 明文 HTTP + 远程 IP/主机名 = **非安全上下文** → `crypto.randomUUID` 为 undefined，
 * 直接调用抛 `TypeError`。此前场景卡启动 / 查询提交 / 沙盘 / 历史重放（7 处）在部署态点即崩、页面卡死。
 *
 * 策略：① 有 `crypto.randomUUID` 用之（安全上下文·最佳）；② 退回 `crypto.getRandomValues`
 * （**非安全上下文也可用**）自拼 RFC4122 v4；③ 极端无 crypto 时 Math.random 兜底（仅保唯一性，
 * 用于本地 localId / Idempotency-Key，非加密用途）。
 */
export function safeUuid(): string {
  const c: Crypto | undefined = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") {
    try {
      return c.randomUUID();
    } catch {
      /* 某些环境 randomUUID 存在但受限 → 落到下一档 */
    }
  }
  if (c && typeof c.getRandomValues === "function") {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6]! & 0x0f) | 0x40; // version 4
    b[8] = (b[8]! & 0x3f) | 0x80; // variant 10
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
    return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
