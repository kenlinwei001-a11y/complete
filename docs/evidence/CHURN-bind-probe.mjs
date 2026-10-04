import net from "node:net";
const ports = [5051, 5052, 5053, 5054];
const out = [];
for (const p of ports) {
  const r = await new Promise((res) => {
    const s = net.createServer();
    s.once("error", (e) => res({ port: p, ok: false, code: e.code }));
    s.listen(p, "127.0.0.1", () => s.close(() => res({ port: p, ok: true })));
  });
  out.push(r);
  console.log(`${r.port} ${r.ok ? "FREE(bind succeeded)" : "BUSY " + r.code}`);
}
// 金丝雀：对一个必然占用的端口 bind 必须失败 —— 证明探针有鉴别力
const ctrl = await new Promise((res) => {
  const held = net.createServer();
  held.listen(0, "127.0.0.1", () => {
    const hp = held.address().port;
    const s2 = net.createServer();
    s2.once("error", (e) => { held.close(); res({ port: hp, ok: false, code: e.code }); });
    s2.listen(hp, "127.0.0.1", () => { s2.close(); held.close(); res({ port: hp, ok: true }); });
  });
});
console.log(`CANARY(held port ${ctrl.port}) ${ctrl.ok ? "BAD: bind succeeded on a held port -> probe has no discriminating power" : "GOOD: " + ctrl.code}`);
process.exit(0);
