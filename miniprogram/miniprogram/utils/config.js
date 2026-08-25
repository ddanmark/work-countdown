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
      leaves: (saved.leaves && typeof saved.leaves === "object") ? saved.leaves : {},
      showMonthProgress: !!saved.showMonthProgress,
      salaryEnabled: !!saved.salaryEnabled,
      monthlySalary: (typeof saved.monthlySalary === "number" && isFinite(saved.monthlySalary) && saved.monthlySalary >= 0) ? saved.monthlySalary : 0,
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

function compactConfig(cfg) {
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
  if (cfg.leaves && Object.keys(cfg.leaves).length > 0) out.lv = cfg.leaves;
  var other = {};
  if (cfg.showMonthProgress) other.mp = 1;
  if (cfg.salaryEnabled) other.se = 1;
  if (cfg.monthlySalary > 0) other.ms = cfg.monthlySalary;
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
  if (compact.lv) out.leaves = compact.lv;
  if (compact.o) {
    out.showMonthProgress = !!compact.o.mp;
    out.salaryEnabled = !!compact.o.se;
    out.monthlySalary = (typeof compact.o.ms === "number" && compact.o.ms >= 0) ? compact.o.ms : 0;
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
      // 旧版配置（无 _v）迁移：补上新的默认值
      const needsMigration = !saved._v || saved._v < CFG_VERSION;
      if (needsMigration) {
        cfg.showMonthProgress = true;
        cfg.salaryEnabled = true;
        cfg.monthlySalary = 5000;
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
