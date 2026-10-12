import { describe, expect, it } from "vitest";
import { createMemoryRepos } from "../src/repo/memory.js";
import { Metrics } from "../src/metrics.js";
import { ModelingService } from "../src/modeling.js";
import {
  LLM_PROVIDER_NOT_CONFIGURED,
  LLM_PROVIDER_UNAVAILABLE,
  createLlmClient,
  envLlmCredentialConfigured,
  llmProviderUnavailableError,
  type LlmClient,
} from "../src/llm.js";
import { AppError } from "../src/errors.js";
import type { AuthCtx, RawDataset } from "../src/domain.js";
import type { OntologyService } from "../src/ontology.js";

/**
 * WO-MODELING-NO-LLM · 无 LLM 供应商时 A3 建模建议必须落**语义错误码**，不是 SDK 英文原文。
 *
 * 病灶（2026-08-11 亲手真跑复现，内存模式 SEED_DEMO=1、零 provider、零 env 凭据）：
 *   POST /a/v1/modeling/suggest → 500 INTERNAL_ERROR，message =
 *   "Could not resolve authentication method. Expected one of apiKey, authToken, credentials,
 *    config, or profile to be set. ..."（Anthropic SDK 内部错，原样冒到用户 toast）。
 *
 * 本文件咬的是**链路**不是函数：真走 ModelingService.suggest → LlmClient，
 * 也就是 500 当初真正冒出来的那条路（不booting Fastify —— HTTP 信封那一半已由亲手起服务实测：
 * 无凭据 → 503 LLM_PROVIDER_NOT_CONFIGURED；env 有坏 key → 503 LLM_PROVIDER_UNAVAILABLE）。
 */

const ctx: AuthCtx = { tenantId: "demo", userId: "u1", roles: ["admin"], attributes: {} };

const ontologyStub = { listTypes: async () => [] } as unknown as OntologyService;

async function seedOneDataset(repos: ReturnType<typeof createMemoryRepos>): Promise<string> {
  const ds: RawDataset = {
    id: "rds_test_1",
    tenantId: "demo",
    name: "orders",
    sourceConnId: "conn_1",
    fields: [
      { name: "so", inferredType: "string", samples: ["SO-1"], nullRate: 0, uniqueRate: 1 },
      { name: "qty", inferredType: "number", samples: [10], nullRate: 0, uniqueRate: 0.4 },
    ],
    rowCount: 1,
    syncedAt: new Date().toISOString(),
  };
  await repos.rawDatasets.put(ds);
  await repos.rawRows.replace("demo", ds.id, [{ so: "SO-1", qty: 10 }]);
  return ds.id;
}

function makeModeling(llm: LlmClient): { svc: ModelingService; repos: ReturnType<typeof createMemoryRepos> } {
  const repos = createMemoryRepos();
  return { svc: new ModelingService(repos, llm, ontologyStub, new Metrics(), "test-model"), repos };
}

describe("WO-MODELING-NO-LLM · env 默认通道无凭据 ⇒ 语义码而非 SDK 原文", () => {
  it("链路：ModelingService.suggest 落 LLM_PROVIDER_NOT_CONFIGURED（不是 INTERNAL_ERROR/SDK 英文）", async () => {
    // 生产实参（seed/DEPLOY.md 记的形态）：DC_LLM_PROVIDER 未设 ⇒ anthropic 分支，且无任何 key。
    const saved = { ak: process.env.ANTHROPIC_API_KEY, at: process.env.ANTHROPIC_AUTH_TOKEN };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    try {
      const llm = createLlmClient({});
      const { svc, repos } = makeModeling(llm);
      const dsId = await seedOneDataset(repos);

      const err = await svc.suggest(ctx, [dsId]).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.code).toBe(LLM_PROVIDER_NOT_CONFIGURED);
      expect(appErr.statusCode).toBe(503);
      // 用户可见 message 必须是可操作中文，且**一个 SDK 内部词都不许有**。
      expect(appErr.message).toContain("LLM 供应商");
      for (const w of ["apiKey", "authToken", "Could not resolve authentication method", "X-Api-Key"]) {
        expect(appErr.message, `错误信封泄漏 SDK 内部词「${w}」`).not.toContain(w);
      }
      // 确定性建模（derive）不经 LLM —— 同一时刻它必须照常出草案（"旁边那个灰按钮其实能用"）。
      const draft = await svc.derive(ctx, [dsId]);
      expect(draft.suggestion.objectTypes.length).toBeGreaterThan(0);
    } finally {
      if (saved.ak === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved.ak;
      if (saved.at === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
      else process.env.ANTHROPIC_AUTH_TOKEN = saved.at;
    }
  });

  it("前置判据 envLlmCredentialConfigured：金丝雀（已知必中）+ 三种 provider 形态", () => {
    // 金丝雀：明明有 key 却报 false ⇒ 是判据坏了，不是"没配"。报否定结论前先自证工具。
    expect(envLlmCredentialConfigured({}, { ANTHROPIC_API_KEY: "k" } as NodeJS.ProcessEnv)).toBe(true);

    expect(envLlmCredentialConfigured({}, {} as NodeJS.ProcessEnv)).toBe(false);
    expect(envLlmCredentialConfigured({}, { ANTHROPIC_AUTH_TOKEN: "t" } as NodeJS.ProcessEnv)).toBe(true);
    // openai 兼容：认 OPENAI_API_KEY，不认 ANTHROPIC_API_KEY（度量的是"这条路的凭据"，不是"有没有任何 key"）
    expect(
      envLlmCredentialConfigured({ DC_LLM_PROVIDER: "openai_compatible" }, { ANTHROPIC_API_KEY: "k" } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      envLlmCredentialConfigured({ DC_LLM_PROVIDER: "openai_compatible" }, { OPENAI_API_KEY: "k" } as NodeJS.ProcessEnv),
    ).toBe(true);
    // DC_LLM_API_KEY_ENV 指名的变量优先
    expect(
      envLlmCredentialConfigured({ DC_LLM_PROVIDER: "openai", DC_LLM_API_KEY_ENV: "MY_KEY" }, { MY_KEY: "k" } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it("已配但打不通 ⇒ LLM_PROVIDER_UNAVAILABLE；no-secrets-echo：只带类名不带原始 message", () => {
    const raw = new Error("401 {\"x-api-key\":\"sk-ant-SECRET\"} Invalid API key");
    raw.name = "AuthenticationError";
    const wrapped = llmProviderUnavailableError(raw, "modeling") as AppError;
    expect(wrapped).toBeInstanceOf(AppError);
    expect(wrapped.code).toBe(LLM_PROVIDER_UNAVAILABLE);
    expect(wrapped.message).toContain("AuthenticationError");
    expect(wrapped.message).toContain("连接测试");
    // 原始 message（可能回显请求头/密钥）绝不许进对外信封；只挂 cause 供服务端日志。
    expect(wrapped.message).not.toContain("sk-ant-SECRET");
    expect(wrapped.message).not.toContain("Invalid API key");
    expect((wrapped as { cause?: unknown }).cause).toBe(raw);

    // 已是本层语义码 ⇒ 原样透传不二次包裹（否则 NOT_CONFIGURED 会被吞成 UNAVAILABLE）。
    const already = new AppError(LLM_PROVIDER_NOT_CONFIGURED, "未配置可用的 LLM 供应商", 503);
    expect(llmProviderUnavailableError(already, "modeling")).toBe(already);
  });
});
