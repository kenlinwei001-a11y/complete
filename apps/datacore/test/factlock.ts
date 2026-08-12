/**
 * 事实锁扫描面的**单一出处**在 `apps/frontend-shell/test/factlock.ts`（病历与判据本体都在那里顶注）。
 * datacore 的测试不许各抄一份剥注释/扫描正则 —— 两处写判据 = 迟早对不上（该文件顶注的病历
 * 有一半就是这么来的）。故本文件只做转口，一个字都别在这里「改进」。
 */
export * from "../../frontend-shell/test/factlock";
