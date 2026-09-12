import { z } from "zod";
import { ClassifierParseError } from "./anthropic.js";
import { harvestClassificationSlots, reportUnconsumedSlots } from "./slot-harvest.js";
import type { CompletionResp, CompletionReq, ParseReq, RawClassification } from "./types.js";

/**
 * 增量 §1.2 能力降级规则（按 provider.capabilities 声明自动选择）：
 * 无原生结构化输出 → JSON-mode 提示 + zod 校验失败重试 ≤2 次；仍失败返回 null /
 * 抛出该调用点的既有失败语义（分类 → ClassifierParseError → 路径 B）。
 *
 * 无原生 tools 不在此处理：该 provider 不可绑定 Agent 用途（绑定时校验拒绝），
 * 工具循环不做提示词模拟（质量不可控）。
 */

export const JSON_MODE_MAX_RETRIES = 2;

interface Completer {
  complete(req: CompletionReq): Promise<CompletionResp>;
}

/** 提取模型输出中的 JSON 对象（容忍 ```json 代码栅栏 / 前后说明文字）。 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const body = (fenced ? fenced[1] : trimmed) ?? "";
  try {
    return JSON.parse(body);
  } catch {
    // 兜底：截取首个 { 到最后一个 } 之间的内容
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

function jsonModeSystem(system: string, jsonSchema: unknown): string {
  return (
    `${system}\n\n` +
    "【输出格式要求】你必须只输出一个 JSON 对象（不要任何解释、前后缀或代码栅栏之外的文字），" +
    `严格符合以下 JSON Schema：\n${JSON.stringify(jsonSchema)}`
  );
}

/**
 * JSON-mode 结构化输出降级：首次请求 + zod 校验失败重试 ≤2（重试时附上校验错误）。
 * 全部失败 → null（调用方按既有失败语义处理）。
 */
export async function parseWithJsonModeDegradation<T>(client: Completer, req: ParseReq<T>): Promise<T | null> {
  const jsonSchema = z.toJSONSchema(req.schema as never, { target: "draft-7" });
  const system = jsonModeSystem(req.system, jsonSchema);
  let messages = req.messages.map((m) => ({ role: m.role, content: m.content }));
  for (let attempt = 0; attempt <= JSON_MODE_MAX_RETRIES; attempt++) {
    let text: string;
    try {
      const r = await client.complete({ model: req.model, system, messages, maxTokens: req.maxTokens });
      text = r.text;
    } catch {
      return null; // 传输层错误不属于解析重试范畴
    }
    const raw = extractJsonObject(text);
    if (raw !== undefined) {
      const parsed = req.schema.safeParse(raw);
      if (parsed.success) return parsed.data;
      messages = [
        ...messages,
        { role: "assistant" as const, content: text },
        {
          role: "user" as const,
          content: `上一条输出未通过 schema 校验：${parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}。请重新只输出一个符合 schema 的 JSON 对象。`,
        },
      ];
    } else {
      messages = [
        ...messages,
        { role: "assistant" as const, content: text },
        { role: "user" as const, content: "上一条输出不是合法 JSON。请重新只输出一个符合 schema 的 JSON 对象。" },
      ];
    }
  }
  return null;
}

/**
 * WO-SLOT-HARVEST · JSON-mode 降级路的**分类信封 schema**：只校验路由骨架（candidates + outOfCatalog），
 * 且**逐层 loose（不剔除未知键）** —— 这条路服务的正是"没有原生结构化输出"的兼容端点（Kimi/DeepSeek/vLLM 一类），
 * 也正是最爱把槽位塞进 `candidates[i].extractedSlots` 的那批。用旧的 `ClassificationSchema`（candidates 严格剔未知键
 * ＋ `extractedSlots` 必填）会**先删证据、再因缺字段判校验失败**：重试 2 次仍失败 → ClassifierParseError → 路径 B。
 * 槽位不由本 schema 负责，一律交 `harvestClassificationSlots`（单源）。
 */
const ClassificationEnvelopeSchema = z.looseObject({
  candidates: z.array(z.looseObject({ intentKey: z.string(), confidence: z.number() })).max(3),
  outOfCatalog: z.boolean(),
});

/** 分类调用点的 JSON-mode 降级（L3）：失败语义 = ClassifierParseError → 既有路径 B。 */
export async function classifyWithJsonModeDegradation(
  client: Completer,
  req: { model: string; system: string; user: string },
): Promise<RawClassification> {
  const out = await parseWithJsonModeDegradation(client, {
    model: req.model,
    system: req.system,
    messages: [{ role: "user", content: req.user }],
    schema: ClassificationEnvelopeSchema,
    maxTokens: 1024,
  });
  if (out == null) throw new ClassifierParseError();
  // 槽位走单源收割器（顶层/candidate × 对象/JSON 串四形态全收），收不掉的进 unconsumed 并落日志。
  const harvest = harvestClassificationSlots(out);
  reportUnconsumedSlots("degrade.classify", harvest);
  return {
    candidates: out.candidates.map((c) => ({ intentKey: c.intentKey, confidence: c.confidence })),
    outOfCatalog: out.outOfCatalog,
    extractedSlots: harvest.slots,
  };
}
