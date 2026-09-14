import { z } from "zod";

// OC9 工厂日历（operational-completeness OC9）：日历一等对象 + 净生产窗口扣减（节假日/检修）。
// 求解器/排程读 calendar 把"自然天数"折算为"净生产天数"（春节周等非工作日扣除）。
export const CalendarExceptionSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  kind: z.enum(["HOLIDAY", "MAINTENANCE", "EXTRA_WORKDAY"]),
  label: z.string().default(""),
});
export const FactoryCalendarSchema = z.object({
  id: z.string(), // cal_<tenant>_<key>
  tenantId: z.string(),
  calendarKey: z.string(),
  weekendMode: z.enum(["SAT_SUN_OFF", "SUN_OFF", "NONE"]).default("SAT_SUN_OFF"),
  exceptions: z.array(CalendarExceptionSchema).default([]),
  updatedAt: z.string(),
});
export type FactoryCalendar = z.infer<typeof FactoryCalendarSchema>;

export const PutCalendarBodySchema = FactoryCalendarSchema.pick({ weekendMode: true, exceptions: true }).partial();
