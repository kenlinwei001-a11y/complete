import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryRepos } from "../src/repo/memory.js";
import { LocalFsBlobStore } from "../src/blob.js";
import { CredentialCipher } from "../src/crypto.js";
import { Metrics } from "../src/metrics.js";
import { ConnectorService, type SyncCompletedInfo } from "../src/connectors/service.js";
import type { AuthCtx } from "../src/domain.js";

const ctx: AuthCtx = { tenantId: "t1", userId: "u1", roles: ["admin"], attributes: {} };

// 上游 CDC：无 since → 全量基线；带 since → 仅回 updatedAt>since 的更新行（同 ① 语义）。
const baseline = [
  { id: "A", name: "甲", updatedAt: "2026-01-01" },
  { id: "B", name: "乙", updatedAt: "2026-01-02" },
];
const updates = [
  { id: "B", name: "乙2", updatedAt: "2026-01-05" }, // 变更
  { id: "C", name: "丙", updatedAt: "2026-01-06" }, // 新增
];
const fetchImpl = (async (input: unknown) => {
  const since = new URL(String(input)).searchParams.get("since");
  const rows = since ? updates.filter((r) => r.updatedAt > since) : baseline;
  return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

async function makeSvc() {
  const repos = createMemoryRepos();
  const blobDir = await mkdtemp(join(tmpdir(), "dc-inc-"));
  const svc = new ConnectorService(repos, new LocalFsBlobStore(blobDir), new CredentialCipher("k".repeat(64)), new Metrics(), fetchImpl);
  const hookCalls: SyncCompletedInfo[] = [];
  svc.wire({ onSyncCompleted: async (_tid, info) => { hookCalls.push(info); } });
  return { repos, svc, hookCalls };
}

describe("WO-PIPE-INCR ② 调度自动增量 + sync 完成钩子", () => {
  it("auto 模式无须传 since：每数据集用自身 watermark 续传；钩子带 changedRows/incremental（changedRows=0 时下游可跳过重算）", async () => {
    const { repos, svc, hookCalls } = await makeSvc();
    const conn = await svc.createConnection(ctx, {
      connectorTypeKey: "rest_api",
      name: "orders-api",
      config: {
        url: "https://x.test/orders",
        datasetName: "orders",
        datasets: { orders: { pkField: "id", watermarkField: "updatedAt" } },
      },
    });

    // ① 首次 auto sync：无既有 watermark → 全量基线 2 行；钩子 incremental=false、watermark 落 2026-01-02。
    const j1 = await svc.sync(ctx, conn.id, { auto: true });
    expect(j1.rowCounts.orders).toBe(2);
    expect(hookCalls.at(-1)!.changedRows).toBe(2);
    expect(hookCalls.at(-1)!.incremental).toBe(false);
    expect(hookCalls.at(-1)!.watermarks.orders).toBe("2026-01-02");

    // ② 二次 auto sync：**不传 since** —— 服务用上次存的 watermark(2026-01-02) 自动续传 → 上游只回 B(改)+C(新)。
    const j2 = await svc.sync(ctx, conn.id, { auto: true });
    expect(j2.rowCounts.orders).toBe(2); // delta=2，非全量重灌
    expect(hookCalls.at(-1)!.incremental).toBe(true); // 自动续传走增量
    expect(hookCalls.at(-1)!.watermarks.orders).toBe("2026-01-06"); // 水位推进

    // 落库合并：A 留、B 覆盖、C 增 = 3 行（upsert by pk，非整表替换）。
    const ds = (await svc.listRawDatasets(ctx, conn.id)).find((d) => d.name === "orders")!;
    expect(ds.rowCount).toBe(3);
    const rows = await repos.rawRows.list(ctx.tenantId, ds.id);
    const byId = Object.fromEntries(rows.map((r) => [r.id as string, r]));
    expect(byId.A!.name).toBe("甲");
    expect(byId.B!.name).toBe("乙2");
    expect(byId.C!.name).toBe("丙");

    // ③ 三次 auto sync：上游 since=2026-01-06 无更早于此后的行 → 空 delta → changedRows=0（app 侧据此跳过 runDerivations）。
    const j3 = await svc.sync(ctx, conn.id, { auto: true });
    expect(j3.rowCounts.orders).toBe(0);
    expect(hookCalls.at(-1)!.changedRows).toBe(0);
    expect(hookCalls.at(-1)!.incremental).toBe(true); // 仍走增量路径，只是 delta 为空
    // 数据未被破坏（仍 3 行）。
    expect((await svc.listRawDatasets(ctx, conn.id)).find((d) => d.name === "orders")!.rowCount).toBe(3);
  });

  it("WO-PIPE-INCR ③ 删除墓碑：delta 行带删除标记 → 该 pk 本地真被移除·其余保留·watermark 推进·deleted 计数", async () => {
    const repos = createMemoryRepos();
    const blobDir = await mkdtemp(join(tmpdir(), "dc-inc-del-"));
    // 上游：无 since → 全量 3 行；带 since → 回 1 条带 _deleted 标记的 delta（删 B），watermark 在删除行后推进。
    const full = [
      { id: "A", name: "甲", updatedAt: "2026-01-01" },
      { id: "B", name: "乙", updatedAt: "2026-01-02" },
      { id: "C", name: "丙", updatedAt: "2026-01-03" },
    ];
    const delDelta = [{ id: "B", _deleted: true, updatedAt: "2026-01-09" }];
    const delFetch = (async (input: unknown) => {
      const since = new URL(String(input)).searchParams.get("since");
      const rows = since ? delDelta.filter((r) => r.updatedAt > since) : full;
      return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const svc = new ConnectorService(repos, new LocalFsBlobStore(blobDir), new CredentialCipher("k".repeat(64)), new Metrics(), delFetch);
    const hookCalls: SyncCompletedInfo[] = [];
    svc.wire({ onSyncCompleted: async (_t, info) => { hookCalls.push(info); } });

    const conn = await svc.createConnection(ctx, {
      connectorTypeKey: "rest_api",
      name: "orders-api",
      config: {
        url: "https://x.test/orders",
        datasetName: "orders",
        // 缺省删除约定：deleteField/deleteValue 均不配 → 看 _deleted === true。
        datasets: { orders: { pkField: "id", watermarkField: "updatedAt" } },
      },
    });

    // ① 全量基线 3 行（A/B/C），watermark=2026-01-03。
    const j1 = await svc.sync(ctx, conn.id, { auto: true });
    expect(j1.rowCounts.orders).toBe(3);
    expect(j1.deletedCounts).toBeUndefined(); // 全量无墓碑计数
    expect(hookCalls.at(-1)!.watermarks.orders).toBe("2026-01-03");

    // ② 二次 auto（用存的 watermark 续传）→ 上游回墓碑 delta（删 B）。
    const j2 = await svc.sync(ctx, conn.id, { auto: true });
    expect(j2.rowCounts.orders).toBe(1); // delta=1（那条墓碑行）
    expect(j2.deletedCounts!.orders).toBe(1); // 真按 pk 移除 1 行
    expect(hookCalls.at(-1)!.deletedRows).toBe(1);
    expect(hookCalls.at(-1)!.incremental).toBe(true);
    expect(hookCalls.at(-1)!.watermarks.orders).toBe("2026-01-09"); // 删除行的 wm 也推进水位

    // 落库：B 真被移除，A/C 保留 = 2 行（墓碑生效·非 upsert 保留）。
    const ds = (await svc.listRawDatasets(ctx, conn.id)).find((d) => d.name === "orders")!;
    expect(ds.rowCount).toBe(2);
    const rows = await repos.rawRows.list(ctx.tenantId, ds.id);
    const ids = rows.map((r) => r.id as string).sort();
    expect(ids).toEqual(["A", "C"]);
    expect(rows.find((r) => r.id === "B")).toBeUndefined(); // 该 pk 不在
  });

  it("WO-PIPE-INCR ③ 自定义 deleteField/deleteValue：CDC op=D 标记命中即移除", async () => {
    const repos = createMemoryRepos();
    const blobDir = await mkdtemp(join(tmpdir(), "dc-inc-del2-"));
    const full = [
      { id: "A", name: "甲", updatedAt: "2026-01-01", op: "I" },
      { id: "B", name: "乙", updatedAt: "2026-01-02", op: "I" },
    ];
    const delDelta = [{ id: "A", updatedAt: "2026-01-05", op: "D" }]; // op=D → 删 A
    const delFetch = (async (input: unknown) => {
      const since = new URL(String(input)).searchParams.get("since");
      const rows = since ? delDelta.filter((r) => r.updatedAt > since) : full;
      return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const svc = new ConnectorService(repos, new LocalFsBlobStore(blobDir), new CredentialCipher("k".repeat(64)), new Metrics(), delFetch);
    svc.wire({ onSyncCompleted: async () => {} });
    const conn = await svc.createConnection(ctx, {
      connectorTypeKey: "rest_api",
      name: "cdc",
      config: {
        url: "https://x.test/cdc",
        datasetName: "rows",
        datasets: { rows: { pkField: "id", watermarkField: "updatedAt", deleteField: "op", deleteValue: "D" } },
      },
    });
    await svc.sync(ctx, conn.id, { auto: true }); // 全量 2 行
    const j2 = await svc.sync(ctx, conn.id, { auto: true }); // op=D 删 A
    expect(j2.deletedCounts!.rows).toBe(1);
    const ds = (await svc.listRawDatasets(ctx, conn.id)).find((d) => d.name === "rows")!;
    const rows = await repos.rawRows.list(ctx.tenantId, ds.id);
    expect(rows.map((r) => r.id)).toEqual(["B"]); // A 被删·B 留
  });

  it("无 incremental 能力的连接器（mock_erp）即便 auto 也走全量 replace（向后兼容）", async () => {
    const { svc, hookCalls } = await makeSvc();
    const conn = await svc.createConnection(ctx, { connectorTypeKey: "mock_erp", name: "erp", config: {} });
    const j1 = await svc.sync(ctx, conn.id, { auto: true });
    // 全量：rowCounts=总行数（非 delta），incremental=false。
    expect(hookCalls.at(-1)!.incremental).toBe(false);
    const total1 = Object.values(j1.rowCounts).reduce((a, b) => a + b, 0);
    const j2 = await svc.sync(ctx, conn.id, { auto: true });
    const total2 = Object.values(j2.rowCounts).reduce((a, b) => a + b, 0);
    expect(total2).toBe(total1); // 二次仍全量（同行数·非 0 delta）
    expect(hookCalls.at(-1)!.incremental).toBe(false);
  });
});
