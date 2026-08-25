/* ============================================================
   config.js — 配置默认值 / 解析 / 压缩(导出) / 存储
   存储层用 wx.setStorageSync 替代原 localStorage + Capacitor Preferences。
   导出压缩格式与安卓端完全互通（compactConfig/expandConfig 一致）。
   ============================================================ */

const STORAGE_KEY = "work-countdown-config-v3";
const CFG_VERSION = 2; // 配置版本：用于一次性默认值迁移
const sched = require("./schedule.js");

// ---------- 默认配置 ----------
function defaultDay(enabled) {
  return {
    enabled: enabled,
    workStart: "09:00",
    workEnd: "18:00",
    breaks: enabled ? [{ name: "午休", start: "12:00", end: "13:00" }] : [],
  };
}

function defaultSchedules() {
  return {
    0: defaultDay(false),
    1: defaultDay(true),
    2: defaultDay(true),
    3: defaultDay(true),
    4: defaultDay(true),
    5: defaultDay(true),
    6: defaultDay(false),
  };
}

function defaultConfig() {
  return {
    schedules: defaultSchedules(),
    mode: "fixed",
    bigSmallAnchor: null,
    holidays: {},
    deletedBuiltinHolidays: {},
    remoteHolidays: {},
    dayOverrides: {},
    leaves: {},
    // 默认开启：本月工作进度 + 工资显示，默认月工资 5000
    showMonthProgress: true,
    salaryEnabled: true,
    monthlySalary: 5000,
    _v: CFG_VERSION,
  };
}

// ---------- 配置解析（容错 + 补默认值） ----------
function parseConfig(saved) {
  if (saved && saved.schedules) {
    const def = defaultSchedules();
    const out = {};
    for (const k of Object.keys(def)) {
      out[k] = Object.assign({ breaks: [] }, def[k], saved.schedules[k] || {});
      if (!Array.isArray(out[k].breaks)) out[k].breaks = [];
      out[k].breaks.forEach((br, idx) => { if (!br.name) br.name = "休息" + (idx + 1); });
      if (out[k].small && typeof out[k].small === "object") {
        var sm = out[k].small;
        var smBreaks = Array.isArray(sm.breaks) ? sm.breaks : [];
        smBreaks.forEach((br, idx) => { if (!br.name) br.name = "休息" + (idx + 1); });
        out[k].small = { workStart: sm.workStart || "09:00", workEnd: sm.workEnd || "18:00", breaks: smBreaks };
      } else { delete out[k].small; }
    }
    return {
      schedules: out,
      mode: saved.mode === "bigSmall" ? "bigSmall" : "fixed",
      bigSmallAnchor: (saved.bigSmallAnchor && saved.bigSmallAnchor.monday) ? saved.bigSmallAnchor : null,
      holidays: (saved.holidays && typeof saved.holidays === "object") ? saved.holidays : {},
      deletedBuiltinHolidays: (saved.deletedBuiltinHolidays && typeof saved.deletedBuiltinHolidays === "object") ? saved.deletedBuiltinHolidays : {},
      remoteHolidays: (saved.remoteHolidays && typeof saved.remoteHolidays === "object" && !Array.isArray(saved.remoteHolidays)) ? saved.remoteHolidays : {},
      dayOverrides: (function () {
        var src = (saved.dayOverrides && typeof saved.dayOverrides === "object" && !Array.isArray(saved.dayOverrides)) ? saved.dayOverrides : {};
        var out = {};
        var dateRe = /^\d{4}-\d{2}-\d{2}$/;
        Object.keys(src).forEach(function (k) {
          if (!dateRe.test(k)) return;
          var v = src[k];
          if (!v || typeof v !== "object") return;
          if (v.off) { out[k] = { off: true }; return; }
          var ws = sched.normHM(v.workStart), we = sched.normHM(v.workEnd);
          if (!ws || !we || ws >= we) return;
          var br = Array.isArray(v.breaks)
            ? v.breaks
                .filter(function (b) { return b && typeof b === "object" && sched.normHM(b.start) && sched.normHM(b.end) && sched.normHM(b.start) < sched.normHM(b.end); })
                .map(function (b) { return { name: b.name || "休息", start: sched.normHM(b.start), end: sched.normHM(b.end) }; })
            : [];
          out[k] = { workStart: ws, workEnd: we, breaks: br };
        });
        return out;
      })(),
      leaves: (saved.leaves && typeof saved.leaves === "object") ? saved.leaves : {},
      showMonthProgress: !!saved.showMonthProgress,
      salaryEnabled: !!saved.salaryEnabled,
      monthlySalary: (typeof saved.monthlySalary === "number" && isFinite(saved.monthlySalary) && saved.monthlySalary >= 0) ? saved.monthlySalary : 0,
      // 安卓端"下班前提醒"提前分钟数；小程序无通知能力，仅存储透传保证导入导出不丢
      offworkReminder: (typeof saved.offworkReminder === "number" && isFinite(saved.offworkReminder) && saved.offworkReminder > 0) ? Math.min(240, Math.round(saved.offworkReminder)) : 0,
    };
  }
  return defaultConfig();
}

