import { describe, expect, it } from "vitest";
import { projectFdeNodes, FDE_NODES } from "../src/databuilder/fde-graph.js";

/**
 * 增量3 · E15 B 栈制品入启动器闭环：fde-graph node8 launcher 从 NONE 升为**有产物+判据**。
 *  - 产物：scaffoldManifest 中 module=scene 的项 = 注册进启动器的场景卡（io.out）；
 *  - 判据(SOFT)：有答案 = 启动器可答；场景仍 PENDING_BSTACK（单机/未配 AGENTCORE）→ 诚实标
 *    LAUNCHER_PENDING_BSTACK（卡定义可见、本地可答，但未真注册进 QOS 启动器，不静默假装已全注册）。
 *  - 全注册（fullChainOk）→ 无缺口码。
 */

const baseDoneCtx = (extra: Record<string, unknown> = {}) => ({
  planId: "bpl_1", aOk: true, bOk: true,
  built: true, producedConnections: ["c1"], producedDatasets: ["d1"],
  closureReport: { gatePassed: true, findings: [], objectsBound: 3, dataOrphans: 0, forwardMissing: 0, chainBroken: 0, shapeBroken: 0 },
  answer: "推演结果非空",
  ...extra,
});

describe("增量3 · E15 launcher 节点（有产物+判据）", () => {
  it("launcher gateKind 升为 SOFT（不再 NONE）—— 启动器就绪是判据节点", () => {
    const def = FDE_NODES.find((d) => d.key === "launcher")!;
    expect(def.gateKind).toBe("SOFT");
    expect(def.drilldownRef).toBe("answer");
  });

  it("场景仍 PENDING_BSTACK（单机）→ launcher DONE 但诚实标 LAUNCHER_PENDING_BSTACK + io.out=场景卡数", () => {
    const ctx = baseDoneCtx({
      scaffoldManifest: {
        pendingBstack: true,
        items: [
          { module: "scene", key: "scene_a", status: "PENDING_BSTACK" },
          { module: "scene", key: "scene_b", status: "PENDING_BSTACK" },
          { module: "agent", key: "agt_a", status: "PENDING_BSTACK" },
        ],
      },
    });
    const launcher = projectFdeNodes({ context: ctx }).find((n) => n.key === "launcher")!;
    expect(launcher.status).toBe("DONE"); // 本地可答
    expect(launcher.io?.out).toBe(2); // 2 个 scene 卡（agent 不计入场景卡数）
    expect(launcher.gapCode).toBe("LAUNCHER_PENDING_BSTACK"); // 诚实：待 B 注册进 QOS 启动器
    expect(launcher.detail).toContain("待 B 对账");
  });

  it("场景全注册（pendingBstack=false）→ launcher DONE 无缺口码（真注册进启动器）", () => {
    const ctx = baseDoneCtx({
      scaffoldManifest: {
        pendingBstack: false,
        items: [
          { module: "scene", key: "scene_a", status: "SCAFFOLDED" },
          { module: "scene", key: "scene_b", status: "REUSED" },
        ],
      },
    });
    const launcher = projectFdeNodes({ context: ctx }).find((n) => n.key === "launcher")!;
    expect(launcher.status).toBe("DONE");
    expect(launcher.gapCode).toBeUndefined();
    expect(launcher.io?.out).toBe(2);
  });

  it("无 scaffoldManifest（有答案）→ launcher 产物兜底 io.out>=1，不报 PENDING_BSTACK", () => {
    const launcher = projectFdeNodes({ context: baseDoneCtx() }).find((n) => n.key === "launcher")!;
    expect(launcher.status).toBe("DONE");
    expect(launcher.io?.out).toBeGreaterThanOrEqual(1);
    expect(launcher.gapCode).toBeUndefined();
  });

  it("R6 确定性：同 context 两次投影 launcher 字节一致", () => {
    const ctx = baseDoneCtx({ scaffoldManifest: { pendingBstack: true, items: [{ module: "scene", key: "s", status: "PENDING_BSTACK" }] } });
    const a = JSON.stringify(projectFdeNodes({ context: ctx }).find((n) => n.key === "launcher"));
    const b = JSON.stringify(projectFdeNodes({ context: ctx }).find((n) => n.key === "launcher"));
    expect(a).toBe(b);
  });
});
