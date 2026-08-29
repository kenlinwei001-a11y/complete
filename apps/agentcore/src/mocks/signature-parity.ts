/**
 * WO-MOCKDC-SIGNATURE · **形参对齐守卫**（类型层，编译期生效）。
 *
 * ## 为什么 `implements` 挡不住
 *
 * TypeScript 允许「实现方比接口**少写**形参」——形参个数少是合法子类型（`(a) => R` 可赋给
 * `(a, b) => R`）。于是 `class MockOntologyClient implements OntologyClient` 明明写着，
 * `queryObjects` 却只实现到第 4 个形参（接口有 5 个），`tsc` **一声不吭**。
 * 同理 `const m: DataCoreClient = {...}` 显式标注也挡不住 —— 它做的是同一套赋值兼容性检查。
 *
 * 后果不是「类型不严」，是**语义被静默改写**：
 *  · 漏 `ctx` ⇒ mock 收了租户上下文却不认 ⇒ **跨租户在 mock 里是通的**（违 `tenant_id everywhere`）；
 *  · 漏 `asOfEpoch` ⇒ mock 收了时点却不认 ⇒ **读历史时点 == 读当前**（违 A8/§13.1 任务快照）。
 *
 * 形态（照铁律 0.6 句式）：
 * > **「我用『mock 实现了这个接口』当作『mock 遵守这个接口的语义』的证据，而前者并不度量后者。」**
 *
 * 危险性在于它**专门骗测试**：任何拿 mock 验「租户隔离」或「时点读」的测试，
 * 验的都是一个不看这两个参数的替身 —— 绿了什么也不证明。
 *
 * ## 这道守卫做什么
 *
 * 逐方法比对「实现的形参个数」与「接口声明的形参个数」，不一致即在 `tsc` 里报错，
 * 并把**方法名印进错误消息**（`Type '"queryObjects"' does not satisfy the constraint 'true'`）。
 * 判据是「**变异后会红**」，不是「加了类型标注」—— 见 `test/mock-signature-parity.test.ts`
 * 的变异反证（删一个形参 ⇒ `pnpm --filter agentcore exec tsc --noEmit` 必须红）。
 *
 * ## 只管个数、不管类型，是有意的
 *
 * 形参**类型**的兼容性 `implements` 已经在管（双变，宽的实参类型合法且常常是 mock 的正当放宽）；
 * 形参**个数**是 `implements` 唯一放行、而语义后果最重的那一维。守卫收窄到这一维 ⇒ 零误报。
 */

/** 严格类型相等（不被 `any` / 联合塌缩骗；TS 社区标准写法）。 */
type Equals<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

/**
 * 断言为真。为假时 `tsc` 在**声明处**报错，并把不满足约束的类型（= 漂移的方法名）印进错误消息。
 * 这就是「机器先说话」的那一句：不是人想起来去数形参，是编译器直接点名。
 */
export type Expect<T extends true> = T;

type AnyFn = (...args: never[]) => unknown;

/** 取成员的函数形态；接口里的**可选**成员是 `F | undefined`，须先剥 `undefined`。 */
type AsFn<T> = NonNullable<T> extends AnyFn ? NonNullable<T> : never;

/** 两侧都存在、且两侧都是函数的成员名（private 成员不进 `keyof`，天然被排除）。 */
type SharedFnKeys<Impl, Iface> = {
  [K in keyof Iface & keyof Impl]: [AsFn<Iface[K]>] extends [never]
    ? never
    : [AsFn<Impl[K]>] extends [never]
      ? never
      : K;
}[keyof Iface & keyof Impl];

/** 形参个数。可选形参会让它成为长度联合（`(a, b?, c?)` ⇒ `1 | 2 | 3`），正是我们要比的东西。 */
type Arity<T> = Parameters<AsFn<T>>["length"];

/**
 * 形参个数与接口不一致的方法名集合；**完全对齐时为 `never`**。
 * 单独导出是为了让金丝雀与主断言**共用同一份实现** —— 抄第二份正则/第二套逻辑的金丝雀是装饰品
 * （铁律 0.6：改主逻辑时金丝雀拿旧的去测、照样绿）。
 */
export type ParamArityDrift<Impl, Iface> = {
  [K in SharedFnKeys<Impl, Iface>]: Equals<Arity<Impl[K]>, Arity<Iface[K]>> extends true ? never : K;
}[SharedFnKeys<Impl, Iface>];

/** 主断言：无漂移 ⇒ `true`；有漂移 ⇒ 漂移方法名的联合（喂给 `Expect<>` 即编译期报错并点名）。 */
export type NoParamArityDrift<Impl, Iface> = [ParamArityDrift<Impl, Iface>] extends [never]
  ? true
  : ParamArityDrift<Impl, Iface>;

/* ------------------------------------------------------------------------- *
 * 金丝雀（铁律 0.6：报「没有漂移」这类否定结论之前，先自证工具是对的）
 *
 * 与主断言**共用** `ParamArityDrift` —— 不是抄一份平行实现。若有人把守卫改弱
 * （比如把 `Equals` 换成 `extends`，或把 `Arity` 换成恒 `number`），下面两条会立刻变红，
 * 而不是「守卫悄悄失效、全仓照样绿」。
 * ------------------------------------------------------------------------- */

interface CanaryIface {
  /** 探针：接口声明 2 个形参。 */
  probe(a: string, b: number): void;
  /** 探针：接口声明 1 个必填 + 1 个可选。 */
  probeOptional(a: string, b?: number): void;
}

/** 少写一个形参的实现 —— 这正是本守卫要抓的病灶形态。 */
class CanaryDrifted implements CanaryIface {
  probe(_a: string): void {}
  probeOptional(_a: string): void {}
}

/** 形参个数一字不差的实现。 */
class CanaryAligned implements CanaryIface {
  probe(_a: string, _b: number): void {}
  probeOptional(_a: string, _b?: number): void {}
}

/**
 * 金丝雀①（必中）：少写形参**必须**被点名。抓不到 ⇒ 守卫坏了，
 * **不许**据此报「mock 签名都对齐」。
 */
export type CanaryDetectsDrift = Expect<Equals<ParamArityDrift<CanaryDrifted, CanaryIface>, "probe" | "probeOptional">>;

/** 金丝雀②（必不中）：对齐的实现不许被误报（否则守卫是噪声，噪声迟早被人关掉）。 */
export type CanaryNoFalsePositive = Expect<NoParamArityDrift<CanaryAligned, CanaryIface>>;
