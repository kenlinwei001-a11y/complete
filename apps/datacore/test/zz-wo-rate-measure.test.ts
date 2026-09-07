import { describe, it } from "vitest";
import { batteryObjectTypes } from "../src/synthetic/battery.js";
import { extendedObjectTypes } from "../src/synthetic/battery-extended.js";

describe("measure", () => {
  it("derived formulas and their operand units", () => {
    const types: any[] = [...(batteryObjectTypes() as any[]), ...(extendedObjectTypes() as any[])];
    for (const t of types) {
      for (const d of t.derivedProperties ?? []) {
        const ids = (d.formula.match(/[A-Za-z_][\w]*/g) ?? []).filter(
          (x: string) => !/^(SUM|COUNT|MIN|MAX|AVG|BY)$/i.test(x),
        );
        const operands = ids.map((id: string) => {
          const p = (t.properties ?? []).find((q: any) => q.propKey === id);
          const dp = (t.derivedProperties ?? []).find((q: any) => q.propKey === id);
          return `${id}=${p?.unit ?? dp?.unit ?? "?"}`;
        });
        const additive = /[+\-]/.test(d.formula.replace(/^\s*-/, ""));
        console.log(
          `DERIVED ${t.key}.${d.propKey} unit=${d.unit} additive=${additive} formula="${d.formula}" operands=${operands.join(",")}`,
        );
      }
    }
  });
});
