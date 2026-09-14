// 临时：残留句柄探针配置（枚举泄漏源用，正式门不走这条）。默认 `vitest run` 不加载本文件。
import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

export default mergeConfig(
  base,
  defineConfig({
    test: {
      setupFiles: ["./test/setup.ts", "./test/leakProbe.setup.ts"],
      // 默认 hooks 顺序是 stack（后注册先跑）——那会让探针在 RTL cleanup **之前**取样，
      // 把「还挂着的组件」误判成泄漏。改 list：cleanup → setup 的 afterEach → 探针。
      // ⚠ 已实测：这条改动本身会让 f20.live-recompute-race / f28.calibration 两条请求计数用例失败
      //   （正式配置下同样两个文件 7/7 绿）。所以本配置**只用于枚举泄漏源**，它的用例红绿不作数；
      //   会判红的守卫在 test/setup.ts 的 afterEach 里，走的是正式配置。
      sequence: { hooks: "list" },
    },
  }),
);
