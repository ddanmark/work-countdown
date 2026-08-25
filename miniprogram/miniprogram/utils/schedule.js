/* ============================================================
   schedule.js — 排班 / 倒计时 / 进度计算（纯函数）
   与安卓端 app.js 的核心算法一致；区别：所有函数显式接收 cfg。
   ============================================================ */
const { pad } = require("./format.js");
const holidays = require("./holidays.js");
const { BUILTIN_HOLIDAYS } = holidays;

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEK_LABEL = { 0: "日", 1: "一", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六" };
const WEEK_FULL = { 0: "周日", 1: "周一", 2: "周二", 3: "周三", 4: "周四", 5: "周五", 6: "周六" };

// ---------- 工具 ----------
function ymd(d) {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

// "HH:MM" + 时间戳基准 -> Date
function toDate(hhmm, base) {
  const parts = String(hhmm || "00:00").split(":");
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

// ---------- 节假日 / 请假 ----------
function getHolidayOverride(cfg, date) {
  var key = ymd(date);
  if (cfg.holidays && cfg.holidays.hasOwnProperty(key)) return cfg.holidays[key];
  if (cfg.deletedBuiltinHolidays && cfg.deletedBuiltinHolidays.hasOwnProperty(key)) return null;
  if (BUILTIN_HOLIDAYS.hasOwnProperty(key)) return BUILTIN_HOLIDAYS[key];
  return null;
}

function isBuiltinHoliday(date) {
  var key = ymd(date);
  return BUILTIN_HOLIDAYS.hasOwnProperty(key) && BUILTIN_HOLIDAYS[key] === "holiday";
}

function isLeaveDay(cfg, date) {
  return !!(cfg.leaves && cfg.leaves.hasOwnProperty(ymd(date)));
}

// 带薪假类型：所有请假（全天/时段）的工时一律扣除；带薪假时段在工资口径照常计薪。
// 与安卓端 app.js、WidgetConfig.java 保持一致。
const PAID_LEAVE_REASONS = { "年假": 1, "婚假": 1, "产假": 1, "丧假": 1 };

// 归一化请假类型：小程序端存储带 emoji 前缀（"🌴 年假"），安卓端为裸值（"年假"），
// 配置互通后两种形式都会出现，比较/展示前先去掉 emoji 等非汉字前缀
function normalizeLeaveReason(r) {
  return String(r || "").replace(/^[^\u4e00-\u9fa5]+/, "");
}

// "H:MM"/"HH:MM" → 规范 "HH:MM"；非法返回 null
function normHM(s) {
  if (typeof s !== "string") return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return pad(h) + ":" + pad(mi);
}

// 解析单个请假条目：对象 {reason,start,end}（时段非法回退全天）；字符串=全天
function parseLeaveEntry(v) {
  if (v && typeof v === "object" && !(v instanceof Array)) {
    const reason = normalizeLeaveReason(v.reason) || "请假";
    const s = normHM(v.start), e = normHM(v.end);
    if (s && e && s < e) return { reason: reason, start: s, end: e };
    return { reason: reason, start: null, end: null };
  }
  return { reason: normalizeLeaveReason(v) || "请假", start: null, end: null };
}

// 解析 leaves[date] 的值 → 条目数组（同一天可多段）：字符串/对象=单条；数组=多条
function parseLeaveValue(v) {
  if (v instanceof Array) return v.map(parseLeaveEntry);
  if (v === undefined || v === null || v === "") return [];
  return [parseLeaveEntry(v)];
}

// 某天的请假条目数组；无请假返回 null
function leaveInfosOf(cfg, date) {
  if (!cfg.leaves || !cfg.leaves.hasOwnProperty(ymd(date))) return null;
  return parseLeaveValue(cfg.leaves[ymd(date)]);
}

function leaveReasonOf(cfg, date) {
  const lvs = leaveInfosOf(cfg, date);
  return lvs && lvs.length ? lvs[0].reason : null;
}

// 全天假（任一条目无时段即视为全天，整天按休息处理）；纯时段假当天仍是工作日
function isFullLeaveDay(cfg, date) {
  const lvs = leaveInfosOf(cfg, date);
  return !!lvs && lvs.length > 0 && lvs.some(function (l) { return !l.start; });
}

// 不考虑请假的"本该上班"判定：带薪假只在本来要上班的日子才计入
function isWorkDayIgnoringLeave(cfg, date) {
  var override = getHolidayOverride(cfg, date);
  if (override === "workday") return true;
  if (override === "holiday") return false;
  const idx = date.getDay();
  const sch = cfg.schedules[idx];
  if (!sch) return false;
  if (cfg.mode === "bigSmall" && idx === 6) return isBigWeek(cfg, date) && !!sch.workStart && !!sch.workEnd;
  return !!sch.enabled;
}

// 任一条目为带薪类型且当天本该上班（"今日已赚照常累计"的开关）
function isPaidLeaveDay(cfg, date) {
  const lvs = leaveInfosOf(cfg, date);
  return !!lvs && lvs.some(function (l) { return !!PAID_LEAVE_REASONS[l.reason]; }) && isWorkDayIgnoringLeave(cfg, date);
}

// 有效排班：把当天各段"按时段请假"作为附加休息段注入——工时扣减、"假中"状态、
// "距下次休息/请假"提示全部复用休息段机制，时段与午休/彼此重叠部分不重复扣。
// onlyUnpaid=true 时只注入不带薪条目（工资口径：带薪时段照常计薪，不扣）。
function effectiveDaySchedule(cfg, date, onlyUnpaid) {
  const sch = daySchedule(cfg, date);
  const lvs = leaveInfosOf(cfg, date);
  if (!sch || !lvs) return sch;
  const parts = lvs.filter(function (l) {
    return l.start && (!onlyUnpaid || !PAID_LEAVE_REASONS[l.reason]);
  });
  if (!parts.length) return sch;
  return {
    workStart: sch.workStart,
    workEnd: sch.workEnd,
    breaks: (sch.breaks || []).concat(
      parts.map(function (l) {
        return { name: l.reason, start: l.start, end: l.end };
      })
    ),
  };
}

// 添加请假条目：全天=覆盖当天全部条目；时段=追加（先校验起止与已有时段不重叠）
function addLeaveEntry(cfg, dk, reason, start, end) {
  if (!cfg.leaves) cfg.leaves = {};
  if (!start) {
    cfg.leaves[dk] = reason;
    return { ok: true, text: reason };
  }
  if (start >= end) return { ok: false, err: "结束时间需晚于开始时间" };
  const infos = parseLeaveValue(cfg.leaves[dk]).filter(function (l) { return l.start; });
  for (const l of infos) {
    if (start < l.end && l.start < end) return { ok: false, err: "与已有请假时段重叠（" + l.start + "-" + l.end + "）" };
  }
  infos.push({ reason: reason, start: start, end: end });
  // 单条存对象（兼容旧读取），多条存数组
  if (infos.length === 1) cfg.leaves[dk] = { reason: infos[0].reason, start: infos[0].start, end: infos[0].end };
  else cfg.leaves[dk] = infos;
  return { ok: true, text: reason + " " + start + "-" + end };
}

// 删除某天第 idx 条请假；删完最后一条移除该日期键。返回剩余条数
function removeLeaveEntry(cfg, dk, idx) {
  if (!cfg.leaves || !cfg.leaves.hasOwnProperty(dk)) return 0;
  const infos = parseLeaveValue(cfg.leaves[dk]);
  if (idx >= 0 && idx < infos.length) infos.splice(idx, 1);
  if (infos.length === 0) delete cfg.leaves[dk];
  else if (infos.length === 1)
    cfg.leaves[dk] = infos[0].start ? { reason: infos[0].reason, start: infos[0].start, end: infos[0].end } : infos[0].reason;
  else cfg.leaves[dk] = infos;
  return infos.length;
}

// ---------- 大小周 ----------
function getMondayOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function isBigWeek(cfg, date) {
  if (!cfg.bigSmallAnchor || !cfg.bigSmallAnchor.monday) return true;
  const weekStart = getMondayOfWeek(date);
  const anchor = new Date(cfg.bigSmallAnchor.monday + "T00:00:00");
  const weeksDiff = Math.round((weekStart - anchor) / (7 * 86400000));
  const anchorIsBig = cfg.bigSmallAnchor.type === "big";
  const sameAsAnchor = (((weeksDiff % 2) + 2) % 2) === 0;
  return sameAsAnchor ? anchorIsBig : !anchorIsBig;
}

function setThisWeekType(cfg, type) {
  cfg.bigSmallAnchor = { monday: ymd(getMondayOfWeek(new Date())), type: type };
}

// ---------- 工作日判定（全天假=休息日；时段假当天仍是工作日） ----------
function isWorkDay(cfg, date) {
  var override = getHolidayOverride(cfg, date);
  if (override === "workday") { if (isFullLeaveDay(cfg, date)) return false; return true; }
  if (override === "holiday") return false;
  if (isFullLeaveDay(cfg, date)) return false;
  const idx = date.getDay();
  const sch = cfg.schedules[idx];
  if (!sch) return false;
  if (cfg.mode === "bigSmall" && idx === 6) return isBigWeek(cfg, date) && !!sch.workStart && !!sch.workEnd;
  return !!sch.enabled;
}

// 大小周：按日期返回当天实际生效的 schedule
function daySchedule(cfg, date) {
  const idx = date.getDay();
  const sch = cfg.schedules[idx];
  if (!sch) return null;
  if (cfg.mode === "bigSmall" && idx >= 1 && idx <= 5 && sch.small && !isBigWeek(cfg, date)) return sch.small;
  return sch;
}

// 深拷贝时间+休息（不含 enabled），用于初始化小周配置
function cloneDayTimes(s) {
  return {
    workStart: s.workStart,
    workEnd: s.workEnd,
    breaks: (s.breaks || []).map(function (b) { return { name: b.name, start: b.start, end: b.end }; }),
  };
}

// 比较两份时间配置（上班/下班/休息）是否完全一致；一致的小周覆盖没有意义，不显示标记、不落盘
function dayTimesEqual(a, b) {
  if (!a || !b) return false;
  if ((a.workStart || "09:00") !== (b.workStart || "09:00")) return false;
  if ((a.workEnd || "18:00") !== (b.workEnd || "18:00")) return false;
  const ba = a.breaks || [], bb = b.breaks || [];
  if (ba.length !== bb.length) return false;
  for (let i = 0; i < ba.length; i++) {
    if ((ba[i].name || "") !== (bb[i].name || "") ||
      (ba[i].start || "") !== (bb[i].start || "") ||
      (ba[i].end || "") !== (bb[i].end || "")) return false;
  }
  return true;
}

// ---------- 工时计算 ----------
// [from, to] 区间内扣掉休息后的净工作毫秒
function netWorkMs(day, from, to) {
  if (!day) return 0;
  const base = from.getTime();
  const ws = toDate(day.workStart, base);
  const we = toDate(day.workEnd, base);
  const lo = new Date(Math.max(from.getTime(), ws.getTime()));
  const hi = new Date(Math.min(to.getTime(), we.getTime()));
  if (hi <= lo) return 0;
  let total = hi - lo;
  (day.breaks || []).forEach(function (b) {
    if (!b || !b.start || !b.end) return;
    const bs = toDate(b.start, base);
    const be = toDate(b.end, base);
    const overlap = Math.max(0, Math.min(hi, be) - Math.max(lo, bs));
    total -= overlap;
  });
  return Math.max(0, total);
}

function totalWorkMs(day) {
  if (!day) return 0;
  const base = Date.now();
  return netWorkMs(day, toDate(day.workStart, base), toDate(day.workEnd, base));
}

// 当前是否处于某段休息中
function currentBreak(day, now) {
  if (!day) return null;
  const base = now.getTime();
  for (const b of (day.breaks || [])) {
    if (!b || !b.start || !b.end) continue;
    const bs = toDate(b.start, base);
    const be = toDate(b.end, base);
    if (now >= bs && now < be) return b;
  }
  return null;
}

function findNextBreak(day, now) {
  if (!day || !day.breaks || day.breaks.length === 0) return null;
  const base = now.getTime();
  let earliest = null, name = null;
  for (const b of day.breaks) {
    if (!b || !b.start || !b.end) continue;
    const bs = toDate(b.start, base);
    if (bs > now) { if (!earliest || bs < earliest) { earliest = bs; name = b.name || "休息"; } }
  }
  return earliest ? { time: earliest, name: name } : null;
}

// 找最近一个工作日的上班时间
function findNextWorkStart(cfg, from) {
  for (let i = 1; i <= 14; i++) {
    const next = new Date(from.getTime() + i * 86400000);
    if (isWorkDay(cfg, next)) {
      const ni = next.getDay();
      const sch = daySchedule(cfg, next);
      return { date: next, idx: ni, start: toDate(sch.workStart, next.getTime()) };
    }
  }
  return null;
}

// ---------- 进度计算（双口径） ----------
// 工时口径（computeWeek/MonthProgress）：所有请假日一律 0 工时——本周/本月总工时与"还需"随请假减少；
// 工资口径（computeWeek/MonthPaidTime）：带薪假照常计入，作为时薪费率与已赚的基准（带薪假不影响当月工资）。
function rangeTime(cfg, now, start, days, forSalary) {
  let totalMs = 0, doneMs = 0, futureWorkMs = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    // 非工作日（周末/法定假/小周周六）本就不计工时：按"不看请假"口径剔除；
    // 必须用 IgnoringLeave 版本，请假日的扣减交给下面 lvs 分支（带薪全天假工资口径仍计满额）
    if (!isWorkDayIgnoringLeave(cfg, d)) continue;
    const lvs = leaveInfosOf(cfg, d);
    const fullDay = !!(lvs && lvs.length && lvs.some(function (l) { return !l.start; }));
    let sch;
    if (fullDay) {
      // 全天假：工时口径整日 0；工资口径仅带薪按满额计
      if (!(forSalary && isPaidLeaveDay(cfg, d))) continue;
      sch = daySchedule(cfg, d);
    } else if (lvs && lvs.length) {
      // 时段假（可多段）：工时口径注入全部假段；工资口径只注入不带薪段（带薪段照常计薪）
      sch = effectiveDaySchedule(cfg, d, forSalary);
    } else {
      sch = daySchedule(cfg, d);
    }
    const dayTotal = totalWorkMs(sch);
    totalMs += dayTotal;
    if (ymd(d) < ymd(now)) {
      doneMs += dayTotal;
    } else {
      const ws = toDate(sch.workStart, d.getTime());
      if (ymd(d) === ymd(now) && now > ws) doneMs += netWorkMs(sch, ws, now);
      // 今天/未来仍需实际上班的工时（全天假=0；时段假=注入全部假段后的剩余）。
      // 已赚口径=确定到手：totalMs−futureWorkMs，带薪假（含未来）立即视为已赚
      if (!fullDay) {
        const workSch = forSalary && lvs && lvs.length ? effectiveDaySchedule(cfg, d, false) : sch;
        const wTotal = totalWorkMs(workSch);
        const wDone = ymd(d) === ymd(now) && now > ws ? netWorkMs(workSch, ws, now) : 0;
        futureWorkMs += Math.max(0, wTotal - wDone);
      }
    }
  }
  return { totalMs, doneMs, futureWorkMs };
}
function pctOf(r) {
  return r.totalMs > 0 ? Math.min(100, Math.max(0, (r.doneMs / r.totalMs) * 100)) : 0;
}
function computeWeekProgress(cfg, now) {
  const r = rangeTime(cfg, now, getMondayOfWeek(now), 7, false);
  return { pct: pctOf(r), totalMs: r.totalMs, doneMs: r.doneMs };
}
function computeMonthProgress(cfg, now) {
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const r = rangeTime(cfg, now, new Date(now.getFullYear(), now.getMonth(), 1), days, false);
  return { pct: pctOf(r), totalMs: r.totalMs, doneMs: r.doneMs };
}
function computeWeekPaidTime(cfg, now) {
  return rangeTime(cfg, now, getMondayOfWeek(now), 7, true);
}
function computeMonthPaidTime(cfg, now) {
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return rangeTime(cfg, now, new Date(now.getFullYear(), now.getMonth(), 1), days, true);
}
// 标准月工时：本月"若无人请假"的应上工时（每个应上班日按满排班计，周末/法定假剔除）——时薪费率分母。
// 分母不随请假浮动：事假天已赚不累计 → 月底已赚 < 月薪（事假扣款）；带薪假天照常累计 → 月底拿满。
// 不能用 computeMonthPaidTime 的 totalMs 当分母：它会剔除不带薪假，分母变小费率变大，月底又补回满月薪，事假等于没扣。
function computeMonthStandardTime(cfg, now) {
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  let totalMs = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), 1 + i);
    if (!isWorkDayIgnoringLeave(cfg, d)) continue;
    totalMs += totalWorkMs(daySchedule(cfg, d));
  }
  return totalMs;
}

module.exports = {
  WEEK_ORDER, WEEK_LABEL, WEEK_FULL,
  ymd, toDate,
  getHolidayOverride, isBuiltinHoliday, isLeaveDay, leaveReasonOf, normalizeLeaveReason,
  parseLeaveEntry, parseLeaveValue, leaveInfosOf, isFullLeaveDay, isPaidLeaveDay, effectiveDaySchedule,
  addLeaveEntry, removeLeaveEntry,
  getMondayOfWeek, isBigWeek, setThisWeekType,
  isWorkDay, daySchedule, cloneDayTimes, dayTimesEqual,
  netWorkMs, totalWorkMs, currentBreak, findNextBreak, findNextWorkStart,
  computeWeekProgress, computeMonthProgress, computeWeekPaidTime, computeMonthPaidTime, computeMonthStandardTime,
};
