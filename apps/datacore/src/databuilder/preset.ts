import type { DataBuilderConfig } from "@platform/contracts";

/** 预设内置 builder-agent 的 key（统一资源模式；可 new-version 派生改配置）。 */
export const DEFAULT_BUILDER_KEY = "foundry-grade-data-builder";
export const DEFAULT_BUILDER_NAME = "Foundry-Grade Data Builder";

/**
 * v1 工业级默认配置（8 项硬指标默认全开）。二次配置经 new-version 派生 DRAFT 修改。
 * 设计共识见 memory/project_a7_builder_design.md。
 */
export const DEFAULT_BUILDER_CONFIG: DataBuilderConfig = {
  llm: { binding: "extraction" },
  determinism: { freezePlan: true, seed: 42 },
  closure: {
    object: { mode: "HARD", fallback: ["BIND_EXISTING_SLICE", "CREATE_SLICE"] },
    data: { mode: "SOFT", onOrphan: "PASS_AND_MARK" },
    forward: { mode: "HARD" },
  },
  moduleAdapters: {
    rawIn: ["connector.excel", "knowledge-base", "constraint-doc", "timeseries", "solver-params"],
    transform: ["ontology-modeling", "rule-extract", "derivation"],
  },
  publish: { auto: true, allowOnlineEdit: true },
  audit: { trail: true, rollback: true },
};