// ---------- 配置压缩 / 解压（用于导入导出，短键名） ----------
function compactBreaks(breaks) {
  if (!breaks || breaks.length === 0) return null;
  return breaks.map(function (br) {
    if (br.name === "午休") return [br.start, br.end];
    return [br.name || "", br.start, br.end];
  });
}
function expandBreaks(cb) {
  if (!cb) return [];
  var result = [];
  cb.forEach(function (arr) {
    if (arr.length >= 3) result.push({ name: arr[0] || ("休息" + (result.length + 1)), start: arr[1], end: arr[2] });
    else result.push({ name: "午休", start: arr[0], end: arr[1] });
  });
  return result;
}
// 单日调班压缩：{off:true}→0；{ws,we,breaks}→[ws,we,breaks?]（与安卓端一致）
function compactOverrides(ov) {
  var out = {};
  Object.keys(ov).forEach(function (d) {
    var v = ov[d];
    if (!v || typeof v !== "object") return;
    if (v.off) { out[d] = 0; return; }
    if (typeof v.workStart !== "string" || typeof v.workEnd !== "string") return;
    var arr = [v.workStart, v.workEnd];
    var cb = compactBreaks(v.breaks);
    if (cb) arr.push(cb);
    out[d] = arr;
  });
  return out;
}
function expandOverrides(co) {
  var out = {};
  Object.keys(co).forEach(function (d) {
    var v = co[d];
    if (v === 0 || v === "off") out[d] = { off: true };
    else if (Array.isArray(v) && typeof v[0] === "string" && typeof v[1] === "string") out[d] = { workStart: v[0], workEnd: v[1], breaks: expandBreaks(Array.isArray(v[2]) ? v[2] : null) };
  });
  return out;
}

function compactConfig(cfg) {
  // remoteHolidays 故意不参与压缩导出：属可再获取的在线数据，避免撑大配置文本
  var out = { s: {}, m: cfg.mode || "fixed" };
  if (cfg.bigSmallAnchor) out.a = cfg.bigSmallAnchor;
  for (var k in cfg.schedules) {
    var d = cfg.schedules[k];
    var cd = { e: d.enabled ? 1 : 0 };
    if (d.workStart && d.workStart !== "09:00") cd.ws = d.workStart;
    if (d.workEnd && d.workEnd !== "18:00") cd.we = d.workEnd;
    var cb = compactBreaks(d.breaks);
    if (cb) cd.b = cb;
    if (d.small && !sched.dayTimesEqual(d.small, d)) {
      var sm = { ws: d.small.workStart || "09:00", we: d.small.workEnd || "18:00" };
      var smb = compactBreaks(d.small.breaks);
      if (smb) sm.b = smb;
      cd.sm = sm;
    }
    out.s[k] = cd;
  }
  if (cfg.holidays && Object.keys(cfg.holidays).length > 0) out.h = cfg.holidays;
  if (cfg.deletedBuiltinHolidays && Object.keys(cfg.deletedBuiltinHolidays).length > 0) out.dh = cfg.deletedBuiltinHolidays;
  if (cfg.dayOverrides && Object.keys(cfg.dayOverrides).length > 0) out.do = compactOverrides(cfg.dayOverrides);
  if (cfg.leaves && Object.keys(cfg.leaves).length > 0) out.lv = cfg.leaves;
  var other = {};
  if (cfg.showMonthProgress) other.mp = 1;
  if (cfg.salaryEnabled) other.se = 1;
  if (cfg.monthlySalary > 0) other.ms = cfg.monthlySalary;
  if (cfg.offworkReminder > 0) other.rem = cfg.offworkReminder;
  if (Object.keys(other).length > 0) out.o = other;
  return out;
}

function expandConfig(compact) {
  if (!compact || !compact.s) return null;
  var out = { schedules: {}, mode: compact.m === "bigSmall" ? "bigSmall" : "fixed", bigSmallAnchor: compact.a || null };
  for (var k in compact.s) {
    var cd = compact.s[k];
    var day = { enabled: !!cd.e, workStart: cd.ws || "09:00", workEnd: cd.we || "18:00", breaks: expandBreaks(cd.b) };
    if (cd.sm) day.small = { workStart: cd.sm.ws || "09:00", workEnd: cd.sm.we || "18:00", breaks: expandBreaks(cd.sm.b) };
    out.schedules[k] = day;
  }
  if (compact.h) out.holidays = compact.h;
  if (compact.dh) out.deletedBuiltinHolidays = compact.dh;
  if (compact.do) out.dayOverrides = expandOverrides(compact.do);
  if (compact.lv) out.leaves = compact.lv;
  if (compact.o) {
    out.showMonthProgress = !!compact.o.mp;
    out.salaryEnabled = !!compact.o.se;
    out.monthlySalary = (typeof compact.o.ms === "number" && compact.o.ms >= 0) ? compact.o.ms : 0;
    out.offworkReminder = (typeof compact.o.rem === "number" && compact.o.rem > 0) ? Math.min(240, Math.round(compact.o.rem)) : 0;
  }
  return out;
}

// ---------- 存储层 ----------
function load() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      const cfg = parseConfig(saved);
      // 旧版配置（无 _v）迁移：只补缺失字段的默认值，不覆盖用户已保存的值
      const needsMigration = !saved._v || saved._v < CFG_VERSION;
      if (needsMigration) {
        if (typeof saved.showMonthProgress === "undefined") cfg.showMonthProgress = true;
        if (typeof saved.salaryEnabled === "undefined") cfg.salaryEnabled = true;
        if (typeof saved.monthlySalary === "undefined" && !(cfg.monthlySalary > 0)) cfg.monthlySalary = 5000;
      }
      cfg._v = CFG_VERSION;
      if (needsMigration) save(cfg);
      return cfg;
    }
  } catch (e) {}
  return defaultConfig();
}

function save(cfg) {
  try {
    wx.setStorageSync(STORAGE_KEY, JSON.stringify(cfg));
  } catch (e) {}
}

module.exports = {
  STORAGE_KEY,
  defaultDay, defaultSchedules, defaultConfig,
  parseConfig, compactConfig, expandConfig,
  load, save,
};
