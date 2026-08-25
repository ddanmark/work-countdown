// 在线节假日更新：校验器双端一致性 + 三端优先级链（remote 层）回归
const api = require("./extract-harness.js");
const sched = require("./miniprogram/miniprogram/utils/schedule.js");
const feed = require("./miniprogram/miniprogram/utils/holiday-feed.js");

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  ✔ " + name); }
  else { fail++; console.log("  ✘ " + name); }
}

// 模拟 2027 年官方安排（发布前的假数据，仅测试用）：
// 元旦 1/1(五) 休；春节 2/5(五)-2/11(四) 休，调休 1/30(六)、2/20(六) 上班
const payload = { years: { "2027": [
  { name: "元旦", holidays: ["2027-01-01"], workdays: [] },
  { name: "春节", holidays: ["2027-02-05", "2027-02-06", "2027-02-08", "2027-02-09", "2027-02-10", "2027-02-11"], workdays: ["2027-01-30", "2027-02-20"] },
] } };

function defaultDay(enabled) {
  return {
    enabled,
    workStart: "09:00",
    workEnd: "18:00",
    breaks: enabled ? [{ name: "午休", start: "12:00", end: "13:00" }] : [],
  };
}
const schedules = { 0: defaultDay(false), 1: defaultDay(true), 2: defaultDay(true), 3: defaultDay(true), 4: defaultDay(true), 5: defaultDay(true), 6: defaultDay(false) };
const H = 3600000;

console.log("=== A. 校验器（www 抽取版 vs 小程序 holiday-feed.js） ===");
const v = api.validateRemoteHolidayData(payload);
check("合法数据通过（9 天）", v.count === 9 && v.years["2027"].length === 2);
const v2 = feed.validateRemoteHolidayData(payload);
check("双端校验结果完全一致", JSON.stringify(v2) === JSON.stringify(v));

const badPayloads = [
  [null, "空数据"],
  [{}, "缺少 years"],
  [{ years: [] }, "years 是数组"],
  [{ years: { "2027": [{ name: "x", holidays: "2027-01-01", workdays: [] }] } }, "holidays 非数组"],
  [{ years: { "2027": [{ name: "x", holidays: ["2027-02-30"], workdays: [] }] } }, "不存在的日期 2/30"],
  [{ years: { "2027": [{ name: "x", holidays: ["2027-13-01"], workdays: [] }] } }, "非法月份 13"],
  [{ years: { "2027": [{ name: "x", holidays: ["2027-01-01"], workdays: ["2027-01-01"] }] } }, "同日重复"],
  [{ years: { "2027": [{ name: "x", holidays: ["2026-12-31"], workdays: [] }] } }, "日期年份与分组不符"],
  [{ years: { "19x7": [{ name: "x", holidays: ["2027-01-01"], workdays: [] }] } }, "年份 key 非法"],
  [{ years: { "2027": [{ name: "", holidays: ["2027-01-01"], workdays: [] }] } }, "分组缺名称"],
];
badPayloads.forEach(([p, label]) => {
  let threwA = false, threwB = false;
  try { api.validateRemoteHolidayData(p); } catch (e) { threwA = true; }
  try { feed.validateRemoteHolidayData(p); } catch (e) { threwB = true; }
  check("双端一致拒绝：" + label, threwA && threwB);
});

console.log("=== B. www 端优先级链（内置 > remote > 排班） ===");
api.setCfg({ mode: "fixed", bigSmallAnchor: null, holidays: {}, deletedBuiltinHolidays: {}, remoteHolidays: {}, leaves: {}, schedules });
check("无 remote：2027-02-08(周一) 正常上班", api.isWorkDay(new Date("2027-02-08T10:00:00")));
check("无 remote：2027-01-30(周六) 休息", !api.isWorkDay(new Date("2027-01-30T10:00:00")));

api.setCfg({ mode: "fixed", bigSmallAnchor: null, holidays: {}, deletedBuiltinHolidays: {}, remoteHolidays: v.years, leaves: {}, schedules });
check("有 remote：2027-02-08(春节周一) 休息", !api.isWorkDay(new Date("2027-02-08T10:00:00")));
check("有 remote：2027-01-30(调休周六) 上班", api.isWorkDay(new Date("2027-01-30T10:00:00")));
const wWww = api.computeWeekProgress(new Date("2027-02-10T10:00:00"));
check("有 remote：春节周(2/8-2/14)总工时 40h→8h", wWww.totalMs === 8 * H);

api.setCfg({ mode: "fixed", bigSmallAnchor: null, holidays: {}, deletedBuiltinHolidays: { "2027-01-30": true }, remoteHolidays: v.years, leaves: {}, schedules });
check("删除在线调休日后：1/30 周六恢复休息", !api.isWorkDay(new Date("2027-01-30T10:00:00")));

api.setCfg({ mode: "fixed", bigSmallAnchor: null, holidays: { "2027-02-08": "workday" }, deletedBuiltinHolidays: {}, remoteHolidays: v.years, leaves: {}, schedules });
check("用户自定义覆盖在线：2/8 春节改上班", api.isWorkDay(new Date("2027-02-08T10:00:00")));

console.log("=== C. 小程序端 schedule.js 同链路 ===");
const cfgMP = { mode: "fixed", bigSmallAnchor: null, holidays: {}, deletedBuiltinHolidays: {}, remoteHolidays: v.years, leaves: {}, schedules };
check("mp：2027-02-08 休息", !sched.isWorkDay(cfgMP, new Date("2027-02-08T10:00:00")));
check("mp：2027-01-30 上班", sched.isWorkDay(cfgMP, new Date("2027-01-30T10:00:00")));
const wMP = sched.computeWeekProgress(cfgMP, new Date("2027-02-10T10:00:00"));
check("mp：春节周总工时 8h", wMP.totalMs === 8 * H);
const cfgMP2 = Object.assign({}, cfgMP, { remoteHolidays: {} });
check("mp：清空 remote 后 2/8 恢复上班", sched.isWorkDay(cfgMP2, new Date("2027-02-08T10:00:00")));
const cfgMP3 = Object.assign({}, cfgMP, { deletedBuiltinHolidays: { "2027-01-30": true } });
check("mp：删除在线调休后 1/30 恢复休息", !sched.isWorkDay(cfgMP3, new Date("2027-01-30T10:00:00")));
check("mp：remote 覆盖排班但保留用户自定义优先", sched.isPresetHolidayKey(cfgMP, "2027-02-08") && !sched.isPresetHolidayKey(cfgMP, "2027-03-01"));

console.log(fail === 0 ? "\n✔ 全部通过（" + pass + " 项）" : "\n✘ 失败 " + fail + " 项");
process.exit(fail === 0 ? 0 : 1);
