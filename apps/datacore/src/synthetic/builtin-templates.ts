import type { IndustryTemplate } from "@platform/contracts";
import { BATTERY_TEMPLATE } from "./battery.js";

/**
 * 内置行业模版登记表（代码常数，非 industry_templates 表记录）。
 *
 * 缘起：`resolveTemplate` 对 battery-manufacturing 直接返回 BATTERY_TEMPLATE 代码常数、从不写库，
 * 于是 `GET /a/v1/industry-templates`（只列库记录）对新租户返回空 → "行业模版"下拉空，
 * 但"项目沙盘/快速合成"用的正是这张内置模版确定性生成的数据。这里把内置模版登记出来，
 * 让端点把"内置 ∪ 库存（LLM/克隆）"一并 surf 给下拉，下拉与实际可用模版一致。
 */
export const BUILTIN_INDUSTRY_TEMPLATES: IndustryTemplate[] = [BATTERY_TEMPLATE];
