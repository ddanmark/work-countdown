/* ============================================================
   holidays.js — 法定节假日数据（与安卓端完全一致，保证两端日历/排班口径统一）
   数据由 tools/gen-holidays.js 从 holidays.json 生成，勿手改本文件标记段
   ============================================================ */

// @holidays-gen:begin —— 本段由 tools/gen-holidays.js 从 holidays.json 生成，勿手改
const HOLIDAY_GROUPS = [
  // ---- 2026 ----
  { name: "元旦", holidays: ["2026-01-01", "2026-01-02", "2026-01-03"], workdays: ["2026-01-04"] },
  { name: "春节", holidays: ["2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23"], workdays: ["2026-02-14", "2026-02-28"] },
  { name: "清明", holidays: ["2026-04-05", "2026-04-06", "2026-04-07"], workdays: [] },
  { name: "劳动节", holidays: ["2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05"], workdays: ["2026-05-09"] },
  { name: "端午", holidays: ["2026-06-19", "2026-06-20", "2026-06-21"], workdays: [] },
  { name: "中秋", holidays: ["2026-09-25", "2026-09-26", "2026-09-27"], workdays: [] },
  { name: "国庆", holidays: ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"], workdays: ["2026-09-20", "2026-10-10"] },
];
// @holidays-gen:end

// date(yyyy-mm-dd) -> "holiday" | "workday"
const BUILTIN_HOLIDAYS = {};
// date -> 节假日分组名（元旦/春节…）
const BUILTIN_HOLIDAY_CATEGORIES = {};

HOLIDAY_GROUPS.forEach(function (g) {
  g.holidays.forEach(function (d) { BUILTIN_HOLIDAYS[d] = "holiday"; BUILTIN_HOLIDAY_CATEGORIES[d] = g.name; });
  g.workdays.forEach(function (d) { BUILTIN_HOLIDAYS[d] = "workday"; BUILTIN_HOLIDAY_CATEGORIES[d] = g.name; });
});

module.exports = {
  HOLIDAY_GROUPS,
  BUILTIN_HOLIDAYS,
  BUILTIN_HOLIDAY_CATEGORIES,
};
