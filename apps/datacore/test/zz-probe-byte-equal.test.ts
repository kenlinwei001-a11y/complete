// WO-SNAPSHOT-RESTORE 验收①（审核硬条件 1）：还原 vs 新鲜合成逐字节相等 —— seed=42 与 seed=7 双证。
// 口径 = canonicalizeForDiff 归一化（随机 id 引用图）+ DIFF_POLICY（叶子级墙钟/盐），
// 与构建点双跑自证同一套 —— 两套非确定维度之外，其余全部 strict 逐字节。
// seed=7 是全套件 808 个 seedBattery 调用点里唯一的非 42 种子（simclock.test.ts T6），
// 专门防「快照键丢了 seed 维度 ⇒ 42 的字节喂给 7」这一假绿形态。测完即删 —— 证据落账本。
import { expect, test } from "vitest";
import {
  canonicalizeForDiff,
  createBareTestApp,
  diffTables,
  dumpReposToTables,
  ensureWorldSnapshot,
  postSyntheticJob,
  restoreWorldFromSnapshot,
} from "./world-snapshot.js";

for (const seed of [42, 7]) {
  test(`byte-equal: restore ≡ fresh synthesis (seed=${seed})`, async () => {
    const t0 = Date.now();

    // ① 新鲜合成（live 路径：真 POST /a/v1/synthetic/jobs，与 808 个调用点今天走的路逐字节相同）
    const fresh = await createBareTestApp();
    await postSyntheticJob(fresh, seed);
    const freshTables = dumpReposToTables(fresh.repos);
    await fresh.app.close();

    // ② 快照还原（同 seed 的另一副全新 repos；首调触发双跑自证构建，之后读盘）
    const snap = await ensureWorldSnapshot("base", seed);
    const restored = await createBareTestApp();
    await restoreWorldFromSnapshot(restored.repos, snap.buf);
    const restoredTables = dumpReposToTables(restored.repos);
    await restored.app.close();

    // ③ 归一化 + 默认口径比对（两个入参都是一次性副本，归一化的原地改写无后患）
    const report = diffTables(canonicalizeForDiff(freshTables), canonicalizeForDiff(restoredTables), undefined, 200);
    console.log(
      `BYTE_EQUAL seed=${seed} unexpected=${report.unexpected.length} ignored=${report.ignored.length} ` +
        `snapBuilt=${snap.built} ms=${Date.now() - t0}` +
        (report.unexpected.length > 0 ? `\n  ${report.unexpected.slice(0, 40).join("\n  ")}` : ""),
    );
    expect(report.unexpected, `seed=${seed} 还原与新鲜合成不一致（差异见上）`).toEqual([]);
  }, 600_000);
}
