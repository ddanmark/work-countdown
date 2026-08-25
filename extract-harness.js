// 公共抽取器：从 app/www/app.js 按代码标记抽出纯计算函数，返回可 setCfg 的 API。
// 用标记而非行号定位，app.js 增删行不会导致抽取错位。
const fs = require("fs");
const path = require("path");
const srcText = fs.readFileSync(path.join(__dirname, "app", "www", "app.js"), "utf8");

function block(startMarker, endMarker) {
  const s = srcText.indexOf(startMarker);
  if (s < 0) { console.error("EXTRACT FAIL: marker not found: " + startMarker); process.exit(1); }
  const e = srcText.indexOf(endMarker, s);
  if (e < 0) { console.error("EXTRACT FAIL: end marker not found: " + endMarker); process.exit(1); }
  return srcText.slice(s, e);
}

let body = [
  block("const BUILTIN_HOLIDAYS = {};", "function getHolidayOverride"),
  block("function getHolidayOverride", "// ---------- 默认配置"),
  block("function toDate", "// ---------- 自定义时间选择器"),
  block("function ymd", "function setThisWeekType"), // 含 getMondayOfWeek/isWorkDay/请假解析/effectiveDaySchedule 等
  block("function daySchedule", "function cloneDayTimes"),
  block("function netWorkMs", "function currentBreak"),
  block("function rangeTime", "// ---------- 工资"), // 含 pctOf/computeWeek|MonthProgress/PaidTime/StandardTime
].join("\n");

const factory = new Function(
  "HOLIDAY_GROUPS",
  `
  let cfg = null;
  ${body.replace(/^  /gm, "")}
  return { setCfg: (c) => { cfg = c; rebuildRemoteHolidays(); }, cfg: () => cfg, getMondayOfWeek, isWorkDay, isWorkDayIgnoringLeave, isPaidLeaveDay, isFullLeaveDay, leaveInfosOf, computeWeekProgress, computeMonthProgress, computeWeekPaidTime, computeMonthPaidTime, computeMonthStandardTime, totalWorkMs, daySchedule, ymd, getHolidayOverride, isBuiltinHoliday, isPresetHolidayKey, validateRemoteHolidayData, rebuildRemoteHolidays, rangeTime };
  `
);
// 注意：注入真实法定节假日数据（与 www/app.js 同源于 holidays.json 生成，
// 取小程序端 holidays.js 保证单一来源）；早期测试用空表，依赖八月无法定假的巧合
module.exports = factory(require("./miniprogram/miniprogram/utils/holidays.js").HOLIDAY_GROUPS);
