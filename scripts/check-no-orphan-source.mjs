/**
 * 门 `no-orphan-source:check`（WO-SOURCE-TRANSPARENCY · 不变量 R-NO-ORPHAN-SOURCE · 消灭"走捷径"）：
 *
 * 立"无凭空源"结构不变量——凡来源为合成/物化（origin.type ∈ {SYNTHETIC, MATERIALIZED}）的对象
 * **必有可解析 rawDatasetId**（该 RawDataset 在本租户真实存在，进而"数据连接器"页可见、可下载 Excel）。
 * 这才是治本：防"合成对象凭空落库、绕过数据连接器可见源"的捷径回潮。
 *
 * 门体 = 真种电池合成数据（走"合成源→RawDataset→物化"正门）跑审计断言 0 凭空 + **green→red 自证**
 * （测试内故意植入无 rawDatasetId 的凭空对象 → 审计必抓出）。审计逻辑 `apps/datacore/src/no-orphan-source.ts`，
 * 测试 `apps/datacore/test/no-orphan-source.test.ts`（含导出端点真 .xlsx/.csv 回归 + R2 隔离）。
 *
 * 诚实豁免（非漏洞）：MANUAL（人工录入）/ META（系统本体自反投影）/ 时序（派生指标非源·非 ObjectInstance）。
 */
import { spawnSync } from "node:child_process";

console.log("· no-orphan-source：真种合成数据 → 审计每对象有可溯源 RawDataset（green→red 自证）…");
const res = spawnSync(
  "pnpm",
  ["--filter", "datacore", "exec", "vitest", "run", "test/no-orphan-source.test.ts"],
  { stdio: "inherit", shell: false },
);
if (res.status !== 0) {
  console.error("✗ no-orphan-source:check —— 存在凭空对象（无 rawDatasetId）或导出端点回归失败（违 R-NO-ORPHAN-SOURCE）。");
  process.exit(res.status ?? 1);
}
console.log("✓ no-orphan-source:check —— 无凭空对象（每合成/物化对象可溯回 RawDataset）+ 导出端点真 .xlsx/.csv + R2 隔离。");
