import { describe, expect, it } from "vitest";
import { buildCapability, CapabilitySchema, deriveVerifiedStatus } from "@platform/contracts";
import { createMemoryRepos } from "../src/repo/memory.js";
import { CapabilityStore, CAPABILITY_TYPE, capabilityObjId } from "../src/capability/repo.js";
import { META_TENANT } from "../src/meta/service.js";

/**
 * WO-2（可信自我账 §3.1）：`Capability` 一等对象持久化——复用 objects 仓储（`__platform__` 元租户·不新建表·R9）。
 * 齿①：无 verifiedStatus setter，状态字恒经 deriveVerifiedStatus 派生。
 */
describe("Capability 对象持久化（复用 objects 仓储·__platform__·R9）", () => {
  it("upsert/get/list/remove 经 repos.objects 落 __platform__ 元租户（不新建表）", async () => {
    const repos = createMemoryRepos();
    const store = new CapabilityStore(repos);

    // 唯一构造路径：buildCapability → deriveVerifiedStatus（制品在+acceptance 跑+代表问答出 → VERIFIED）。
    const cap = buildCapability(
      { key: "shared_bottleneck", kind: "solver", claim: "回答基地瓶颈", representativeQuery: "常州基地的瓶颈是?" },
      { artifactExists: true, acceptanceRan: true, representativeAnswered: true },
    );
    expect(cap.verifiedStatus).toBe("VERIFIED");

    await store.upsert(cap);

    // 真落 objects 仓储：type=Capability，tenant=__platform__，origin META（与 Dogfooding 元层同库同租户）。
    const raw = await repos.objects.get(META_TENANT, capabilityObjId("shared_bottleneck"));
    expect(raw).toBeDefined();
    expect(raw!.type).toBe(CAPABILITY_TYPE);
    expect(raw!.tenantId).toBe(META_TENANT);
    expect(raw!.origin.type).toBe("META");

    // 读回等值（经契约再校验）。
    const got = await store.get("shared_bottleneck");
    expect(got).toEqual(cap);

    // listByType 命中。
    const all = await store.list();
    expect(all.map((c) => c.key)).toContain("shared_bottleneck");

    // R2：业务租户经 objects 仓储天然见不到 __platform__ 的 Capability。
    const bizView = await repos.objects.listByType("demo", CAPABILITY_TYPE);
    expect(bizView.length).toBe(0);

    await store.remove("shared_bottleneck");
    expect(await store.get("shared_bottleneck")).toBeUndefined();
  });

  it("齿①：无 verifiedStatus setter——仓储只持久化派生态，脏 props 读路径经契约拦截", async () => {
    const repos = createMemoryRepos();
    const store = new CapabilityStore(repos);
    // 无 setVerifiedStatus / 无写 verifiedStatus 的公开路径（结构性）。
    expect((store as unknown as Record<string, unknown>).setVerifiedStatus).toBeUndefined();

    // 即便有人绕 store 直塞脏对象（verifiedStatus 非法枚举），读路径经 CapabilitySchema 拒绝。
    await repos.objects.put({
      id: capabilityObjId("dirty"),
      tenantId: META_TENANT,
      type: CAPABILITY_TYPE,
      props: { key: "dirty", kind: "solver", claim: "x", representativeQuery: "q", acceptance: "", verifiedStatus: "HAND_WRITTEN", evidence: { kind: "NONE", detail: "" } },
      origin: { type: "META", source: "capability" },
    });
    await expect(store.get("dirty")).rejects.toThrow();
  });

  it("齿③（派生真值·防伪造）：deriveVerifiedStatus 真值表——代表问答不出恒非 VERIFIED（revert 派生→红）", () => {
    // 三真 → VERIFIED（唯一为真路径）。
    expect(deriveVerifiedStatus({ artifactExists: true, acceptanceRan: true, representativeAnswered: true }).verifiedStatus).toBe("VERIFIED");
    // 代表问答不出（无 LLM / 缺能力）→ 诚实 UNVERIFIED，绝不假 VERIFIED。
    expect(deriveVerifiedStatus({ artifactExists: true, acceptanceRan: true, representativeAnswered: false }).verifiedStatus).toBe("UNVERIFIED");
    // 制品不在 → 非 VERIFIED。
    expect(deriveVerifiedStatus({ artifactExists: false, acceptanceRan: true, representativeAnswered: true }).verifiedStatus).toBe("UNVERIFIED");
    // acceptance 未跑 → 非 VERIFIED。
    expect(deriveVerifiedStatus({ artifactExists: true, acceptanceRan: false, representativeAnswered: true }).verifiedStatus).toBe("UNVERIFIED");
    // 曾验证过、现重跑答不出 → STALE（漂移曝光）。
    expect(deriveVerifiedStatus({ artifactExists: true, acceptanceRan: true, representativeAnswered: false, priorVerified: true }).verifiedStatus).toBe("STALE");
    // VERIFIED 必挂 RUNTIME_PROBE 活证据（R-NO-FAKE-DONE）。
    const v = deriveVerifiedStatus({ artifactExists: true, acceptanceRan: true, representativeAnswered: true });
    expect(v.evidence.kind).toBe("RUNTIME_PROBE");
    // UNVERIFIED 未跑 → NONE（无活证据·诚实空态）。
    expect(deriveVerifiedStatus({ artifactExists: false, acceptanceRan: false, representativeAnswered: false }).evidence.kind).toBe("NONE");
  });

  it("契约：CapabilitySpec 无 verifiedStatus 字段——手打无路径（编译期 + 运行期均无入口）", () => {
    // buildCapability 只吃声明面（key/kind/claim/representativeQuery/acceptance），verifiedStatus 恒派生。
    const cap = buildCapability(
      { key: "k", kind: "feature", claim: "c", representativeQuery: "q" },
      { artifactExists: false, acceptanceRan: false, representativeAnswered: false },
    );
    expect(cap.verifiedStatus).toBe("UNVERIFIED"); // 无法手打成 VERIFIED
    expect(() => CapabilitySchema.parse(cap)).not.toThrow();
  });
});
