import { spawn } from "node:child_process";
const run = (name, args) => {
  const p = spawn("npx", ["tsx", args], { stdio: "inherit", env: process.env });
  p.on("exit", c => { console.log(`[${name}] exited ${c}`); process.exit(c ?? 1); });
};
run("datacore", "apps/datacore/src/index.ts");
setTimeout(() => run("agentcore", "apps/agentcore/src/index.ts"), 600);
