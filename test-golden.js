// 黄金向量测试：tools/golden-cases.json 为唯一期望值来源，
// 三个实现（www 抽取版 / 小程序 schedule.js / Java WidgetConfig）都必须对它断言通过。
// 用法：
//   node test-golden.js          断言模式（www + 小程序）
//   node test-golden.js --update 以 www 实现为基准（重新）生成期望值，需人工复核后提交
const fs = require("fs");
const path = require("path");

const api = require("./extract-harness.js");
const sched = require("./miniprogram/miniprogram/utils/schedule.js");

const FIXTURE = path.join(__dirname, "tools", "golden-cases.json");
const UPDATE = process.argv.includes("--update");
const H = 3600000;

function defaultDay(enabled) {
  return {
    enabled,
    workStart: "09:00",
    workEnd: "18:00",
    breaks: enabled ? [{ name: "午休", start: "12:00", end: "13:00" }] : [],
  };
}
const BASE_SCHEDULES = {
  0: defaultDay(false), 1: defaultDay(true), 2: defaultDay(true),
  3: defaultDay(true), 4: defaultDay(true), 5: defaultDay(true), 6: defaultDay(false),
};
function baseCfg(over) {
  return Object.assign(
    { mode: "fixed", bigSmallAnchor: null, holidays: {}, deletedBuiltinHolidays: {}, remoteHolidays: {}, leaves: {}, schedules: BASE_SCHEDULES },
    over
  );
}

