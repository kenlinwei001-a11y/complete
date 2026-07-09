// UPG-L0-CONSOLE-BOARD E2E 辅助：本地 OpenAI 兼容 comprehend 桩（非 mock 数据·让 datacore 真 LLM 路径产出
// 一份「需要未注册求解器」的 BuildPlan → 真闭包引擎算出真实 CHAIN MISSING（真系统行为：LLM 提议平台尚无的能力）。
// 桩只把故事映射成结构化 comprehend 输出，闭包/持久化全部是 datacore 真逻辑——无合成/兜底真值（不作假）。
import { createServer } from "node:http";

const PORT = Number(process.env.STUB_PORT || 4399);

// comprehend 输出：建 Base（gwh/util 齐备→OBJECT/DATA 全 BOUND）+ 一个平台未注册的求解器需求
// sodium_yield_ramp_forecast（无别名→normalizeSolverKey 不收敛→CHAIN FAILED=真 MISSING 段）。
const COMPREHEND = {
  objectTypes: [
    {
      typeKey: "Base",
      displayName: "基地",
      domain: "factory",
      fields: [
        { name: "baseId", dataType: "string", isPrimaryKey: true },
        { name: "name", dataType: "string" },
        { name: "gwh", dataType: "number" },
        { name: "util", dataType: "number" },
      ],
    },
  ],
  rules: [],
  solverNeeds: [
    { solverKey: "sodium_yield_ramp_forecast", inputFields: [{ typeKey: "Base", propKey: "gwh" }] },
  ],
};

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url && req.url.endsWith("/chat/completions")) {
      const payload = {
        id: "chatcmpl-stub",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "stub-comprehend",
        choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(COMPREHEND) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unsupported" }));
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`comprehend-stub listening :${PORT}`));
