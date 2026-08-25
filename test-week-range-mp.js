// 验证小程序端 schedule.js 修复后的周/月进度数值
const sched = require("./miniprogram/miniprogram/utils/schedule.js");

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
function fmt(ms) { return (ms / H).toFixed(2) + "h"; }
function show(title, leaves, nowStr) {
  const cfg = { mode: "fixed", bigSmallAnchor: null, holidays: {}, deletedBuiltinHolidays: {}, leaves, schedules };
  const now = new Date(nowStr);
  const w = sched.computeWeekProgress(cfg, now);
  const m = sched.computeMonthProgress(cfg, now);
  console.log("=== " + title + " (now=" + nowStr + ") ===");
  console.log("  本周: total=" + fmt(w.totalMs) + " 还需=" + fmt(w.totalMs - w.doneMs));
  console.log("  本月: total=" + fmt(m.totalMs) + " 还需=" + fmt(m.totalMs - m.doneMs));
  return { w, m };
}

show("A. 无请假（期望 40h/168h）", {}, "2026-08-24T10:00:00");
show("B. 周二/三/四全天假（期望 16h/144h）", { "2026-08-25": "事假", "2026-08-26": "事假", "2026-08-27": "事假" }, "2026-08-24T10:00:00");
show("D. 三天 14:00-18:00 时段假（期望 28h/156h）", { "2026-08-25": { reason: "事假", start: "14:00", end: "18:00" }, "2026-08-26": { reason: "事假", start: "14:00", end: "18:00" }, "2026-08-27": { reason: "事假", start: "14:00", end: "18:00" } }, "2026-08-24T10:00:00");

// 工资口径：带薪全天假应照常计入（带薪假不影响当月工资）
{
  const cfg = { mode: "fixed", bigSmallAnchor: null, holidays: {}, deletedBuiltinHolidays: {}, leaves: { "2026-08-25": "年假", "2026-08-26": "年假" }, schedules };
  const paid = sched.computeMonthPaidTime(cfg, new Date("2026-08-24T10:00:00"));
  console.log("=== E. 工资口径：周二三带薪年假，本月带薪总时长（期望 168h，带薪假不减分母）===");
  console.log("  本月带薪 total=" + fmt(paid.totalMs));
}
// 工资口径：不带薪全天假不计
{
  const cfg = { mode: "fixed", bigSmallAnchor: null, holidays: {}, deletedBuiltinHolidays: {}, leaves: { "2026-08-25": "事假" }, schedules };
  const paid = sched.computeMonthPaidTime(cfg, new Date("2026-08-24T10:00:00"));
  console.log("=== F. 工资口径：周二事假全天，本月带薪总时长（期望 160h = 168-8）===");
  console.log("  本月带薪 total=" + fmt(paid.totalMs));
}

// —— 工资语义（与网页端 test-week-range.js 同一套断言）：rate = 月薪/标准月工时 ——
// 已赚 = rate × 确定到手工时（带薪总工时 − 未来仍需上班工时）：年假（含未来）立即视为已赚
const SALARY = 10000;
function earnedNow(leaves, nowStr) {
  const cfg = { mode: "fixed", bigSmallAnchor: null, holidays: {}, deletedBuiltinHolidays: {}, leaves, schedules, salaryEnabled: true, monthlySalary: SALARY };
  const now = new Date(nowStr);
  const std = sched.computeMonthStandardTime(cfg, now);
  const rate = SALARY / (std / H);
  const p = sched.computeMonthPaidTime(cfg, now);
  return { std, earned: (Math.max(0, p.totalMs - p.futureWorkMs) / H) * rate };
}
function salaryCheck(title, leaves) {
  const r = earnedNow(leaves, "2026-08-31T20:00:00");
  console.log("  " + title + " 月末已赚=¥" + r.earned.toFixed(2));
  return r.earned;
}
console.log("\n=== 工资口径：月末已赚（月薪 10000）===");
const e0 = salaryCheck("无请假", {});
const e1 = salaryCheck("年假1天", { "2026-08-25": "年假" });
const e2 = salaryCheck("事假1天", { "2026-08-25": "事假" });
const e3 = salaryCheck("年假+事假", { "2026-08-25": "年假", "2026-08-26": "事假" });
const e4 = salaryCheck("时段事假2h", { "2026-08-25": { reason: "事假", start: "09:00", end: "11:00" } });
const stdCheck = earnedNow({}, "2026-08-31T20:00:00");
console.log("  标准月工时=" + fmt(stdCheck.std) + "（期望 168h）");
let ok = stdCheck.std === 168 * H;
const cases = [
  ["年假不扣", e1, SALARY],
  ["事假扣一天", e2, SALARY - SALARY / 21],
  ["年假+事假只扣事假", e3, e2],
  ["时段事假扣2h", e4, SALARY - SALARY / 84],
  ["月中·剩余天全年假→立刻满月薪", earnedNow(Object.fromEntries(["24","25","26","27","28","29","30","31"].map(d => ["2026-08-" + d, "年假"])), "2026-08-24T20:00:00").earned, SALARY],
  ["月中·无请假=走字 128h", earnedNow({}, "2026-08-24T20:00:00").earned, SALARY * 128 / 168],
  ["月中·过去事假已扣", earnedNow({ "2026-08-20": "事假" }, "2026-08-24T20:00:00").earned, SALARY * 120 / 168],
];
for (const [name, got, want] of cases) {
  const pass = Math.abs(got - want) <= 0.01;
  if (!pass) ok = false;
  console.log("  " + (pass ? "✓" : "✗") + " " + name + ": ¥" + got.toFixed(2) + "（期望 ¥" + want.toFixed(2) + "）");
}
process.exitCode = ok ? 0 : 1;