// ---------- 用例定义（期望值由 --update 以 www 为基准生成） ----------
function buildCases() {
  const cases = [];

  // A. 基线：固定班，无请假，8 月（无法定假）月中周一上午
  cases.push({ name: "A 基线无请假", config: baseCfg(), now: "2026-08-24T10:00:00" });

  // B. 事假：周二/三/四全天（不带薪）
  cases.push({
    name: "B 事假3天",
    config: baseCfg({ leaves: { "2026-08-25": "事假", "2026-08-26": "事假", "2026-08-27": "事假" } }),
    now: "2026-08-24T10:00:00",
  });

  // C. 年假：同样三天全天（带薪，工资口径应=标准）
  cases.push({
    name: "C 年假3天(带薪)",
    config: baseCfg({ leaves: { "2026-08-25": "🌴 年假", "2026-08-26": "年假", "2026-08-27": "年假" } }),
    now: "2026-08-24T10:00:00",
  });

  // D. 时段假多段：周二上午 10:00-12:00 + 下午 13:30-15:00（与午休不重叠）
  cases.push({
    name: "D 时段假两段",
    config: baseCfg({ leaves: { "2026-08-25": [{ reason: "事假", start: "10:00", end: "12:00" }, { reason: "病假", start: "13:30", end: "15:00" }] } }),
    now: "2026-08-24T10:00:00",
  });

  // E. 大小周：锚定 8/24 为大周（周六上班 9-18），周三配小周覆盖 10:00-16:00 无休
  cases.push({
    name: "E 大小周小周覆盖",
    config: baseCfg({
      mode: "bigSmall",
      bigSmallAnchor: { monday: "2026-08-24", type: "big" },
      schedules: {
        0: defaultDay(false), 1: defaultDay(true), 2: defaultDay(true), 3: defaultDay(true),
        4: defaultDay(true), 5: defaultDay(true),
        6: { enabled: false, workStart: "09:00", workEnd: "18:00", breaks: [{ name: "午休", start: "12:00", end: "13:00" }] },
      },
      // schedules 由上方覆盖，重新挂 small 覆盖到周三
      // （buildCases 内直接改）
    }),
    now: "2026-08-31T10:00:00", // 8/31 周一是小周
  });
  cases[cases.length - 1].config.schedules[3].small = { workStart: "10:00", workEnd: "16:00", breaks: [] };

  // F. 国庆周 + 十月：法定假 10/1-7，调休 9/20 与 10/10
  cases.push({ name: "F 国庆周", config: baseCfg(), now: "2026-09-28T10:00:00" });
  cases.push({ name: "F2 十月整月", config: baseCfg(), now: "2026-10-15T10:00:00" });

  // G. 在线数据 + 删除 + 自定义：2027 春节假数据，删除调休 1/30，自定义 2/12 休息
  cases.push({
    name: "G 2027春节remote链",
    config: baseCfg({
      remoteHolidays: { "2027": [
        { name: "春节", holidays: ["2027-02-05", "2027-02-06", "2027-02-08", "2027-02-09", "2027-02-10", "2027-02-11"], workdays: ["2027-01-30", "2027-02-20"] },
      ] },
      deletedBuiltinHolidays: { "2027-01-30": true },
      holidays: { "2027-02-12": "holiday" },
    }),
    now: "2027-02-10T10:00:00",
    workDayChecks: [["2027-02-08", false], ["2027-02-12", false], ["2027-01-30", false], ["2027-02-20", true]],
  });

  // H. 删除内置国庆 10/1：十月总工时 +8h
  cases.push({
    name: "H 删除内置10/1",
    config: baseCfg({ deletedBuiltinHolidays: { "2026-10-01": true } }),
    now: "2026-10-15T10:00:00",
    workDayChecks: [["2026-10-01", true], ["2026-10-02", false], ["2026-10-10", true]],
  });

  // I. 单日调班：周二加班 9-21（含午休），同日还有自定义节假日——调班优先于假期层
  cases.push({
    name: "I 调班加班+节日冲突",
    config: baseCfg({
      dayOverrides: { "2026-08-25": { workStart: "09:00", workEnd: "21:00", breaks: [{ name: "午休", start: "12:00", end: "13:00" }] } },
      holidays: { "2026-08-25": "holiday" },
    }),
    now: "2026-08-24T10:00:00",
    workDayChecks: [["2026-08-25", true]],
  });

  // J. 单日调休休息：周三 off
  cases.push({
    name: "J 调休休息",
    config: baseCfg({ dayOverrides: { "2026-08-26": { off: true } } }),
    now: "2026-08-24T10:00:00",
    workDayChecks: [["2026-08-26", false]],
  });

  // K. 周六加班自定义时段：10:00-15:00 无休息段
  cases.push({
    name: "K 周六加班时段",
    config: baseCfg({ dayOverrides: { "2026-08-29": { workStart: "10:00", workEnd: "15:00", breaks: [] } } }),
    now: "2026-08-24T10:00:00",
    workDayChecks: [["2026-08-29", true]],
  });

  // L. 统计口径：事假+年假各1天、周六调班上班、周三调休休息
  cases.push({
    name: "L 统计口径",
    config: baseCfg({
      leaves: { "2026-08-25": "事假", "2026-08-26": "年假" },
      dayOverrides: { "2026-08-29": { workStart: "10:00", workEnd: "15:00", breaks: [] }, "2026-08-27": { off: true } },
    }),
    now: "2026-08-24T10:00:00",
  });

  // M. 统计时段假：周一全天事假 + 周二两段（一段跨午休验证不重复扣）+ 周三整班次大段（验证裁剪）
  cases.push({
    name: "M 统计时段假",
    config: baseCfg({
      leaves: {
        "2026-08-24": "事假",
        "2026-08-25": [{ reason: "年假", start: "11:00", end: "14:00" }, { reason: "事假", start: "16:00", end: "18:00" }],
        "2026-08-26": [{ reason: "病假", start: "09:00", end: "19:00" }],
      },
    }),
    now: "2026-08-24T10:00:00",
  });

  return cases;
}

// ---------- 计算（www 参考实现 / 小程序） ----------
function computeAll(impl, cfg, nowStr) {
  const now = new Date(nowStr);
  const monthFirst = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const r = {};
  if (impl === "www") {
    api.setCfg(cfg);
    const monday = api.getMondayOfWeek(now);
    r.week = api.rangeTime(now, monday, 7, false);
    r.month = api.rangeTime(now, monthFirst, monthDays, false);
    r.weekPaid = api.rangeTime(now, monday, 7, true);
    r.monthPaid = api.rangeTime(now, monthFirst, monthDays, true);
    r.monthStd = { totalMs: api.computeMonthStandardTime(now) };
    r.stats = api.computeMonthStats(now);
    r.workDay = (d) => api.isWorkDay(new Date(d + "T10:00:00"));
  } else {
    const monday = sched.getMondayOfWeek(now);
    r.week = sched.rangeTime(cfg, now, monday, 7, false);
    r.month = sched.rangeTime(cfg, now, monthFirst, monthDays, false);
    r.weekPaid = sched.rangeTime(cfg, now, monday, 7, true);
    r.monthPaid = sched.rangeTime(cfg, now, monthFirst, monthDays, true);
    r.monthStd = { totalMs: sched.computeMonthStandardTime(cfg, now) };
    r.stats = sched.computeMonthStats(cfg, now);
    r.workDay = (d) => sched.isWorkDay(cfg, new Date(d + "T10:00:00"));
  }
  return r;
}
function pickRange(o) {
  return [o.totalMs, o.doneMs, o.futureWorkMs];
}

