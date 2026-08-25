// 网页端周/月进度 + 工资口径回归（抽取 app/www/app.js 真实函数运行）
const api = require("./extract-harness.js");

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
  api.setCfg({ mode: "fixed", bigSmallAnchor: null, holidays: {}, deletedBuiltinHolidays: {}, leaves, schedules });
  const now = new Date(nowStr);
  const w = api.computeWeekProgress(now);
  const m = api.computeMonthProgress(now);
  console.log("=== " + title + "  (now=" + nowStr + ") ===");
  console.log("  本周: total=" + fmt(w.totalMs) + " done=" + fmt(w.doneMs) + " 还需=" + fmt(w.totalMs - w.doneMs) + " pct=" + w.pct.toFixed(1) + "%");
  console.log("  本月(8月): total=" + fmt(m.totalMs) + " done=" + fmt(m.doneMs) + " 还需=" + fmt(m.totalMs - m.doneMs) + " pct=" + m.pct.toFixed(1) + "%");
}

// 2026-08-24 是周一。本周 Mon-Fri: 24,25,26,27,28
show("A. 无请假（基线，期望 40h/168h）", {}, "2026-08-24T10:00:00");
show("B. 周二/三/四 请全天假（期望本周 16h/本月 144h）", { "2026-08-25": "事假", "2026-08-26": "事假", "2026-08-27": "事假" }, "2026-08-24T10:00:00");
show("C. 同上，但站在周五看（期望本周 total 16h done 9h）", { "2026-08-25": "事假", "2026-08-26": "事假", "2026-08-27": "事假" }, "2026-08-28T10:00:00");
show("D. 每天 14:00-18:00 时段假 x3（期望本周 28h/本月 156h）", { "2026-08-25": { reason: "事假", start: "14:00", end: "18:00" }, "2026-08-26": { reason: "事假", start: "14:00", end: "18:00" }, "2026-08-27": { reason: "事假", start: "14:00", end: "18:00" } }, "2026-08-24T10:00:00");

// —— 工资语义：rate = 月薪 / 标准月工时；已赚 = rate × 确定到手工时（带薪总工时 − 未来仍需上班工时）——
// 年假（含未来）立即视为已赚；事假天已赚为 0（随日子过去体现扣款）
const SALARY = 10000;
function salaryCheck(title, leaves) {
  api.setCfg({ mode: "fixed", bigSmallAnchor: null, holidays: {}, deletedBuiltinHolidays: {}, leaves, schedules, salaryEnabled: true, monthlySalary: SALARY });
  const now = new Date("2026-08-31T20:00:00"); // 月末：futureWork=0，已赚=带薪总工时
  const std = api.computeMonthStandardTime(now);
  const rate = SALARY / (std / H);
  const p = api.computeMonthPaidTime(now);
  const earned = (Math.max(0, p.totalMs - p.futureWorkMs) / H) * rate;
  console.log("工资[" + title + "] 标准月工时=" + fmt(std) + " 带薪总工时=" + fmt(p.totalMs) + " 月末已赚=¥" + earned.toFixed(2));
  return earned;
}
console.log("\n=== 工资口径·月末（月薪 10000，2026-08 标准月工时应为 168h）===");
const e0 = salaryCheck("无请假           ", {});
const e1 = salaryCheck("年假1天(周二)    ", { "2026-08-25": "年假" });
const e2 = salaryCheck("事假1天(周二)    ", { "2026-08-25": "事假" });
const e3 = salaryCheck("年假1天+事假1天  ", { "2026-08-25": "年假", "2026-08-26": "事假" });
const e4 = salaryCheck("事假2小时(时段)  ", { "2026-08-25": { reason: "事假", start: "09:00", end: "11:00" } });
let ok = true;
if (Math.abs(e1 - SALARY) > 0.01) { console.log("  ✗ 年假应不扣（期望 10000）"); ok = false; }
if (Math.abs(e0 - e2 - SALARY / 21) > 0.01) { console.log("  ✗ 事假应扣一天（期望 " + (SALARY - SALARY / 21).toFixed(2) + "）"); ok = false; }
if (Math.abs(e3 - e2) > 0.01) { console.log("  ✗ 年假+事假应只扣事假那份（期望 " + e2.toFixed(2) + "）"); ok = false; }
if (Math.abs(e0 - e4 - SALARY / 84) > 0.01) { console.log("  ✗ 时段事假应扣 2h（期望 " + (SALARY - SALARY / 84).toFixed(2) + "）"); ok = false; }

// —— 工资语义·月中（2026-08-24 周一 20:00：已过 120h，未来 5 个工作日）——
// 已赚=确定到手：未来带薪假立即计入；未来正常上班/事假不计入
function earnedNow(leaves) {
  api.setCfg({ mode: "fixed", bigSmallAnchor: null, holidays: {}, deletedBuiltinHolidays: {}, leaves, schedules, salaryEnabled: true, monthlySalary: SALARY });
  const now = new Date("2026-08-24T20:00:00");
  const rate = SALARY / (api.computeMonthStandardTime(now) / H);
  const p = api.computeMonthPaidTime(now);
  const w = api.computeWeekPaidTime(now);
  return { month: (Math.max(0, p.totalMs - p.futureWorkMs) / H) * rate, week: (Math.max(0, w.totalMs - w.futureWorkMs) / H) * rate };
}
console.log("\n=== 工资口径·月中(8/24 20:00，走字已到 128h=¥7619.05) ===");
const midCases = [
  ["无请假（应与走字一致 7619.05）", {}, 128],
  ["剩余天(24-31)全部年假（应立刻=满月薪 10000）", Object.fromEntries(["24","25","26","27","28","29","30","31"].map(d => ["2026-08-" + d, "年假"])), 168],
  ["未来1天年假(8/25)（应 7619.05+476.19=8095.24）", { "2026-08-25": "年假" }, 136],
  ["未来1天事假(8/25)（当刻不体现，仍 7619.05）", { "2026-08-25": "事假" }, 128],
  ["过去1天事假(8/20)（已扣 476.19 → 7142.86）", { "2026-08-20": "事假" }, 120],
];
for (const [title, leaves, wantH] of midCases) {
  const got = earnedNow(leaves).month;
  const want = SALARY * wantH / 168;
  const pass = Math.abs(got - want) <= 0.01;
  if (!pass) ok = false;
  console.log("  " + (pass ? "✓" : "✗") + " " + title + ": ¥" + got.toFixed(2));
}
// 周：全周剩余(周二~周五)年假 → 本周已赚立刻=满周薪 40h×rate=2380.95
{
  const w = earnedNow({ "2026-08-25": "年假", "2026-08-26": "年假", "2026-08-27": "年假", "2026-08-28": "年假" }).week;
  const pass = Math.abs(w - SALARY * 40 / 168) <= 0.01;
  if (!pass) ok = false;
  console.log("  " + (pass ? "✓" : "✗") + " 本周二~五年假 → 本周已赚立刻=¥" + w.toFixed(2) + "（期望 ¥2380.95）");
}
console.log(ok ? "  ✓ 工资语义全部符合：年假立即视为已赚、事假按时长扣" : "  ✗ 存在不符合项");
process.exitCode = ok ? 0 : 1;
