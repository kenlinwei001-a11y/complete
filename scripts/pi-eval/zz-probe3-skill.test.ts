/**
 * 探针 v3：skills.md §Frontmatter 明列 7 个字段。真跑一遍，看解析后活下来几个。
 * 判据不是「代码里有没有这个词」，而是「写进 SKILL.md 之后，下游拿不拿得到」。
 */
import { describe, expect, it } from "vitest";
import { NodeExecutionEnv } from "../src/harness/env/nodejs.ts";
import { loadSkills } from "../src/harness/skills.ts";
import { createTempDir } from "./harness/session-test-utils.ts";

describe("PROBE3 · skills.md 文档字段 vs 实际解析", () => {
	it("把文档列出的 7 个 frontmatter 字段全写进去，看下游拿到什么", async () => {
		const root = createTempDir();
		const env = new NodeExecutionEnv({ cwd: root });
		await env.createDir(".agents/skills/full", { recursive: true });
		await env.writeFile(
			".agents/skills/full/SKILL.md",
			`---
name: full
description: All documented fields
license: MIT
compatibility: needs node 20
metadata:
  owner: platform-team
allowed-tools: read write bash
disable-model-invocation: false
---
body
`,
		);

		const { skills, diagnostics } = await loadSkills(env, ".agents/skills");
		const s = skills[0] as unknown as Record<string, unknown>;
		// eslint-disable-next-line no-console
		console.log(`PROBE3 diagnostics=${JSON.stringify(diagnostics)}`);
		// eslint-disable-next-line no-console
		console.log(`PROBE3 解析后的键=${JSON.stringify(Object.keys(s))}`);
		// eslint-disable-next-line no-console
		console.log(`PROBE3 allowedTools=${JSON.stringify(s["allowed-tools"] ?? s.allowedTools ?? null)}`);
		// eslint-disable-next-line no-console
		console.log(
			`PROBE3 license=${JSON.stringify(s.license ?? null)} compatibility=${JSON.stringify(s.compatibility ?? null)} metadata=${JSON.stringify(s.metadata ?? null)}`,
		);
		expect(skills.length).toBe(1);
	});

	it("写一个文档没有的垃圾字段，看是否报诊断（能不能发现拼写错误）", async () => {
		const root = createTempDir();
		const env = new NodeExecutionEnv({ cwd: root });
		await env.createDir(".agents/skills/typo", { recursive: true });
		await env.writeFile(
			".agents/skills/typo/SKILL.md",
			`---
name: typo
description: has a typo field
allowedtools: read write
totally-made-up-field: 12345
---
body
`,
		);
		const { skills, diagnostics } = await loadSkills(env, ".agents/skills");
		// eslint-disable-next-line no-console
		console.log(`PROBE3b diagnostics=${JSON.stringify(diagnostics)} skillsLoaded=${skills.length}`);
		expect(skills.length).toBeGreaterThanOrEqual(0);
	});
});