// ---------- 主流程 ----------
let data;
if (UPDATE) {
  const cases = buildCases().map((c) => {
    const r = computeAll("www", c.config, c.now);
    const expect = {
      week: pickRange(r.week), month: pickRange(r.month),
      weekPaid: pickRange(r.weekPaid), monthPaid: pickRange(r.monthPaid),
      monthStd: r.monthStd.totalMs,
    };
    if (c.name.indexOf("统计") >= 0) {
      expect.stats = {
        workDays: r.stats.workDays, pastWorkDays: r.stats.pastWorkDays, leaveDays: r.stats.leaveDays,
        leaveByReason: r.stats.leaveByReason, segLeaveByReason: r.stats.segLeaveByReason,
        overtimeDays: r.stats.overtimeDays, offDays: r.stats.offDays,
        totalMs: r.stats.totalMs, doneMs: r.stats.doneMs,
      };
    }
    if (c.workDayChecks) expect.workDay = c.workDayChecks.map(([d]) => r.workDay(d));
    return Object.assign({}, c, { expect });
  });
  data = { comment: "黄金向量：期望值以 www app.js 为基准生成（--update），Java/小程序实现必须一致。时间均为本地时区。", cases };
  fs.writeFileSync(FIXTURE, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log("已生成期望值 → " + FIXTURE + "（请人工复核）");
  data.cases.forEach((c) => {
    console.log("  " + c.name + ": week=" + c.expect.week.map((x) => (x / H).toFixed(2) + "h").join("/") +
      " month=" + c.expect.month.map((x) => (x / H).toFixed(2) + "h").join("/") +
      " monthPaid=" + c.expect.monthPaid[0] / H + "h" + " std=" + c.expect.monthStd / H + "h");
  });
  process.exit(0);
}

data = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; }
  else { fail++; console.log("  ✘ " + label); }
}
function eqArr(a, b) { return a.length === b.length && a.every((x, i) => x === b[i]); }

for (const impl of ["www", "mp"]) {
  console.log("=== " + (impl === "www" ? "www (extract-harness)" : "小程序 schedule.js") + " ===");
  for (const c of data.cases) {
    const cfg = impl === "www" ? c.config : c.config; // 同一份 JSON 直接用
    const r = computeAll(impl, cfg, c.now);
    const e = c.expect;
    const pre = "  [" + c.name + "]";
    check(pre + " week", eqArr(pickRange(r.week), e.week));
    check(pre + " month", eqArr(pickRange(r.month), e.month));
    check(pre + " weekPaid", eqArr(pickRange(r.weekPaid), e.weekPaid));
    check(pre + " monthPaid", eqArr(pickRange(r.monthPaid), e.monthPaid));
    check(pre + " monthStd", r.monthStd.totalMs === e.monthStd);
    if (e.stats) {
      const okStat = Object.keys(e.stats).every((k) =>
        typeof e.stats[k] === "object" ? JSON.stringify(r.stats[k]) === JSON.stringify(e.stats[k]) : r.stats[k] === e.stats[k]
      );
      check(pre + " stats", okStat);
    }
    if (e.workDay) e.workDay.forEach((want, i) => check(pre + " isWorkDay " + c.workDayChecks[i][0] + "=" + want, r.workDay(c.workDayChecks[i][0]) === want));
  }
}
console.log(fail === 0 ? "✔ 黄金向量全部通过（" + pass + " 项）" : "✘ 失败 " + fail + " / " + (pass + fail) + " 项");
process.exit(fail === 0 ? 0 : 1);
