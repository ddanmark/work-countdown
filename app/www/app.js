/* ============================================================
   app.js — 下班了吗 ⏰ 主逻辑
   ============================================================ */
(function () {
  "use strict";

  const STORAGE_KEY = "work-countdown-config-v3";

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
  const BUILTIN_HOLIDAYS = {};
  const BUILTIN_HOLIDAY_CATEGORIES = {};
  HOLIDAY_GROUPS.forEach(function (g) {
    g.holidays.forEach(function (d) {
      BUILTIN_HOLIDAYS[d] = "holiday";
      BUILTIN_HOLIDAY_CATEGORIES[d] = g.name;
    });
    g.workdays.forEach(function (d) {
      BUILTIN_HOLIDAYS[d] = "workday";
      BUILTIN_HOLIDAY_CATEGORIES[d] = g.name;
    });
  });

  // ---------- 在线节假日数据 ----------
  // 数据源为仓库 holidays.json 的 raw 链接，抓取后存入 cfg.remoteHolidays（结构与 holidays.json 的 years 一致）。
  // 优先级：用户自定义 > 已删除内置 > 在线数据 > 内置编译数据（在线数据可修正内置同日数据）。
  // 注意：remoteHolidays 不参与导出/导入（可随时重新在线获取，避免撑大二维码），导入配置后需重新在线更新。
  const HOLIDAY_FEED_URL = "https://gitee.com/Nasblance/work-countdown/raw/main/holidays.json";
  let REMOTE_HOLIDAYS = {}; // date -> "holiday" | "workday"
  let REMOTE_CATEGORIES = {}; // date -> 组名
  let REMOTE_YEARS = []; // 已加载年份（显示用）
  function rebuildRemoteHolidays() {
    REMOTE_HOLIDAYS = {};
    REMOTE_CATEGORIES = {};
    REMOTE_YEARS = [];
    var src = cfg && cfg.remoteHolidays;
    if (!src || typeof src !== "object") return;
    Object.keys(src).sort().forEach(function (y) {
      if (!/^\d{4}$/.test(y) || !Array.isArray(src[y])) return;
      var n = 0;
      src[y].forEach(function (g) {
        if (!g || typeof g.name !== "string" || !Array.isArray(g.holidays) || !Array.isArray(g.workdays)) return;
        g.holidays.forEach(function (d) { REMOTE_HOLIDAYS[d] = "holiday"; REMOTE_CATEGORIES[d] = g.name; n++; });
        g.workdays.forEach(function (d) { REMOTE_HOLIDAYS[d] = "workday"; REMOTE_CATEGORIES[d] = g.name; n++; });
      });
      if (n > 0) REMOTE_YEARS.push(y);
    });
  }
  function isPresetHolidayKey(key) {
    return BUILTIN_HOLIDAYS.hasOwnProperty(key) || REMOTE_HOLIDAYS.hasOwnProperty(key);
  }
  function builtinHolidayYears() {
    var s = {};
    HOLIDAY_GROUPS.forEach(function (g) {
      g.holidays.concat(g.workdays).forEach(function (d) { s[d.slice(0, 4)] = 1; });
    });
    return Object.keys(s).sort();
  }
  // 校验在线数据（白名单重建，规则与 tools/gen-holidays.js 一致），非法即抛错
  function validateRemoteHolidayData(data) {
    function bad(m) { throw new Error(m); }
    if (!data || typeof data !== "object") bad("数据格式无效");
    var years = data.years;
    if (!years || typeof years !== "object" || Array.isArray(years)) bad("缺少 years 字段");
    var clean = {}, seen = {}, total = 0;
    var dateRe = /^\d{4}-\d{2}-\d{2}$/;
    Object.keys(years).forEach(function (y) {
      if (!/^\d{4}$/.test(y) || +y < 2020 || +y > 2099) bad("年份无效: " + y);
      if (!Array.isArray(years[y])) bad(y + " 年数据格式无效");
      var groups = [];
      years[y].forEach(function (g) {
        if (!g || typeof g.name !== "string" || !g.name || !Array.isArray(g.holidays) || !Array.isArray(g.workdays)) bad(y + " 年存在无效分组");
        var grp = { name: g.name, holidays: [], workdays: [] };
        function check(d, kind) {
          if (typeof d !== "string" || !dateRe.test(d)) bad("日期格式无效: " + d);
          var t = new Date(d + "T00:00:00");
          if (isNaN(t.getTime()) || t.getFullYear() !== +d.slice(0, 4) || t.getMonth() !== +d.slice(5, 7) - 1 || t.getDate() !== +d.slice(8, 10)) bad("无效日期: " + d);
          if (d.slice(0, 4) !== y) bad(d + " 与所在年份 " + y + " 不符");
          if (seen[d]) bad("日期重复: " + d);
          seen[d] = 1; grp[kind].push(d); total++;
        }
        g.holidays.forEach(function (d) { check(d, "holidays"); });
        g.workdays.forEach(function (d) { check(d, "workdays"); });
        groups.push(grp);
      });
      clean[y] = groups;
    });
    if (total === 0) bad("数据为空");
    if (total > 500) bad("数据量异常（>500 天）");
    return { years: clean, count: total };
  }

  function getHolidayOverride(date) {
    var key = ymd(date);
    if (cfg.holidays && cfg.holidays.hasOwnProperty(key)) return cfg.holidays[key];
    if (cfg.deletedBuiltinHolidays && cfg.deletedBuiltinHolidays.hasOwnProperty(key)) return null;
    if (REMOTE_HOLIDAYS.hasOwnProperty(key)) return REMOTE_HOLIDAYS[key];
    if (BUILTIN_HOLIDAYS.hasOwnProperty(key)) return BUILTIN_HOLIDAYS[key];
    return null;
  }

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

  const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const WEEK_LABEL = { 0: "日", 1: "一", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六" };
  const WEEK_FULL = { 0: "周日", 1: "周一", 2: "周二", 3: "周三", 4: "周四", 5: "周五", 6: "周六" };

  // ---------- DOM ----------
  const el = {
    status: document.getElementById("statusBadge"),
    hh: document.getElementById("hh"),
    mm: document.getElementById("mm"),
    ss: document.getElementById("ss"),
    ms: document.getElementById("ms"),
    progressPct: document.getElementById("progressPct"),
    progressFill: document.getElementById("progressFill"),
    progressLabel: document.getElementById("progressLabel"),
    weekLabel: document.getElementById("weekLabel"),
    weekPct: document.getElementById("weekPct"),
    weekFill: document.getElementById("weekFill"),
    subInfo: document.getElementById("subInfo"),
    calendarCard: document.getElementById("calendarCard"),
    calGrid: document.getElementById("calGrid"),
    calPrevBtn: document.getElementById("calPrevBtn"),
    calNextBtn: document.getElementById("calNextBtn"),
    calMonthLabel: document.getElementById("calMonthLabel"),
    settingsBtn: document.getElementById("settingsBtn"),
    settingsPanel: document.getElementById("settingsPanel"),
    settingsOverlay: document.getElementById("settingsOverlay"),
    settingsClose: document.getElementById("settingsClose"),
    card: document.getElementById("card"),
    modeTabs: document.getElementById("modeTabs"),
    bigSmallConfig: document.getElementById("bigSmallConfig"),
    weekTypeSelector: document.getElementById("weekTypeSelector"),
    weekdayBar: document.getElementById("weekdayBar"),
    weekdayLegend: document.getElementById("weekdayLegend"),
    dayEditorTitle: document.getElementById("dayEditorTitle"),
    dayBody: document.getElementById("dayBody"),
    workdayToggle: document.getElementById("workdayToggle"),
    workdayCheck: document.getElementById("workdayCheck"),
    satInfo: document.getElementById("satInfo"),
    variantSelector: document.getElementById("variantSelector"),
    variantClearBtn: document.getElementById("variantClearBtn"),
    workStartBox: document.getElementById("workStart"),
    workEndBox: document.getElementById("workEnd"),
    workDurationHint: document.getElementById("workDurationHint"),
    breakList: document.getElementById("breakList"),
    addBreakBtn: document.getElementById("addBreakBtn"),
    applyAllBtn: document.getElementById("applyAllBtn"),
    resetBtn: document.getElementById("resetBtn"),
    exportBtn: document.getElementById("exportBtn"),
    importBtn: document.getElementById("importBtn"),
    qrExportOverlay: document.getElementById("qrExportOverlay"),
    qrCodeBox: document.getElementById("qrCodeBox"),
    qrExportClose: document.getElementById("qrExportClose"),
    qrImportOverlay: document.getElementById("qrImportOverlay"),
    qrImportScan: document.getElementById("qrImportScan"),
    qrImportAlbum: document.getElementById("qrImportAlbum"),
    qrImportClose: document.getElementById("qrImportClose"),
    qrFileInput: document.getElementById("qrFileInput"),
    qrExportText: document.getElementById("qrExportText"),
    qrExportCopy: document.getElementById("qrExportCopy"),
    qrExportShareFile: document.getElementById("qrExportShareFile"),
    qrImportPaste: document.getElementById("qrImportPaste"),
    qrImportFile: document.getElementById("qrImportFile"),
    fileImportInput: document.getElementById("fileImportInput"),
    pasteImportOverlay: document.getElementById("pasteImportOverlay"),
    pasteImportText: document.getElementById("pasteImportText"),
    pasteImportConfirm: document.getElementById("pasteImportConfirm"),
    pasteImportClose: document.getElementById("pasteImportClose"),
    scanOverlay: document.getElementById("scanOverlay"),
    scanVideo: document.getElementById("scanVideo"),
    scanHint: document.getElementById("scanHint"),
    scanCancel: document.getElementById("scanCancel"),
    toast: document.getElementById("toast"),
    holidayDateInput: document.getElementById("holidayDateInput"),
    holidayTypeSelect: document.getElementById("holidayTypeSelect"),
    holidayAddBtn: document.getElementById("holidayAddBtn"),
    holidayBuiltinList: document.getElementById("holidayBuiltinList"),
    holidayCustomList: document.getElementById("holidayCustomList"),
    holidaySubtabBar: document.getElementById("holidaySubtabBar"),
    holidayResetBtn: document.getElementById("holidayResetBtn"),
    holidayUpdateBtn: document.getElementById("holidayUpdateBtn"),
    holidayOnlineStatus: document.getElementById("holidayOnlineStatus"),
    calStatsBtn: document.getElementById("calStatsBtn"),
    statsOverlay: document.getElementById("statsOverlay"),
    statsTitle: document.getElementById("statsTitle"),
    statsMonthLabel: document.getElementById("statsMonthLabel"),
    statsBody: document.getElementById("statsBody"),
    statsPrevBtn: document.getElementById("statsPrevBtn"),
    statsNextBtn: document.getElementById("statsNextBtn"),
    statsClose: document.getElementById("statsClose"),
    leaveDateInput: document.getElementById("leaveDateInput"),
    leaveReasonInput: document.getElementById("leaveReasonInput"),
    leaveAllDayCheck: document.getElementById("leaveAllDayCheck"),
    leaveStartBox: document.getElementById("leaveStartBox"),
    leaveEndBox: document.getElementById("leaveEndBox"),
    leaveTimeSep: document.getElementById("leaveTimeSep"),
    leaveAddBtn: document.getElementById("leaveAddBtn"),
    leaveList: document.getElementById("leaveList"),
    leaveClearBtn: document.getElementById("leaveClearBtn"),
    showMonthProgressCheck: document.getElementById("showMonthProgressCheck"),
    salaryEnabledCheck: document.getElementById("salaryEnabledCheck"),
    offworkReminderCheck: document.getElementById("offworkReminderCheck"),
    offworkReminderRow: document.getElementById("offworkReminderRow"),
    offworkMinSelect: document.getElementById("offworkMinSelect"),
    salaryConfig: document.getElementById("salaryConfig"),
    monthlySalaryInput: document.getElementById("monthlySalaryInput"),
    monthWrap: document.getElementById("monthWrap"),
    monthLabel: document.getElementById("monthLabel"),
    monthPct: document.getElementById("monthPct"),
    monthFill: document.getElementById("monthFill"),
    dayEarned: document.getElementById("dayEarned"),
    weekEarned: document.getElementById("weekEarned"),
    monthEarned: document.getElementById("monthEarned"),
  };

  let cfg = parseConfig(null);
  let editingDay = new Date().getDay();
  let editingVariant = "big"; // 大小周编辑视图："big"（主/大周）| "small"（小周覆盖）
  let workStartPicker = null,
    workEndPicker = null;
  let isInitialLoad = true;

  // ---------- 配置解析 ----------
  function parseConfig(saved) {
    if (saved && saved.schedules) {
      const def = defaultSchedules();
      const out = {};
      for (const k of Object.keys(def)) {
        out[k] = Object.assign({ breaks: [] }, def[k], saved.schedules[k] || {});
        if (!Array.isArray(out[k].breaks)) out[k].breaks = [];
        out[k].breaks.forEach((br, idx) => {
          if (!br.name) br.name = "休息" + (idx + 1);
        });
        if (out[k].small && typeof out[k].small === "object") {
          var sm = out[k].small;
          var smBreaks = Array.isArray(sm.breaks) ? sm.breaks : [];
          smBreaks.forEach((br, idx) => {
            if (!br.name) br.name = "休息" + (idx + 1);
          });
          out[k].small = { workStart: sm.workStart || "09:00", workEnd: sm.workEnd || "18:00", breaks: smBreaks };
        } else {
          delete out[k].small;
        }
      }
      return {
        schedules: out,
        mode: saved.mode === "bigSmall" ? "bigSmall" : "fixed",
        bigSmallAnchor: saved.bigSmallAnchor && saved.bigSmallAnchor.monday ? saved.bigSmallAnchor : null,
        holidays: saved.holidays && typeof saved.holidays === "object" ? saved.holidays : {},
        deletedBuiltinHolidays: saved.deletedBuiltinHolidays && typeof saved.deletedBuiltinHolidays === "object" ? saved.deletedBuiltinHolidays : {},
        remoteHolidays: saved.remoteHolidays && typeof saved.remoteHolidays === "object" && !Array.isArray(saved.remoteHolidays) ? saved.remoteHolidays : {},
        dayOverrides: (function () {
          var src = saved.dayOverrides && typeof saved.dayOverrides === "object" && !Array.isArray(saved.dayOverrides) ? saved.dayOverrides : {};
          var out = {};
          var dateRe = /^\d{4}-\d{2}-\d{2}$/;
          Object.keys(src).forEach(function (k) {
            if (!dateRe.test(k)) return;
            var v = src[k];
            if (!v || typeof v !== "object") return;
            if (v.off) { out[k] = { off: true }; return; }
            var ws = normHM(v.workStart), we = normHM(v.workEnd);
            if (!ws || !we || ws >= we) return;
            var br = Array.isArray(v.breaks)
              ? v.breaks
                  .filter(function (b) { return b && typeof b === "object" && normHM(b.start) && normHM(b.end) && normHM(b.start) < normHM(b.end); })
                  .map(function (b) { return { name: b.name || "休息", start: normHM(b.start), end: normHM(b.end) }; })
              : [];
            out[k] = { workStart: ws, workEnd: we, breaks: br };
          });
          return out;
        })(),
        leaves: saved.leaves && typeof saved.leaves === "object" ? saved.leaves : {},
        showMonthProgress: !!saved.showMonthProgress,
        salaryEnabled: !!saved.salaryEnabled,
        monthlySalary: typeof saved.monthlySalary === "number" && isFinite(saved.monthlySalary) && saved.monthlySalary >= 0 ? saved.monthlySalary : 0,
        offworkReminder: typeof saved.offworkReminder === "number" && isFinite(saved.offworkReminder) && saved.offworkReminder > 0 ? Math.min(240, Math.round(saved.offworkReminder)) : 0,
      };
    }
    return { schedules: defaultSchedules(), mode: "fixed", bigSmallAnchor: null, holidays: {}, deletedBuiltinHolidays: {}, remoteHolidays: {}, dayOverrides: {}, leaves: {}, showMonthProgress: false, salaryEnabled: false, monthlySalary: 0, offworkReminder: 0 };
  }

  // ---------- 配置压缩/解压 ----------
  function compactBreaks(breaks) {
    if (!breaks || breaks.length === 0) return null;
    return breaks.map(function (br) {
      if (br.name === "午休") return [br.start, br.end];
      return [br.name || "", br.start, br.end];
    });
  }
  // 单日调班压缩：{off:true}→0；{ws,we,breaks}→[ws,we,breaks?]
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
  function expandBreaks(cb) {
    if (!cb) return [];
    var result = [];
    cb.forEach(function (arr) {
      if (arr.length >= 3) result.push({ name: arr[0] || "休息" + (result.length + 1), start: arr[1], end: arr[2] });
      else result.push({ name: "午休", start: arr[0], end: arr[1] });
    });
    return result;
  }
  function compactConfig(cfg) {
    // remoteHolidays 故意不参与压缩导出：属可再获取的在线数据，避免撑大二维码
    var out = { s: {}, m: cfg.mode || "fixed" };
    if (cfg.bigSmallAnchor) out.a = cfg.bigSmallAnchor;
    for (var k in cfg.schedules) {
      var d = cfg.schedules[k];
      var cd = { e: d.enabled ? 1 : 0 };
      if (d.workStart && d.workStart !== "09:00") cd.ws = d.workStart;
      if (d.workEnd && d.workEnd !== "18:00") cd.we = d.workEnd;
      var cb = compactBreaks(d.breaks);
      if (cb) cd.b = cb;
      if (d.small && !dayTimesEqual(d.small, d)) {
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
      out.monthlySalary = typeof compact.o.ms === "number" && compact.o.ms >= 0 ? compact.o.ms : 0;
      out.offworkReminder = typeof compact.o.rem === "number" && compact.o.rem > 0 ? Math.min(240, Math.round(compact.o.rem)) : 0;
    }
    return out;
  }

  // ---------- 存储层 ----------
  function getPreferencesPlugin() {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) {
      return window.Capacitor.Plugins.Preferences;
    }
    return null;
  }
  function readLocalSync() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch (e) {
      return null;
    }
  }
  async function loadConfigAsync() {
    const pref = getPreferencesPlugin();
    if (pref) {
      try {
        const { value } = await pref.get({ key: STORAGE_KEY });
        if (value) return JSON.parse(value);
      } catch (e) {}
    }
    return readLocalSync();
  }
  function persist() {
    const str = JSON.stringify(cfg);
    try {
      localStorage.setItem(STORAGE_KEY, str);
    } catch (e) {}
    isInitialLoad = false;
    calVersion++; // 配置变更：让月历缓存 key 失效，触发重渲染
    const pref = getPreferencesPlugin();
    if (pref) pref.set({ key: STORAGE_KEY, value: str }).catch(function () {});
  }

  // ---------- 工具 ----------
  function toDate(hhmm, base) {
    const [h, m] = hhmm.split(":").map(Number);
    const d = new Date(base);
    d.setHours(h, m, 0, 0);
    return d;
  }
  function pad(n) {
    return String(n).padStart(2, "0");
  }

  // ---------- 自定义时间选择器 ----------
  function createTimePicker(initialValue, onChange) {
    let curH = 9,
      curM = 0;
    const wrap = document.createElement("div");
    wrap.className = "tp";
    const hourBtn = document.createElement("button");
    hourBtn.type = "button";
    hourBtn.className = "tp-btn";
    const colon = document.createElement("span");
    colon.className = "tp-colon";
    colon.textContent = ":";
    const minBtn = document.createElement("button");
    minBtn.type = "button";
    minBtn.className = "tp-btn";
    wrap.appendChild(hourBtn);
    wrap.appendChild(colon);
    wrap.appendChild(minBtn);

    function fire() {
      hourBtn.textContent = pad(curH);
      minBtn.textContent = pad(curM);
      if (onChange) onChange(pad(curH) + ":" + pad(curM));
    }
    function openPicker(type) {
      const overlay = document.createElement("div");
      overlay.className = "tp-picker-overlay";
      const panel = document.createElement("div");
      panel.className = "tp-picker-panel";
      const title = document.createElement("div");
      title.className = "tp-picker-title";
      title.textContent = type === "h" ? "选择小时" : "选择分钟";
      panel.appendChild(title);
      const grid = document.createElement("div");
      grid.className = "tp-picker-grid";
      const values = type === "h" ? Array.from({ length: 24 }, (_, i) => i) : Array.from({ length: 12 }, (_, i) => i * 5);
      const curVal = type === "h" ? curH : curM;
      values.forEach(function (v) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "tp-picker-cell";
        if (v === curVal) b.classList.add("active");
        b.textContent = pad(v);
        b.addEventListener("click", function () {
          if (type === "h") curH = v;
          else curM = v;
          fire();
          close();
        });
        grid.appendChild(b);
      });
      panel.appendChild(grid);
      function close() {
        overlay.classList.remove("open");
        setTimeout(function () {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, 200);
      }
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) close();
      });
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
      requestAnimationFrame(function () {
        overlay.classList.add("open");
      });
    }
    hourBtn.addEventListener("click", function () {
      openPicker("h");
    });
    minBtn.addEventListener("click", function () {
      openPicker("m");
    });
    const api = {
      el: wrap,
      getValue: function () {
        return pad(curH) + ":" + pad(curM);
      },
      setValue: function (hhmm) {
        const parts = (hhmm || "09:00").split(":").map(Number);
        curH = parts[0] || 0;
        curM = Math.floor((parts[1] || 0) / 5) * 5;
        fire();
      },
    };
    api.setValue(initialValue || "09:00");
    return api;
  }

  /**
   * 自定义日历日期选择器（替代 <input type="date">）。
   * 原因：部分安卓 WebView（尤其国产 ROM）点击 <input type="date"> 不弹日期选择器，
   * 甚至会让 WebView 崩溃重载到白屏。这里把日期输入改成只读文本，点击/聚焦弹自定义月历。
   */
  function createDatePicker(inputEl) {
    if (!inputEl) return;
    inputEl.setAttribute("readonly", "readonly");
    inputEl.setAttribute("inputmode", "none");
    var opened = false;
    function mkBtn(text, cls) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.textContent = text;
      return b;
    }
    function sameDay(a, b) {
      return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }
    function parseVal() {
      var v = inputEl.value;
      if (v) {
        var p = v.split("-");
        if (p.length === 3) return new Date(+p[0], +p[1] - 1, +p[2]);
      }
      return new Date();
    }
    function openPicker() {
      if (opened) return;
      opened = true;
      var view = parseVal();
      var overlay = document.createElement("div");
      overlay.className = "dp-overlay";
      var panel = document.createElement("div");
      panel.className = "dp-panel";
      var header = document.createElement("div");
      header.className = "dp-header";
      var prev = mkBtn("‹", "dp-nav");
      var next = mkBtn("›", "dp-nav");
      var title = document.createElement("div");
      title.className = "dp-title";
      header.appendChild(prev);
      header.appendChild(title);
      header.appendChild(next);
      panel.appendChild(header);
      var wd = document.createElement("div");
      wd.className = "dp-weekdays";
      ["日", "一", "二", "三", "四", "五", "六"].forEach(function (s) {
        var c = document.createElement("span");
        c.textContent = s;
        wd.appendChild(c);
      });
      panel.appendChild(wd);
      var grid = document.createElement("div");
      grid.className = "dp-grid";
      panel.appendChild(grid);
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      function render() {
        title.textContent = view.getFullYear() + "年" + (view.getMonth() + 1) + "月";
        grid.innerHTML = "";
        var startDow = new Date(view.getFullYear(), view.getMonth(), 1).getDay();
        var daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
        var sel = parseVal();
        for (var i = 0; i < startDow; i++) {
          var bl = document.createElement("span");
          bl.className = "dp-blank";
          grid.appendChild(bl);
        }
        for (var d = 1; d <= daysInMonth; d++) {
          (function (dd) {
            var cellDate = new Date(view.getFullYear(), view.getMonth(), dd);
            var b = mkBtn(String(dd), "dp-day");
            if (sameDay(cellDate, sel)) b.classList.add("selected");
            if (sameDay(cellDate, today)) b.classList.add("today");
            b.addEventListener("click", function () {
              inputEl.value = ymd(cellDate);
              inputEl.dispatchEvent(new Event("change", { bubbles: true }));
              close();
            });
            grid.appendChild(b);
          })(d);
        }
      }
      function close() {
        overlay.classList.remove("open");
        setTimeout(function () {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          opened = false;
        }, 200);
      }
      prev.addEventListener("click", function () {
        view.setMonth(view.getMonth() - 1);
        render();
      });
      next.addEventListener("click", function () {
        view.setMonth(view.getMonth() + 1);
        render();
      });
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) close();
      });
      render();
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
      requestAnimationFrame(function () {
        overlay.classList.add("open");
      });
    }
    inputEl.addEventListener("click", openPicker);
  }

  // 节假日/请假的日期输入改用自定义日历
  createDatePicker(el.holidayDateInput);
  createDatePicker(el.leaveDateInput);

  // 请假时段选择（"全天"取消勾选后可选 HH:MM-HH:MM，按小时请假）
  let leaveStartPk = null,
    leaveEndPk = null;
  if (el.leaveAllDayCheck) {
    leaveStartPk = createTimePicker("08:30");
    leaveEndPk = createTimePicker("12:00");
    el.leaveStartBox.appendChild(leaveStartPk.el);
    el.leaveEndBox.appendChild(leaveEndPk.el);
    function syncLeaveTimeRow() {
      const full = el.leaveAllDayCheck.checked;
      el.leaveStartBox.style.display = full ? "none" : "";
      el.leaveEndBox.style.display = full ? "none" : "";
      el.leaveTimeSep.style.display = full ? "none" : "";
    }
    el.leaveAllDayCheck.addEventListener("change", syncLeaveTimeRow);
    syncLeaveTimeRow();
  }

  function ymd(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function fmtDur(ms) {
    if (ms < 0) ms = 0;
    const totalSec = Math.floor(ms / 1000);
    return { h: Math.floor(totalSec / 3600), m: Math.floor((totalSec % 3600) / 60), s: totalSec % 60 };
  }
  function humanDuration(ms) {
    const { h, m } = fmtDur(ms);
    if (h > 0) return h + "小时" + (m > 0 ? m + "分钟" : "");
    if (m > 0) return m + "分钟";
    return fmtDur(ms).s + "秒";
  }
  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.toast.classList.remove("show"), 1800);
  }
  function getMondayOfWeek(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d;
  }
  function isBigWeek(date) {
    if (!cfg.bigSmallAnchor || !cfg.bigSmallAnchor.monday) return true;
    const weekStart = getMondayOfWeek(date);
    const anchor = new Date(cfg.bigSmallAnchor.monday + "T00:00:00");
    const weeksDiff = Math.round((weekStart - anchor) / (7 * 86400000));
    const anchorIsBig = cfg.bigSmallAnchor.type === "big";
    const sameAsAnchor = ((weeksDiff % 2) + 2) % 2 === 0;
    return sameAsAnchor ? anchorIsBig : !anchorIsBig;
  }
  function isLeaveDay(date) {
    return !!(cfg.leaves && cfg.leaves.hasOwnProperty(ymd(date)));
  }
  // 单日调班/加班覆盖（cfg.dayOverrides[date]）：用户对某天的明确排班意图，
  // 优先于节假日与周模板（含大小周）；请假仍在其上照常扣减。
  // {off:true}=调休休息；{workStart,workEnd,breaks}=按该时段上班（如加班到 21:00）。
  // 与 WidgetConfig.java、小程序 schedule.js 保持一致。
  function dayOverrideOf(date) {
    var o = cfg.dayOverrides && cfg.dayOverrides[ymd(date)];
    if (!o || typeof o !== "object") return null;
    if (o.off) return { off: true };
    if (typeof o.workStart === "string" && typeof o.workEnd === "string" && o.workStart < o.workEnd) {
      return { workStart: o.workStart, workEnd: o.workEnd, breaks: Array.isArray(o.breaks) ? o.breaks : [] };
    }
    return null;
  }
  function isWorkDay(date) {
    var dov = dayOverrideOf(date);
    if (dov) return !dov.off && !isFullLeaveDay(date);
    var override = getHolidayOverride(date);
    if (override === "workday") {
      if (isFullLeaveDay(date)) return false;
      return true;
    }
    if (override === "holiday") return false;
    if (isFullLeaveDay(date)) return false;
    const idx = date.getDay();
    const sch = cfg.schedules[idx];
    if (!sch) return false;
    if (cfg.mode === "bigSmall" && idx === 6) return isBigWeek(date) && !!sch.workStart && !!sch.workEnd;
    return !!sch.enabled;
  }
  function isBuiltinHoliday(date) {
    var key = ymd(date);
    if (BUILTIN_HOLIDAYS.hasOwnProperty(key) && BUILTIN_HOLIDAYS[key] === "holiday") return true;
    return REMOTE_HOLIDAYS.hasOwnProperty(key) && REMOTE_HOLIDAYS[key] === "holiday";
  }
  // 带薪假类型：所有请假时段的工时一律为 0（本周/本月总工时与"还需"随请假减少），
  // 但这些类型的假在工资口径里照常计薪（时薪费率与已赚的基准，见 updateMoneyDisplay）；
  // 事假/病假/其他完全不计。与 WidgetConfig.java、小程序 schedule.js 保持一致。
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
    const h = +m[1],
      mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return pad(h) + ":" + pad(mi);
  }
  // 解析单个请假条目：对象 {reason,start,end}（时段非法回退全天）；字符串=全天
  function parseLeaveEntry(v) {
    if (v && typeof v === "object" && !(v instanceof Array)) {
      const reason = normalizeLeaveReason(v.reason) || "请假";
      const s = normHM(v.start),
        e = normHM(v.end);
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
  function leaveInfosOf(date) {
    if (!cfg.leaves || !cfg.leaves.hasOwnProperty(ymd(date))) return null;
    return parseLeaveValue(cfg.leaves[ymd(date)]);
  }
  function leaveReasonOf(date) {
    const lvs = leaveInfosOf(date);
    return lvs && lvs.length ? lvs[0].reason : null;
  }
  // 全天假（任一条目无时段即视为全天，整天按休息处理）；纯时段假当天仍是工作日
  function isFullLeaveDay(date) {
    const lvs = leaveInfosOf(date);
    return !!lvs && lvs.length > 0 && lvs.some(function (l) { return !l.start; });
  }
  // 不考虑请假的"本该上班"判定：带薪假只在本来要上班的日子才计入
  function isWorkDayIgnoringLeave(date) {
    var dov = dayOverrideOf(date);
    if (dov) return !dov.off;
    var override = getHolidayOverride(date);
    if (override === "workday") return true;
    if (override === "holiday") return false;
    const idx = date.getDay();
    const sch = cfg.schedules[idx];
    if (!sch) return false;
    if (cfg.mode === "bigSmall" && idx === 6) return isBigWeek(date) && !!sch.workStart && !!sch.workEnd;
    return !!sch.enabled;
  }
  // 任一条目为带薪类型且当天本该上班（"今日已赚照常累计"的开关）
  function isPaidLeaveDay(date) {
    const lvs = leaveInfosOf(date);
    return !!lvs && lvs.some(function (l) { return !!PAID_LEAVE_REASONS[l.reason]; }) && isWorkDayIgnoringLeave(date);
  }
  // 有效排班：把当天各段"按时段请假"作为附加休息段注入——工时扣减、"假中"状态、
  // "距下次休息/请假"提示全部复用休息段机制，时段与午休/彼此重叠部分不重复扣。
  // onlyUnpaid=true 时只注入不带薪条目（工资口径：带薪时段照常计薪，不扣）。
  function effectiveDaySchedule(date, onlyUnpaid) {
    const sch = daySchedule(date);
    const lvs = leaveInfosOf(date);
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
  // 添加请假条目：全天=覆盖当天全部条目；时段=追加（与已有时段重叠则报错不写入）
  function addLeaveEntry(dk, reason, start, end) {
    if (!cfg.leaves) cfg.leaves = {};
    if (!start) {
      cfg.leaves[dk] = reason;
      return { ok: true, text: reason };
    }
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
  function setThisWeekType(type) {
    cfg.bigSmallAnchor = { monday: ymd(getMondayOfWeek(new Date())), type: type };
  }
  // 大小周：按日期返回当天实际生效的 schedule（小周且配置了 small 时返回 small，否则主字段）；
  // 单日调班（带时段）优先于一切模板
  function daySchedule(date) {
    var dov = dayOverrideOf(date);
    if (dov && !dov.off) return { workStart: dov.workStart, workEnd: dov.workEnd, breaks: dov.breaks };
    const idx = date.getDay();
    const sch = cfg.schedules[idx];
    if (!sch) return null;
    if (cfg.mode === "bigSmall" && idx >= 1 && idx <= 5 && sch.small && !isBigWeek(date)) return sch.small;
    return sch;
  }
  // 深拷贝一份时间+休息（不含 enabled），用于初始化小周配置
  function cloneDayTimes(s) {
    return {
      workStart: s.workStart,
      workEnd: s.workEnd,
      breaks: (s.breaks || []).map((b) => ({ name: b.name, start: b.start, end: b.end })),
    };
  }
  // 比较两份时间配置（上班/下班/休息）是否完全一致；一致的小周覆盖没有意义，不显示标记、不落盘
  function dayTimesEqual(a, b) {
    if (!a || !b) return false;
    if ((a.workStart || "09:00") !== (b.workStart || "09:00")) return false;
    if ((a.workEnd || "18:00") !== (b.workEnd || "18:00")) return false;
    const ba = a.breaks || [],
      bb = b.breaks || [];
    if (ba.length !== bb.length) return false;
    for (let i = 0; i < ba.length; i++) {
      if ((ba[i].name || "") !== (bb[i].name || "") || (ba[i].start || "") !== (bb[i].start || "") || (ba[i].end || "") !== (bb[i].end || "")) return false;
    }
    return true;
  }
  // 当前正在编辑的 schedule 对象（基于 editingDay + editingVariant，大小周模式下小周切换时懒初始化）
  function editingSchedule() {
    const main = cfg.schedules[editingDay];
    if (cfg.mode === "bigSmall" && editingDay >= 1 && editingDay <= 5 && editingVariant === "small") {
      if (!main.small) main.small = cloneDayTimes(main);
      return main.small;
    }
    return main;
  }
  function netWorkMs(day, from, to) {
    if (!day) return 0;
    const base = from.getTime();
    const ws = toDate(day.workStart, base);
    const we = toDate(day.workEnd, base);
    const lo = new Date(Math.max(from.getTime(), ws.getTime()));
    const hi = new Date(Math.min(to.getTime(), we.getTime()));
    if (hi <= lo) return 0;
    let total = hi - lo;
    (day.breaks || []).forEach((b) => {
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
  function currentBreak(day, now) {
    if (!day) return null;
    const base = now.getTime();
    for (const b of day.breaks || []) {
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
    let earliest = null,
      name = null;
    for (const b of day.breaks) {
      if (!b || !b.start || !b.end) continue;
      const bs = toDate(b.start, base);
      if (bs > now) {
        if (!earliest || bs < earliest) {
          earliest = bs;
          name = b.name || "休息";
        }
      }
    }
    return earliest ? { time: earliest, name: name } : null;
  }
  function findNextWorkStart(from) {
    for (let i = 1; i <= 14; i++) {
      const next = new Date(from.getTime() + i * 86400000);
      if (isWorkDay(next)) {
        const ni = next.getDay();
        const sch = daySchedule(next);
        return { date: next, idx: ni, start: toDate(sch.workStart, next.getTime()) };
      }
    }
    return null;
  }

  // ---------- 排班模式 UI ----------
  function renderModeUI() {
    el.modeTabs.querySelectorAll(".mode-tab").forEach((b) => b.classList.toggle("active", b.dataset.mode === cfg.mode));
    const showBS = cfg.mode === "bigSmall";
    el.bigSmallConfig.style.display = showBS ? "block" : "none";
    if (showBS) {
      const thisWeekBig = isBigWeek(new Date());
      el.weekTypeSelector.querySelectorAll(".week-type-btn").forEach((b) => b.classList.toggle("active", (b.dataset.type === "big") === thisWeekBig));
    }
  }
  el.modeTabs.querySelectorAll(".mode-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      cfg.mode = btn.dataset.mode;
      if (cfg.mode === "bigSmall") {
        const sat = cfg.schedules[6];
        sat.workStart = sat.workStart || "09:00";
        sat.workEnd = sat.workEnd || "18:00";
        if (!sat.breaks || sat.breaks.length === 0) sat.breaks = [{ name: "午休", start: "12:00", end: "13:00" }];
        if (!cfg.bigSmallAnchor) setThisWeekType("big");
      }
      editingVariant = "big";
      persist();
      renderModeUI();
      renderWeekdayBar();
      renderDayForm();
      update();
    });
  });
  el.weekTypeSelector.querySelectorAll(".week-type-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setThisWeekType(btn.dataset.type);
      persist();
      renderModeUI();
      renderWeekdayBar();
      renderDayForm();
      update();
      showToast("已设置本周为" + (btn.dataset.type === "big" ? "大周" : "小周"));
    });
  });

  // ---------- 法定节假日管理 ----------
  function renderHolidayList() {
    renderHolidayOnlineStatus();
    renderBuiltinHolidays();
    renderCustomHolidays();
  }
  // 展示用分组：内置编译分组 + 在线数据分组（在线分组名带年份前缀并标 🌐）
  function effectiveHolidayGroupList() {
    var list = [];
    HOLIDAY_GROUPS.forEach(function (g) {
      list.push({ name: g.name, holidays: g.holidays, workdays: g.workdays, online: false });
    });
    var src = cfg.remoteHolidays;
    if (src && typeof src === "object") {
      Object.keys(src).sort().forEach(function (y) {
        if (!Array.isArray(src[y])) return;
        src[y].forEach(function (g) {
          if (!g || typeof g.name !== "string") return;
          list.push({ name: y + " · " + g.name, holidays: Array.isArray(g.holidays) ? g.holidays : [], workdays: Array.isArray(g.workdays) ? g.workdays : [], online: true });
        });
      });
    }
    return list;
  }
  function renderBuiltinHolidays() {
    var list = el.holidayBuiltinList;
    list.innerHTML = "";
    var frag = document.createDocumentFragment();
    var totalBuiltin = 0;
    effectiveHolidayGroupList().forEach(function (group) {
      var dates = [];
      group.holidays.forEach(function (d) {
        if (!group.online && REMOTE_HOLIDAYS.hasOwnProperty(d)) return; // 该日已被在线数据修正，只在在线分组里展示
        if (!cfg.deletedBuiltinHolidays || !cfg.deletedBuiltinHolidays.hasOwnProperty(d)) dates.push({ date: d, type: "holiday", overridden: !!(cfg.holidays && cfg.holidays.hasOwnProperty(d)) });
      });
      group.workdays.forEach(function (d) {
        if (!group.online && REMOTE_HOLIDAYS.hasOwnProperty(d)) return;
        if (!cfg.deletedBuiltinHolidays || !cfg.deletedBuiltinHolidays.hasOwnProperty(d)) dates.push({ date: d, type: "workday", overridden: !!(cfg.holidays && cfg.holidays.hasOwnProperty(d)) });
      });
      if (dates.length === 0) return;
      totalBuiltin += dates.length;
      dates.sort(function (a, b) {
        return a.date.localeCompare(b.date);
      });
      var catDiv = document.createElement("div");
      catDiv.className = "holiday-category-header";
      catDiv.innerHTML = '<span class="holiday-category-icon">' + (group.online ? "🌐" : "📌") + '</span><span class="holiday-category-name">' + group.name + '</span><span class="holiday-category-count">' + dates.length + "天</span>";
      frag.appendChild(catDiv);
      dates.forEach(function (item) {
        var isH = item.type === "holiday";
        var div = document.createElement("div");
        div.className = "holiday-item";
        div.innerHTML = '<span class="holiday-label"><span>' + item.date + "</span>" + '<span class="holiday-tag ' + (isH ? "tag-holiday" : "tag-workday") + '">' + (isH ? "🎉 休" : "💼 班") + "</span>" + (item.overridden ? '<span class="holiday-override-badge">已修改</span>' : "") + '</span><span class="holiday-actions">' + '<button class="holiday-edit" data-date="' + item.date + '" data-type="' + item.type + '" title="编辑">✎</button>' + '<button class="holiday-del" data-date="' + item.date + '" data-builtin="1" title="删除">✕</button></span>';
        frag.appendChild(div);
      });
    });
    if (totalBuiltin === 0) {
      var emptyDiv = document.createElement("div");
      emptyDiv.style.cssText = "font-size:13px;color:var(--text-dim);padding:8px 12px;";
      emptyDiv.textContent = "暂无法定节假日数据";
      frag.appendChild(emptyDiv);
    }
    list.appendChild(frag);
    bindHolidayItemEvents(list);
  }
  function renderCustomHolidays() {
    var list = el.holidayCustomList;
    list.innerHTML = "";
    var frag = document.createDocumentFragment();
    var customDates = [];
    if (cfg.holidays)
      Object.keys(cfg.holidays).forEach(function (k) {
        if (!isPresetHolidayKey(k)) customDates.push({ date: k, type: cfg.holidays[k] });
      });
    customDates.sort(function (a, b) {
      return a.date.localeCompare(b.date);
    });
    if (customDates.length === 0) {
      var emptyDiv = document.createElement("div");
      emptyDiv.style.cssText = "font-size:13px;color:var(--text-dim);padding:8px 12px;";
      emptyDiv.textContent = "暂无自定义节假日，使用上方表单添加";
      frag.appendChild(emptyDiv);
    } else {
      customDates.forEach(function (item) {
        var isH = item.type === "holiday";
        var div = document.createElement("div");
        div.className = "holiday-item";
        div.innerHTML = '<span class="holiday-label"><span>' + item.date + "</span>" + '<span class="holiday-tag ' + (isH ? "tag-holiday" : "tag-workday") + '">' + (isH ? "🎉 休" : "💼 班") + "</span></span>" + '<span class="holiday-actions"><button class="holiday-edit" data-date="' + item.date + '" data-type="' + item.type + '" data-builtin="0" title="编辑">✎</button>' + '<button class="holiday-del" data-date="' + item.date + '" data-builtin="0" title="删除">✕</button></span>';
        frag.appendChild(div);
      });
    }
    list.appendChild(frag);
    bindHolidayItemEvents(list);
  }
  function bindHolidayItemEvents(list) {
    list.querySelectorAll(".holiday-edit").forEach(function (btn) {
      btn.addEventListener("click", function () {
        el.holidayDateInput.value = this.dataset.date;
        el.holidayTypeSelect.value = this.dataset.type;
        // 同步自定义下拉显示
        if (window.CustomSelect) window.CustomSelect.closeAll();
        var display = document.getElementById("holidayTypeDisplay");
        if (display) display.textContent = el.holidayTypeSelect.options[el.holidayTypeSelect.selectedIndex].text;
        el.holidayDateInput.scrollIntoView({ behavior: "smooth" });
        el.holidayDateInput.focus();
        showToast("已载入 " + this.dataset.date + "，修改后点击添加即可覆盖");
      });
    });
    list.querySelectorAll(".holiday-del").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var date = this.dataset.date;
        var isBuiltin = this.dataset.builtin === "1";
        if (isBuiltin) {
          if (!cfg.deletedBuiltinHolidays) cfg.deletedBuiltinHolidays = {};
          cfg.deletedBuiltinHolidays[date] = true;
        } else {
          if (cfg.holidays && cfg.holidays.hasOwnProperty(date)) delete cfg.holidays[date];
        }
        persist();
        renderHolidayList();
        update();
        showToast("已移除 " + date);
      });
    });
  }
  el.holidayAddBtn.addEventListener("click", function () {
    var dateVal = el.holidayDateInput.value;
    if (!dateVal) {
      showToast("请先选择日期");
      return;
    }
    var type = el.holidayTypeSelect.value;
    if (!cfg.holidays) cfg.holidays = {};
    cfg.holidays[dateVal] = type;
    if (cfg.deletedBuiltinHolidays && cfg.deletedBuiltinHolidays.hasOwnProperty(dateVal)) delete cfg.deletedBuiltinHolidays[dateVal];
    persist();
    renderHolidayList();
    update();
    var typeName = type === "holiday" ? "节假日（休息）" : "调休日（上班）";
    showToast("已设置 " + dateVal + " 为" + typeName);
    if (isPresetHolidayKey(dateVal)) switchHolidaySubtab("builtin");
    else switchHolidaySubtab("custom");
    el.holidayDateInput.value = "";
  });
  if (el.holidayResetBtn) {
    el.holidayResetBtn.addEventListener("click", function () {
      if (!confirm("确定要恢复全部默认法定节假日吗？\n这将撤销你对内置节假日的所有删除和修改，并清除已下载的在线节假日数据。")) return;
      cfg.deletedBuiltinHolidays = {};
      if (cfg.holidays)
        Object.keys(cfg.holidays).forEach(function (k) {
          if (isPresetHolidayKey(k)) delete cfg.holidays[k];
        });
      cfg.remoteHolidays = {};
      rebuildRemoteHolidays();
      persist();
      renderHolidayList();
      update();
      showToast("已恢复全部默认法定节假日");
    });
  }

  // ---------- 在线更新节假日 ----------
  function renderHolidayOnlineStatus() {
    if (!el.holidayOnlineStatus) return;
    var thisYear = String(new Date().getFullYear());
    var covered = builtinHolidayYears().concat(REMOTE_YEARS);
    var missing = covered.indexOf(thisYear) < 0;
    var txt;
    if (REMOTE_YEARS.length > 0) txt = "🌐 在线数据已加载：" + REMOTE_YEARS.join("、") + " 年";
    else txt = "🌐 在线数据：未更新（当前为内置数据 " + builtinHolidayYears().join("、") + " 年）";
    if (missing) txt += "\n⚠️ " + thisYear + " 年暂无法定节假日数据，日历与进度将按普通周末计算，请点击在线更新或手动添加";
    el.holidayOnlineStatus.textContent = txt;
    el.holidayOnlineStatus.classList.toggle("holiday-online-warn", missing);
  }
  function requestHolidayFeed() {
    // 原生端走 CapacitorHttp 绕过 CORS；网页/调试环境回退 fetch
    var cap = window.Capacitor;
    if (cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins && cap.Plugins.CapacitorHttp) {
      return cap.Plugins.CapacitorHttp.get({ url: HOLIDAY_FEED_URL, headers: { "Cache-Control": "no-cache" } }).then(function (res) {
        return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
      });
    }
    return fetch(HOLIDAY_FEED_URL, { cache: "no-cache" }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.text();
    });
  }
  if (el.holidayUpdateBtn) {
    el.holidayUpdateBtn.addEventListener("click", function () {
      var btn = el.holidayUpdateBtn;
      btn.disabled = true;
      btn.textContent = "⏳ 更新中…";
      requestHolidayFeed()
        .then(function (text) {
          var v = validateRemoteHolidayData(JSON.parse(text));
          cfg.remoteHolidays = v.years;
          persist();
          rebuildRemoteHolidays();
          renderHolidayList();
          update();
          showToast("✅ 节假日已更新：" + REMOTE_YEARS.join("、") + " 年，共 " + v.count + " 天");
        })
        .catch(function (err) {
          showToast("❌ 在线更新失败：" + (err && err.message ? err.message : "网络错误"));
        })
        .then(function () {
          btn.disabled = false;
          btn.textContent = "🌐 在线更新节假日";
        });
    });
  }

  // ---------- 节假日子 Tab 切换 ----------
  function switchHolidaySubtab(subtabId) {
    document.querySelectorAll(".holiday-subtab-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.subtab === subtabId);
    });
    document.querySelectorAll(".holiday-subtab-content").forEach(function (p) {
      var match = (p.id === "holidayBuiltinPanel" && subtabId === "builtin") || (p.id === "holidayCustomPanel" && subtabId === "custom");
      p.classList.toggle("hidden", !match);
    });
  }
  document.querySelectorAll(".holiday-subtab-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      switchHolidaySubtab(this.dataset.subtab);
    });
  });

  // ---------- 请假管理 ----------
  function renderLeaveList() {
    var list = el.leaveList;
    list.innerHTML = "";
    var frag = document.createDocumentFragment();
    var dates = cfg.leaves ? Object.keys(cfg.leaves) : [];
    dates.sort(function (a, b) {
      return a.localeCompare(b);
    });
    if (dates.length === 0) {
      var emptyDiv = document.createElement("div");
      emptyDiv.style.cssText = "font-size:13px;color:var(--text-dim);padding:8px 12px;";
      emptyDiv.textContent = "暂无请假记录，使用上方表单添加";
      frag.appendChild(emptyDiv);
    } else {
      dates.forEach(function (dk) {
        parseLeaveValue(cfg.leaves[dk]).forEach(function (info, idx) {
          var tag = info.reason + (info.start ? " " + info.start + "-" + info.end : "");
          var div = document.createElement("div");
          div.className = "holiday-item leave-item";
          div.innerHTML = '<span class="holiday-label"><span>' + dk + "</span>" + '<span class="leave-tag">' + tag + "</span>" + '</span><span class="holiday-actions"><button class="holiday-del" data-date="' + dk + '" data-idx="' + idx + '" title="删除">✕</button></span>';
          frag.appendChild(div);
        });
      });
    }
    list.appendChild(frag);
    list.querySelectorAll(".holiday-del").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var date = this.dataset.date;
        var idx = parseInt(this.dataset.idx, 10);
        if (!cfg.leaves || !cfg.leaves.hasOwnProperty(date)) return;
        var infos = parseLeaveValue(cfg.leaves[date]);
        if (idx >= 0 && idx < infos.length) infos.splice(idx, 1);
        if (infos.length === 0) delete cfg.leaves[date];
        else if (infos.length === 1)
          cfg.leaves[date] = infos[0].start
            ? { reason: infos[0].reason, start: infos[0].start, end: infos[0].end }
            : infos[0].reason;
        else cfg.leaves[date] = infos;
        persist();
        renderLeaveList();
        update();
        showToast("已删除请假 " + date);
      });
    });
  }
  el.leaveAddBtn.addEventListener("click", function () {
    var dateVal = el.leaveDateInput.value;
    if (!dateVal) {
      showToast("请先选择日期");
      return;
    }
    var reason = el.leaveReasonInput.value || "其他";
    var start = null,
      end = null;
    if (el.leaveAllDayCheck && !el.leaveAllDayCheck.checked && leaveStartPk && leaveEndPk) {
      start = leaveStartPk.getValue();
      end = leaveEndPk.getValue();
      if (start >= end) {
        showToast("结束时间需晚于开始时间");
        return;
      }
    }
    var added = addLeaveEntry(dateVal, reason, start, end);
    if (!added.ok) {
      showToast(added.err);
      return;
    }
    persist();
    renderLeaveList();
    update();
    showToast("已添加请假 " + dateVal + "（" + added.text + "）");
    el.leaveDateInput.value = "";
    el.leaveReasonInput.selectedIndex = 0;
    // 同步自定义下拉显示
    var display = document.getElementById("leaveReasonDisplay");
    if (display && el.leaveReasonInput.selectedIndex >= 0) {
      display.textContent = el.leaveReasonInput.options[el.leaveReasonInput.selectedIndex].text;
    }
  });
  if (el.leaveClearBtn) {
    el.leaveClearBtn.addEventListener("click", function () {
      var n = cfg.leaves ? Object.keys(cfg.leaves).length : 0;
      if (n === 0) {
        showToast("没有请假记录");
        return;
      }
      if (!confirm("确定要清空全部 " + n + " 条请假记录吗？")) return;
      cfg.leaves = {};
      persist();
      renderLeaveList();
      update();
      showToast("已清空全部请假");
    });
  }

  // ---------- 其他设置（本月进度 / 工资） ----------
  function renderOtherSettings() {
    if (!el.showMonthProgressCheck) return;
    el.showMonthProgressCheck.checked = !!cfg.showMonthProgress;
    el.salaryEnabledCheck.checked = !!cfg.salaryEnabled;
    el.salaryConfig.style.display = cfg.salaryEnabled ? "block" : "none";
    el.monthlySalaryInput.value = cfg.monthlySalary > 0 ? cfg.monthlySalary : "";
    if (el.offworkReminderCheck) {
      el.offworkReminderCheck.checked = cfg.offworkReminder > 0;
      el.offworkReminderRow.style.display = cfg.offworkReminder > 0 ? "block" : "none";
      var m = cfg.offworkReminder > 0 ? cfg.offworkReminder : 30;
      el.offworkMinSelect.value = String(m);
      // 同步自定义下拉显示（custom-select 监听 change 同步，这里手动触发一次）
      el.offworkMinSelect.dispatchEvent(new Event("change"));
    }
  }
  if (el.offworkReminderCheck)
    el.offworkReminderCheck.addEventListener("change", function () {
      cfg.offworkReminder = this.checked ? Number(el.offworkMinSelect.value) || 30 : 0;
      persist();
      renderOtherSettings();
      showToast(this.checked ? "已开启下班提醒（提前 " + cfg.offworkReminder + " 分钟）" : "已关闭下班提醒");
    });
  if (el.offworkMinSelect)
    el.offworkMinSelect.addEventListener("change", function () {
      if (cfg.offworkReminder > 0) {
        cfg.offworkReminder = Number(this.value) || 30;
        persist();
        showToast("已改为提前 " + cfg.offworkReminder + " 分钟提醒");
      }
    });
  el.showMonthProgressCheck.addEventListener("change", function () {
    cfg.showMonthProgress = this.checked;
    persist();
    update();
    updateMoneyDisplay();
    showToast(this.checked ? "已显示本月进度" : "已隐藏本月进度");
  });
  el.salaryEnabledCheck.addEventListener("change", function () {
    cfg.salaryEnabled = this.checked;
    persist();
    renderOtherSettings();
    updateMoneyDisplay();
    showToast(this.checked ? "已开启工资显示" : "已关闭工资显示");
  });
  el.monthlySalaryInput.addEventListener("input", function () {
    var val = Number(this.value);
    cfg.monthlySalary = isFinite(val) && val > 0 ? val : 0;
    persist();
    updateMoneyDisplay();
  });

  // ---------- 周几选择器 ----------
  function renderWeekdayBar() {
    el.weekdayBar.innerHTML = "";
    const today = new Date().getDay();
    WEEK_ORDER.forEach((d) => {
      const btn = document.createElement("button");
      btn.className = "weekday";
      if (d === editingDay) btn.classList.add("active");
      if (d === today) btn.classList.add("today");
      const isSatAlt = cfg.mode === "bigSmall" && d === 6;
      const hasAlt = cfg.mode === "bigSmall" && d >= 1 && d <= 5 && cfg.schedules[d].small && !dayTimesEqual(cfg.schedules[d].small, cfg.schedules[d]);
      if (isSatAlt) {
        btn.classList.add("alt");
        const thisWeekBig = isBigWeek(new Date());
        btn.title = "周六 · 大小周交替（本周" + (thisWeekBig ? "大周·上班" : "小周·休息") + "）";
      } else if (!cfg.schedules[d].enabled) {
        btn.classList.add("off-day");
      }
      if (hasAlt) {
        btn.classList.add("has-alt");
        btn.title = (btn.title ? btn.title + " · " : "") + "已设置大周/小周不同时间";
      }
      btn.textContent = WEEK_LABEL[d];
      btn.addEventListener("click", () => {
        editingDay = d;
        editingVariant = "big";
        renderWeekdayBar();
        renderDayForm();
      });
      el.weekdayBar.appendChild(btn);
    });
    // 状态图例
    if (el.weekdayLegend) {
      const parts = ["底部圆点 = 今天", "半透明 = 休息日"];
      if (cfg.mode === "bigSmall") parts.push("六 ↻ = 大小周交替", "右上 • = 大小周时间不同");
      el.weekdayLegend.innerHTML = parts.map((p) => "<span>" + p + "</span>").join("");
    }
  }

  // ---------- 单日表单 ----------
  function renderDayForm() {
    const isSatAlt = cfg.mode === "bigSmall" && editingDay === 6;
    const isAltDay = cfg.mode === "bigSmall" && editingDay >= 1 && editingDay <= 5;
    const day = editingSchedule();
    el.dayEditorTitle.textContent = WEEK_FULL[editingDay];
    if (!workStartPicker) {
      workStartPicker = createTimePicker(day.workStart, function (v) {
        const s = editingSchedule();
        s.workStart = v;
        persist();
        updateDurationHints();
        update();
      });
      el.workStartBox.appendChild(workStartPicker.el);
      workEndPicker = createTimePicker(day.workEnd, function (v) {
        const s = editingSchedule();
        s.workEnd = v;
        persist();
        updateDurationHints();
        update();
      });
      el.workEndBox.appendChild(workEndPicker.el);
    }
    workStartPicker.setValue(day.workStart);
    workEndPicker.setValue(day.workEnd);
    // 大周/小周变体切换条（仅大小周模式 周一~五）
    if (isAltDay) {
      el.variantSelector.style.display = "flex";
      el.variantSelector.querySelectorAll(".variant-tab").forEach((b) => b.classList.toggle("active", b.dataset.variant === editingVariant));
      const curDay = cfg.schedules[editingDay];
      el.variantClearBtn.style.display = editingVariant === "small" && curDay.small && !dayTimesEqual(curDay.small, curDay) ? "block" : "none";
    } else {
      el.variantSelector.style.display = "none";
    }
    if (isSatAlt) {
      el.workdayToggle.style.display = "none";
      el.satInfo.style.display = "block";
      const thisWeekBig = isBigWeek(new Date());
      el.satInfo.innerHTML = '🔄 <b>大小周模式</b>：周六是否上班由排班自动决定。<br>本周六：<span class="sat-status">' + (thisWeekBig ? "上班" : "休息") + "</span>（" + (thisWeekBig ? "大周" : "小周") + "）";
      el.dayBody.classList.remove("disabled");
    } else {
      el.workdayToggle.style.display = "flex";
      el.satInfo.style.display = "none";
      el.workdayCheck.checked = !!cfg.schedules[editingDay].enabled;
      updateDayBodyState();
    }
    renderBreaks();
    updateDurationHints();
  }
  function updateDayBodyState() {
    el.dayBody.classList.toggle("disabled", !el.workdayCheck.checked);
  }
  function renderBreaks() {
    const day = editingSchedule();
    el.breakList.innerHTML = "";
    (day.breaks || []).forEach((b, i) => {
      // 单行布局：名称 + 开始 — 结束 + 删除
      const row = document.createElement("div");
      row.className = "break-row";
      const nameInput = document.createElement("input");
      nameInput.className = "break-name-input";
      nameInput.type = "text";
      nameInput.value = b.name || "休息" + (i + 1);
      nameInput.maxLength = 10;
      nameInput.placeholder = "名称";
      nameInput.addEventListener("input", function () {
        day.breaks[i].name = nameInput.value || "休息" + (i + 1);
        persist();
        update();
      });
      const startPk = createTimePicker(b.start, function (v) {
        day.breaks[i].start = v;
        persist();
        updateDurationHints();
        update();
      });
      const dash = document.createElement("span");
      dash.className = "dash";
      dash.textContent = "—";
      const endPk = createTimePicker(b.end, function (v) {
        day.breaks[i].end = v;
        persist();
        updateDurationHints();
        update();
      });
      const del = document.createElement("button");
      del.className = "del-btn";
      del.title = "删除";
      del.textContent = "✕";
      del.addEventListener("click", () => {
        day.breaks.splice(i, 1);
        persist();
        renderBreaks();
        updateDurationHints();
        update();
      });
      row.appendChild(nameInput);
      row.appendChild(startPk.el);
      row.appendChild(dash);
      row.appendChild(endPk.el);
      row.appendChild(del);
      el.breakList.appendChild(row);
    });
  }
  function updateDurationHints() {
    const day = editingSchedule();
    const base = Date.now();
    const ws = toDate(day.workStart, base);
    const we = toDate(day.workEnd, base);
    let main;
    if (we <= ws) {
      main = "⚠️ 下班时间应晚于上班时间";
    } else {
      const span = we - ws;
      const net = netWorkMs(day, ws, we);
      const breakSum = span - net;
      main = breakSum > 0 ? "跨度 " + humanDuration(span) + " · 休息 " + humanDuration(breakSum) + " · 工作 " + humanDuration(net) : "跨度 " + humanDuration(span) + " · 工作 " + humanDuration(net);
    }
    let warn = "";
    (day.breaks || []).forEach((b, i) => {
      if (toDate(b.end, base) <= toDate(b.start, base)) warn += "；休息" + (i + 1) + "结束应晚于开始";
    });
    el.workDurationHint.textContent = main + (warn ? " ⚠️" + warn.slice(1) : "");
  }

  // ---------- 表单事件 ----------
  el.workdayCheck.addEventListener("change", () => {
    const day = cfg.schedules[editingDay];
    day.enabled = el.workdayCheck.checked;
    if (day.enabled && (!day.breaks || day.breaks.length === 0)) day.breaks = [{ name: "午休", start: "12:00", end: "13:00" }];
    persist();
    renderWeekdayBar();
    renderDayForm();
    update();
  });
  el.addBreakBtn.addEventListener("click", () => {
    const day = editingSchedule();
    if (!Array.isArray(day.breaks)) day.breaks = [];
    day.breaks.push({ name: "休息" + (day.breaks.length + 1), start: "12:00", end: "13:00" });
    persist();
    renderBreaks();
    updateDurationHints();
    update();
  });
  el.applyAllBtn.addEventListener("click", () => {
    const isSmallVariant = cfg.mode === "bigSmall" && editingVariant === "small";
    const src = editingSchedule();
    let count = 0;
    WEEK_ORDER.forEach((d) => {
      if (d === editingDay) return;
      if (cfg.mode === "bigSmall" && d === 6) return;
      const dst = cfg.schedules[d];
      if (!dst.enabled) return;
      const target = isSmallVariant ? dst.small || (dst.small = cloneDayTimes(dst)) : dst;
      target.workStart = src.workStart;
      target.workEnd = src.workEnd;
      target.breaks = src.breaks.map((b) => ({ name: b.name, start: b.start, end: b.end }));
      count++;
    });
    persist();
    renderWeekdayBar();
    renderDayForm();
    update();
    showToast("已应用到 " + count + " 个工作日" + (isSmallVariant ? "（小周）" : ""));
  });
  // 大周/小周变体切换 + 清除小周差异
  if (el.variantSelector) {
    el.variantSelector.querySelectorAll(".variant-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        editingVariant = btn.dataset.variant;
        renderDayForm();
      });
    });
  }
  if (el.variantClearBtn) {
    el.variantClearBtn.addEventListener("click", () => {
      delete cfg.schedules[editingDay].small;
      editingVariant = "big";
      persist();
      renderWeekdayBar();
      renderDayForm();
      update();
      showToast("已清除小周差异");
    });
  }
  el.resetBtn.addEventListener("click", () => {
    // 与小程序端语义一致：只恢复默认排班（含单日调班）；节假日、请假、工资等不受影响
    if (!confirm("确定恢复默认排班吗？\n（节假日、请假、工资等不受影响，单日调班/加班将被清除）")) return;
    cfg.schedules = defaultSchedules();
    cfg.mode = "fixed";
    cfg.bigSmallAnchor = null;
    cfg.dayOverrides = {};
    editingDay = new Date().getDay();
    editingVariant = "big";
    persist();
    renderModeUI();
    renderWeekdayBar();
    renderDayForm();
    update();
    showToast("已恢复默认排班");
  });

  // ---------- 导出配置（二维码） ----------
  // 新格式："Z1:" + LZString.compressToEncodedURIComponent(json)；导入端按前缀识别
  el.exportBtn.addEventListener("click", function () {
    el.qrCodeBox.innerHTML = "";
    const compact = compactConfig(cfg);
    const json = JSON.stringify(compact);
    let text = json;
    if (window.LZString) text = "Z1:" + LZString.compressToEncodedURIComponent(json);
    el.qrExportText.value = text;
    let qrOk = false;
    try {
      new QRCode(el.qrCodeBox, { text: text, width: 296, height: 296, colorDark: "#1a1530", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L });
      qrOk = true;
    } catch (e) {
      qrOk = false;
    }
    el.qrCodeBox.style.display = qrOk ? "" : "none";
    el.qrExportOverlay.classList.add("open");
    if (!qrOk) showToast("⚠️ 配置过大无法生成二维码（约 " + json.length + " 字符），请改用「复制配置文本」");
  });
  el.qrExportClose.addEventListener("click", function () {
    el.qrExportOverlay.classList.remove("open");
  });
  function copyConfigText(text, sourceArea) {
    var done = function () {
      showToast("✅ 已复制配置文本，可粘贴到另一台设备");
    };
    var fail = function () {
      if (sourceArea) {
        sourceArea.focus();
        sourceArea.select();
      }
      showToast("复制失败，请长按文本框手动选择复制");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {
        execCopy(text, done, fail);
      });
    } else execCopy(text, done, fail);
  }
  function execCopy(text, done, fail) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) done();
      else fail();
    } catch (e) {
      fail();
    }
  }
  el.qrExportCopy.addEventListener("click", function () {
    copyConfigText(el.qrExportText.value, el.qrExportText);
  });
  el.qrImportPaste.addEventListener("click", function () {
    el.qrImportOverlay.classList.remove("open");
    el.pasteImportText.value = "";
    el.pasteImportOverlay.classList.add("open");
    setTimeout(function () {
      el.pasteImportText.focus();
    }, 120);
  });
  el.pasteImportConfirm.addEventListener("click", function () {
    var v = (el.pasteImportText.value || "").trim();
    if (!v) {
      showToast("请先粘贴配置文本");
      return;
    }
    el.pasteImportOverlay.classList.remove("open");
    applyImportedConfig(v);
  });
  el.pasteImportClose.addEventListener("click", function () {
    el.pasteImportOverlay.classList.remove("open");
  });

  // ---------- 文件分享导出 / 文件导入 ----------
  function downloadTextFile(text, fileName) {
    var blob = new Blob([text], { type: "application/json;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1500);
  }
  async function shareConfigFile() {
    var json = JSON.stringify(compactConfig(cfg));
    var fileName = "work-countdown-config-" + ymd(new Date()) + ".json";
    var Cap = window.Capacitor,
      Filesystem = Cap && Cap.Plugins && Cap.Plugins.Filessystem;
    // 兼容大小写
    if (Cap && Cap.Plugins && !Filesystem) Filesystem = Cap.Plugins.Filesystem;
    var Share = Cap && Cap.Plugins && Cap.Plugins.Share;
    if (!Filesystem || !Share) {
      // Web/调试环境：直接触发浏览器下载
      downloadTextFile(json, fileName);
      showToast("已下载 " + fileName + "，可手动发送给其他设备");
      return;
    }
    try {
      await Filesystem.writeFile({ path: fileName, data: json, directory: "CACHE", encoding: "utf8", recursive: true });
      var res = await Filesystem.getUri({ path: fileName, directory: "CACHE" });
      await Share.share({ files: [res.uri], title: "下班了吗 配置", dialogTitle: "导出配置到…" });
    } catch (e) {
      // 分享被取消或失败：回退为下载，避免用户无所得
      downloadTextFile(json, fileName);
      showToast("已保存 " + fileName + "（分享未完成）");
    }
  }
  el.qrExportShareFile.addEventListener("click", function () {
    shareConfigFile();
  });
  el.qrImportFile.addEventListener("click", function () {
    el.qrImportOverlay.classList.remove("open");
    el.fileImportInput.value = "";
    el.fileImportInput.click();
  });
  el.fileImportInput.addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      applyImportedConfig(String(reader.result || ""));
    };
    reader.onerror = function () {
      showToast("读取文件失败");
    };
    reader.readAsText(f);
  });

  // ---------- 导入配置 ----------
  el.importBtn.addEventListener("click", function () {
    el.qrImportOverlay.classList.add("open");
  });
  el.qrImportClose.addEventListener("click", function () {
    el.qrImportOverlay.classList.remove("open");
  });
  let scanStream = null,
    scanRAF = null;
  el.qrImportScan.addEventListener("click", async function () {
    el.qrImportOverlay.classList.remove("open");
    el.scanHint.textContent = "将二维码对准框内";
    el.scanOverlay.classList.add("open");
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      el.scanVideo.srcObject = scanStream;
      el.scanVideo.play();
      startScanLoop();
    } catch (err) {
      el.scanOverlay.classList.remove("open");
      showToast("实时扫描不可用，改用拍照模式");
      el.qrFileInput.setAttribute("capture", "environment");
      el.qrFileInput.click();
    }
  });
  function startScanLoop() {
    const video = el.scanVideo;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    function tick() {
      if (!scanStream) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        const vw = video.videoWidth,
          vh = video.videoHeight;
        if (vw && vh) {
          const SCAN_MAX = 1280;
          const sc = Math.min(1, SCAN_MAX / Math.max(vw, vh));
          canvas.width = Math.max(1, Math.round(vw * sc));
          canvas.height = Math.max(1, Math.round(vh * sc));
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = typeof jsQR !== "undefined" ? jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" }) : null;
          if (code && code.data) {
            stopScan();
            el.scanHint.textContent = "✅ 扫描成功！";
            setTimeout(function () {
              el.scanOverlay.classList.remove("open");
              applyImportedConfig(code.data);
            }, 500);
            return;
          }
        }
      }
      scanRAF = requestAnimationFrame(tick);
    }
    scanRAF = requestAnimationFrame(tick);
  }
  function stopScan() {
    if (scanRAF) {
      cancelAnimationFrame(scanRAF);
      scanRAF = null;
    }
    if (scanStream) {
      scanStream.getTracks().forEach(function (t) {
        t.stop();
      });
      scanStream = null;
    }
    el.scanVideo.srcObject = null;
  }
  el.scanCancel.addEventListener("click", function () {
    stopScan();
    el.scanOverlay.classList.remove("open");
  });
  el.qrImportAlbum.addEventListener("click", function () {
    el.qrImportOverlay.classList.remove("open");
    el.qrFileInput.removeAttribute("capture");
    el.qrFileInput.click();
  });
  el.qrFileInput.addEventListener("change", function (e) {
    const file = e.target.files && e.target.files[0];
    el.qrFileInput.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (ev) {
      const img = new Image();
      img.onload = function () {
        try {
          const code = decodeQRFromImage(img);
          if (code && code.data) applyImportedConfig(code.data);
          else showToast("未识别到二维码，请重试");
        } catch (err) {
          showToast("解析失败：" + (err.message || "未知错误"));
        }
      };
      img.onerror = function () {
        showToast("无法读取图片");
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
  function decodeQRFromImage(img) {
    if (typeof jsQR === "undefined") return null;
    const MAX = 1400;
    const baseScale = Math.min(1, MAX / Math.max(img.width, img.height));
    const scales = [baseScale, baseScale * 0.5, baseScale * 2];
    for (let i = 0; i < scales.length; i++) {
      const s = scales[i];
      const cw = Math.max(1, Math.round(img.width * s)),
        ch = Math.max(1, Math.round(img.height * s));
      const canvas = document.createElement("canvas"),
        ctx = canvas.getContext("2d", { willReadFrequently: true });
      canvas.width = cw;
      canvas.height = ch;
      ctx.drawImage(img, 0, 0, cw, ch);
      const imageData = ctx.getImageData(0, 0, cw, ch);
      const code = jsQR(imageData.data, cw, ch, { inversionAttempts: "attemptBoth" });
      if (code && code.data) return code;
    }
    return null;
  }
  function applyImportedConfig(jsonStr) {
    try {
      jsonStr = jsonStr.replace(/^\uFEFF/, "").trim();
      // 新格式以 "Z1:" 开头（LZString 压缩），解压后再解析；旧格式为明文 JSON，直接解析
      if (jsonStr.indexOf("Z1:") === 0) {
        const dec = window.LZString && LZString.decompressFromEncodedURIComponent(jsonStr.slice(3));
        if (!dec) throw new Error("解压失败");
        jsonStr = dec;
      }
      const parsed = JSON.parse(jsonStr);
      let validated;
      if (parsed.schedules) validated = parseConfig(parsed);
      else if (parsed.s) {
        const expanded = expandConfig(parsed);
        validated = parseConfig(expanded);
      } else throw new Error("配置格式无效");
      if (!validated.schedules) throw new Error("配置格式无效");
      cfg.schedules = validated.schedules;
      cfg.mode = validated.mode;
      cfg.bigSmallAnchor = validated.bigSmallAnchor;
      cfg.holidays = validated.holidays || {};
      cfg.leaves = validated.leaves || {};
      cfg.deletedBuiltinHolidays = validated.deletedBuiltinHolidays || {};
      cfg.dayOverrides = validated.dayOverrides || {};
      cfg.showMonthProgress = !!validated.showMonthProgress;
      cfg.salaryEnabled = !!validated.salaryEnabled;
      cfg.monthlySalary = validated.monthlySalary || 0;
      cfg.offworkReminder = validated.offworkReminder || 0;
      // remoteHolidays 不随导入覆盖（可在线重新获取），保持本机现有在线数据
      persist();
      renderModeUI();
      renderWeekdayBar();
      renderDayForm();
      update();
      renderOtherSettings();
      updateMoneyDisplay();
      showToast("✅ 配置导入成功");
    } catch (e) {
      showToast("❌ 配置无效，请检查文本/二维码是否完整");
    }
  }

  // ---------- 设置面板 Tab 切换 ----------
  function switchSettingsTab(tabId) {
    document.querySelectorAll(".settings-tab-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.tab === tabId);
    });
    document.querySelectorAll(".settings-tab-content").forEach(function (p) {
      p.classList.toggle("hidden", p.id !== tabId);
    });
  }
  document.querySelectorAll(".settings-tab-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      switchSettingsTab(this.dataset.tab);
    });
  });

  // ---------- 设置面板展开/收起 ----------
  function openSettings() {
    editingDay = new Date().getDay();
    switchSettingsTab("tabSchedule");
    renderModeUI();
    renderWeekdayBar();
    renderDayForm();
    renderHolidayList();
    renderLeaveList();
    renderOtherSettings();
    el.settingsPanel.classList.add("open");
    el.settingsOverlay.classList.add("open");
    el.settingsBtn.classList.add("active");
  }
  function closeSettings() {
    el.settingsPanel.classList.remove("open");
    el.settingsOverlay.classList.remove("open");
    el.settingsBtn.classList.remove("active");
  }
  el.settingsBtn.addEventListener("click", () => {
    el.settingsPanel.classList.contains("open") ? closeSettings() : openSettings();
  });
  el.settingsClose.addEventListener("click", closeSettings);
  el.settingsOverlay.addEventListener("click", closeSettings);
  // 点击卡片（日历除外）展开/收起设置
  if (el.card)
    el.card.addEventListener("click", (e) => {
      if (e.target.closest("#calendarCard")) return;
      el.settingsPanel.classList.contains("open") ? closeSettings() : openSettings();
    });

  // 月历月份切换
  if (el.calPrevBtn)
    el.calPrevBtn.addEventListener("click", function () {
      calMonth--;
      if (calMonth < 0) {
        calMonth = 11;
        calYear--;
      }
      calRenderKey = "";
      renderCalendar();
    });
  if (el.calNextBtn)
    el.calNextBtn.addEventListener("click", function () {
      calMonth++;
      if (calMonth > 11) {
        calMonth = 0;
        calYear++;
      }
      calRenderKey = "";
      renderCalendar();
    });

  // ---------- 核心计算与渲染 ----------
  function update() {
    const now = new Date();
    const todayIdx = now.getDay();
    // 有效排班：按时段请假已作为附加休息段注入（状态机里"假中"与休息共用一套逻辑，工时自动扣除）
    const today = effectiveDaySchedule(now);
    const todayIsWork = isWorkDay(now);
    let statusClass = "before",
      statusText = "",
      targetMs = 0,
      subInfoHtml = "";

    if (!todayIsWork) {
      var isLegalHoliday = isBuiltinHoliday(now) || (cfg.holidays && cfg.holidays[ymd(now)] === "holiday");
      var tDovRest = dayOverrideOf(now);
      if (isLegalHoliday) {
        statusClass = "holiday";
        statusText = "🎊 今天是法定节假日，" + WEEK_FULL[todayIdx] + "休息！";
      } else {
        statusClass = "holiday";
        var lvReason = normalizeLeaveReason(leaveReasonOf(now));
        statusText = lvReason
          ? isPaidLeaveDay(now)
            ? "🌴 " + lvReason + "中，带薪休息，工资不受影响"
            : "🍃 " + lvReason + "中"
          : tDovRest && tDovRest.off
          ? "🌙 今天调休，好好休息！"
          : "🎉 今天是" + WEEK_FULL[todayIdx] + "，休息日！";
      }
      targetMs = 0;
      const next = findNextWorkStart(now);
      subInfoHtml = next ? "距下一个工作日（" + WEEK_FULL[next.idx] + "）上班还有 <b>" + humanDuration(next.start - now) + "</b>" : "近期没有工作日了 😎";
    } else {
      const base = now.getTime();
      const ws = toDate(today.workStart, base);
      const we = toDate(today.workEnd, base);
      const brk = currentBreak(today, now);
      // 调休/调班后缀：单日调班（明确意图）优先于调休上班标记
      var isMakeupDay = getHolidayOverride(now) === "workday";
      var makeupSuffix = isMakeupDay ? "（调休上班）" : "";
      var tDovWork = dayOverrideOf(now);
      if (tDovWork && !tDovWork.off) makeupSuffix = "（今日调班）";
      if (now < ws) {
        statusClass = "before";
        statusText = "😴 还没到上班时间" + makeupSuffix;
        targetMs = we - now;
        subInfoHtml = "距离上班还有 <b>" + humanDuration(ws - now) + "</b>";
      } else if (now >= we) {
        statusClass = "off";
        statusText = "🎉 已经下班啦，好好休息！";
        targetMs = 0;
        const next = findNextWorkStart(now);
        subInfoHtml = next ? "距下一个工作日（" + WEEK_FULL[next.idx] + "）上班还有 <b>" + humanDuration(next.start - now) + "</b>" : "本周内没有更多工作日了 😎";
      } else if (brk) {
        statusClass = "break";
        var bName = brk.name || "休息";
        statusText = "🍵 " + bName + "中，放松一下吧";
        targetMs = we - now;
        const be = toDate(brk.end, base);
        subInfoHtml = "距离" + bName + "结束 <b>" + humanDuration(be - now) + "</b> · 距下班 <b>" + humanDuration(we - now) + "</b>";
      } else {
        statusClass = "working";
        statusText = "💼 努力工作中…" + (isMakeupDay ? "（调休）" : "");
        targetMs = we - now;
        const nextBreak = findNextBreak(today, now);
        if (nextBreak) statusText += " ｜ ☕ 距" + nextBreak.name + " " + humanDuration(nextBreak.time - now);
      }
    }
    const d = fmtDur(targetMs);
    el.hh.textContent = pad(d.h);
    el.mm.textContent = pad(d.m);
    el.ss.textContent = pad(d.s);
    el.status.className = "status " + statusClass;
    el.status.textContent = statusText;
    el.subInfo.innerHTML = subInfoHtml;
    el.subInfo.style.display = subInfoHtml ? "" : "none";
    lastTargetEpoch = targetMs > 0 ? now.getTime() + targetMs : 0;
    renderCountdown();
    // 今日进度：纯工时口径，所有请假日一律 0（带薪假只体现在工资，见 updateMoneyDisplay）
    const totalWork = todayIsWork ? totalWorkMs(today) : 0;
    let doneMs = 0;
    if (todayIsWork) {
      const ws2 = toDate(today.workStart, now.getTime());
      if (now > ws2) doneMs = netWorkMs(today, ws2, now);
    }
    const pct = totalWork > 0 ? Math.min(100, Math.max(0, (doneMs / totalWork) * 100)) : 0;
    // 倒计时未结束（仍有剩余净工时）时封顶 99.9%，倒计时结束才显示 100%（与小部件一致）
    const pctShow = totalWork > 0 ? (totalWork - doneMs > 0 ? Math.min(pct, 99.9) : 100) : 0;
    el.progressFill.style.width = pctShow.toFixed(1) + "%";
    el.progressPct.textContent = pctShow.toFixed(1) + "%";
    updateTodayCellFill(pct);
    let progLabel = "🕰️今日";
    if (todayIsWork) {
      const wStart = toDate(today.workStart, now.getTime());
      const wEnd = toDate(today.workEnd, now.getTime());
      if (now >= wStart && now < wEnd) {
        const remaining = Math.max(0, totalWork - doneMs);
        if (remaining > 0) progLabel = "🕰️今日 · 还需🦬 " + humanDuration(remaining);
      }
    }
    el.progressLabel.textContent = progLabel;
    const week = computeWeekProgress(now);
    el.weekFill.style.width = week.pct.toFixed(1) + "%";
    el.weekPct.textContent = week.pct.toFixed(1) + "%";
    let weekLabel = "⌛️ 本周";
    const weekRemaining = week.totalMs - week.doneMs;
    if (weekRemaining > 0) weekLabel = "⌛️ 本周 · 还需🏇 " + humanDuration(weekRemaining);
    el.weekLabel.textContent = weekLabel;
    // 月进度：工时口径，仅用于显示（工资口径在 updateMoneyDisplay 内独立计算）
    const month = cfg.showMonthProgress ? computeMonthProgress(now) : null;
    if (month) {
      el.monthWrap.style.display = "";
      el.monthFill.style.width = month.pct.toFixed(1) + "%";
      el.monthPct.textContent = month.pct.toFixed(1) + "%";
      let monthLabel = "🗓️ 本月";
      const monthRemaining = month.totalMs - month.doneMs;
      if (monthRemaining > 0) monthLabel = "🗓️ 本月 · 还需🫏 " + humanDuration(monthRemaining);
      el.monthLabel.textContent = monthLabel;
    } else {
      el.monthWrap.style.display = "none";
    }
    renderCalendar();
    updateMoneyDisplay();
  }

  let lastTargetEpoch = 0;
  function renderCountdown() {
    const now = Date.now();
    let ms = lastTargetEpoch > 0 ? lastTargetEpoch - now : 0;
    if (ms < 0) ms = 0;
    const d = fmtDur(ms);
    el.hh.textContent = pad(d.h);
    el.mm.textContent = pad(d.m);
    el.ss.textContent = pad(d.s);
    el.ms.textContent = "." + pad(Math.floor((ms % 1000) / 10));
  }
  // ---------- 进度计算（双口径） ----------
  // 工时口径（computeWeek/MonthProgress）：所有请假（全天/时段）的工时一律扣除——本周/本月总工时与"还需"随请假减少；
  // 工资口径（computeWeek/MonthPaidTime）：带薪假照常计入，作为时薪费率与已赚的基准（带薪假不影响当月工资）。
  function rangeTime(now, start, days, forSalary) {
    let totalMs = 0,
      doneMs = 0,
      futureWorkMs = 0;
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      // 非工作日（周末/法定假/小周周六）本就不计工时：按"不看请假"口径剔除；
      // 必须用 IgnoringLeave 版本，请假日的扣减交给下面 lvs 分支（带薪全天假工资口径仍计满额）
      if (!isWorkDayIgnoringLeave(d)) continue;
      const lvs = leaveInfosOf(d);
      const fullDay = !!(lvs && lvs.length && lvs.some(function (l) { return !l.start; }));
      let sch;
      if (fullDay) {
        // 全天假：工时口径整日 0；工资口径仅带薪按满额计
        if (!(forSalary && isPaidLeaveDay(d))) continue;
        sch = daySchedule(d);
      } else if (lvs && lvs.length) {
        // 时段假（可多段）：工时口径注入全部假段；工资口径只注入不带薪段（带薪段照常计薪）
        sch = effectiveDaySchedule(d, forSalary);
      } else {
        sch = daySchedule(d);
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
          const workSch = forSalary && lvs && lvs.length ? effectiveDaySchedule(d, false) : sch;
          const wTotal = totalWorkMs(workSch);
          const wDone = ymd(d) === ymd(now) && now > ws ? netWorkMs(workSch, ws, now) : 0;
          futureWorkMs += Math.max(0, wTotal - wDone);
        }
      }
    }
    return { totalMs, doneMs, futureWorkMs };
  }

  // ---------- 统计（月/年汇总，纯展示口径，不参与倒计时/工资判定） ----------
  // "本该上班"的基础判定（不含调班与请假）：统计分类用
  function statsBaseWorkDay(d) {
    var override = getHolidayOverride(d);
    if (override === "workday") return true;
    if (override === "holiday") return false;
    var idx = d.getDay();
    var sch = cfg.schedules[idx];
    if (!sch) return false;
    if (cfg.mode === "bigSmall" && idx === 6) return isBigWeek(d) && !!sch.workStart && !!sch.workEnd;
    return !!sch.enabled;
  }
  // overtimeDays=本不该上班却调班上班的天数；offDays=调休休息天数；leaveByReason=按原因的全天假天数
  function computeRangeStats(from, days, now) {
    var todayKey = ymd(now);
    var workDays = 0, pastWorkDays = 0, futureWorkDays = 0, leaveDays = 0, overtimeDays = 0, offDays = 0;
    var leaveByReason = {};
    var d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    for (var i = 0; i < days; i++) {
      var dk = ymd(d);
      var dov = dayOverrideOf(d);
      var due = isWorkDayIgnoringLeave(d); // 已含调班判定
      if (dov && !dov.off && !statsBaseWorkDay(d)) overtimeDays++;
      if (dov && dov.off) offDays++;
      if (due) {
        workDays++;
        if (dk < todayKey) pastWorkDays++;
        else futureWorkDays++;
        if (isFullLeaveDay(d)) {
          leaveDays++;
          var r = normalizeLeaveReason(leaveReasonOf(d)) || "其他";
          leaveByReason[r] = (leaveByReason[r] || 0) + 1;
        }
      }
      d.setDate(d.getDate() + 1);
    }
    var rt = rangeTime(now, new Date(from.getFullYear(), from.getMonth(), from.getDate()), days, false);
    return {
      workDays: workDays, pastWorkDays: pastWorkDays, futureWorkDays: futureWorkDays,
      leaveDays: leaveDays, leaveByReason: leaveByReason, overtimeDays: overtimeDays, offDays: offDays,
      totalMs: rt.totalMs, doneMs: rt.doneMs,
    };
  }
  function computeMonthStats(now, y, m) {
    var year = y == null ? now.getFullYear() : y;
    var month = m == null ? now.getMonth() : m;
    var days = new Date(year, month + 1, 0).getDate();
    return computeRangeStats(new Date(year, month, 1), days, now);
  }
  function computeYearStats(now) {
    var y = now.getFullYear();
    var days = (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 366 : 365;
    return computeRangeStats(new Date(y, 0, 1), days, now);
  }
  function pctOf(r) {
    return r.totalMs > 0 ? Math.min(100, Math.max(0, (r.doneMs / r.totalMs) * 100)) : 0;
  }
  function computeWeekProgress(now) {
    const r = rangeTime(now, getMondayOfWeek(now), 7, false);
    return { pct: pctOf(r), totalMs: r.totalMs, doneMs: r.doneMs };
  }
  function computeMonthProgress(now) {
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const r = rangeTime(now, new Date(now.getFullYear(), now.getMonth(), 1), days, false);
    return { pct: pctOf(r), totalMs: r.totalMs, doneMs: r.doneMs };
  }
  function computeWeekPaidTime(now) {
    return rangeTime(now, getMondayOfWeek(now), 7, true);
  }
  function computeMonthPaidTime(now) {
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return rangeTime(now, new Date(now.getFullYear(), now.getMonth(), 1), days, true);
  }
  // 标准月工时：本月"若无人请假"的应上工时（每个应上班日按满排班计，周末/法定假剔除）——时薪费率分母。
  // 分母不随请假浮动：事假天已赚不累计 → 月底已赚 < 月薪（事假扣款）；带薪假天照常累计 → 月底拿满。
  // 不能用 computeMonthPaidTime 的 totalMs 当分母：它会剔除不带薪假，分母变小费率变大，月底又补回满月薪，事假等于没扣。
  function computeMonthStandardTime(now) {
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    let totalMs = 0;
    for (let i = 0; i < days; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), 1 + i);
      if (!isWorkDayIgnoringLeave(d)) continue;
      totalMs += totalWorkMs(daySchedule(d));
    }
    return totalMs;
  }

  // ---------- 工资 / 已赚金额 ----------
  function hourlyRate(monthTotalMs) {
    if (!cfg.salaryEnabled || !cfg.monthlySalary || monthTotalMs <= 0) return 0;
    return cfg.monthlySalary / (monthTotalMs / 3600000);
  }
  function formatMoney(v) {
    if (v >= 100000) return Math.round(v).toLocaleString("zh-CN");
    return v.toFixed(2);
  }
  function earnedText(show, ms, rate) {
    if (!show || ms <= 0 || rate <= 0) return "";
    return "¥" + formatMoney((ms / 3600000) * rate);
  }
  // 工资口径独立于工时口径：费率分母=标准月工时（computeMonthStandardTime），周/月已赚=
  // 确定到手工时（带薪总工时 − 未来仍需上班工时，见 rangeTime 的 futureWorkMs）——带薪假
  // （含未来）立即视为已赚；今日已赚在带薪假日也照常按钟点累计；不带薪假日不计。
  function updateMoneyDisplay(now) {
    if (!el.dayEarned) return;
    if (!now) now = new Date();
    const show = !!cfg.salaryEnabled && cfg.monthlySalary > 0;
    let rate = 0,
      dayDone = 0,
      weekDone = 0,
      monthDone = 0;
    if (show) {
      rate = hourlyRate(computeMonthStandardTime(now));
      // 今日已赚（工资口径）：只扣不带薪假段；带薪时段照常累计。
      // 全天带薪假时 isWorkDay=false 但 paidToday=true，用"仅不带薪"有效排班照常走字
      const paidToday = isPaidLeaveDay(now);
      const todayMoney = effectiveDaySchedule(now, true);
      if (todayMoney && (isWorkDay(now) || paidToday)) {
        const ws = toDate(todayMoney.workStart, now.getTime());
        if (now > ws) dayDone = netWorkMs(todayMoney, ws, now);
      }
      // 周/月已赚 = 确定到手工时（带薪总工时 − 未来仍需上班工时）：带薪假（含未来）立即视为已赚
      const weekPaid = computeWeekPaidTime(now);
      weekDone = Math.max(0, weekPaid.totalMs - weekPaid.futureWorkMs);
      const monthPaid = computeMonthPaidTime(now);
      monthDone = Math.max(0, monthPaid.totalMs - monthPaid.futureWorkMs);
    }
    el.dayEarned.textContent = earnedText(show, dayDone, rate);
    el.weekEarned.textContent = earnedText(show, weekDone, rate);
    el.monthEarned.textContent = earnedText(show && cfg.showMonthProgress, monthDone, rate);
  }

  // ---------- 首页月历 ----------
  let calYear, calMonth;
  let calRenderKey = "";
  let calVersion = 0; // persist() 时 +1；避免每秒用 JSON.stringify 全量配置做缓存 key
  let lastTodayFillMs = 0; // 今日格子填充上次刷新时间；比例变化慢，每 5 分钟刷一次即可
  (function initCalMonth() {
    const t = new Date();
    calYear = t.getFullYear();
    calMonth = t.getMonth();
  })();

  // 今日已上班比例（净工时口径，与顶部"今日进度"一致）：休息/假日/全天假返回 0；
  // 时段假当天用有效排班（假段扣除后按剩余工时计）
  function todayWorkPct(now) {
    const sch = effectiveDaySchedule(now);
    if (!sch || !isWorkDay(now)) return 0;
    const total = totalWorkMs(sch);
    if (total <= 0) return 0;
    const ws = toDate(sch.workStart, now.getTime());
    const done = now > ws ? netWorkMs(sch, ws, now) : 0;
    return Math.min(100, Math.max(0, (done / total) * 100));
  }
  // 今日格子填充：从左上角向右下角推进（最小按 10% 显示），透明度与其他工作日一致（按时长 hrs/10）。
  // 剩余段颜色随剩余工时渐变：剩余越多越接近深紫（一天刚开始），临近下班逐渐转暖金
  // （与已完成段的金黄无缝衔接）；完成/剩余交界处留 ±10% 过渡带平滑混色，避免生硬分界线。
  // 剩余工时由 (100-完成度)% × 当日净工时 推导，无需额外传参。
  function todayWorkGradient(pct, hrs) {
    const alpha = Math.max(0.18, Math.min(0.55, hrs / 10)).toFixed(3);
    const fill = Math.max(10, Math.min(100, pct));
    const remainRatio = Math.max(0, Math.min(1, (100 - fill) / 100));
    const doneC = [255, 209, 102]; // 已完成：金黄
    const fullC = [150, 95, 215];  // 剩余很多：深紫
    const remC = doneC.map(function (c, i) {
      return Math.round(c + (fullC[i] - c) * remainRatio);
    });
    const band = 10; // 过渡带半宽（%）
    const s1 = Math.max(0, fill - band).toFixed(1);
    const s2 = Math.min(100, fill + band).toFixed(1);
    return (
      "linear-gradient(to bottom right, rgba(" + doneC.join(",") + "," + alpha + ") " + s1 +
      "%, rgba(" + remC.join(",") + "," + alpha + ") " + s2 + "%)"
    );
  }
  // 每 5 分钟刷新一次今天格子的背景（不重画整个日历）；应用从后台恢复时也会因超时立即刷新
  function updateTodayCellFill(pct) {
    if (!el.calGrid) return;
    const cell = el.calGrid.querySelector(".cal-cell.cal-today-work");
    if (!cell) return;
    const nowMs = Date.now();
    if (nowMs - lastTodayFillMs < 300000) return;
    lastTodayFillMs = nowMs;
    cell.style.background = todayWorkGradient(pct, totalWorkMs(effectiveDaySchedule(new Date())) / 3600000);
  }

  // ---------- 月历快速请假（双击日期） ----------
  let quickTapDate = null, quickTapTime = 0;
  let quickLeavePop = null, quickLeaveBox = null;
  // 与设置页请假下拉一致（无"调休"）；v 为存入 leaves 的裸类型
  const QUICK_LEAVE_OPTIONS = [
    { v: "年假", t: "🌴 年假" },
    { v: "事假", t: "📌 事假" },
    { v: "病假", t: "🤒 病假" },
    { v: "婚假", t: "💍 婚假" },
    { v: "产假", t: "👶 产假" },
    { v: "丧假", t: "🕯️ 丧假" },
    { v: "其他", t: "✏️ 其他" },
  ];
  function ensureQuickLeavePop() {
    if (quickLeavePop) return;
    const overlay = document.createElement("div");
    overlay.className = "quick-leave-overlay";
    const box = document.createElement("div");
    box.className = "quick-leave-box";
    overlay.appendChild(box);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeQuickLeave();
    });
    document.body.appendChild(overlay);
    quickLeavePop = overlay;
    quickLeaveBox = box;
  }
  function openQuickLeave(dk) {
    ensureQuickLeavePop();
    const d = new Date(dk + "T00:00:00");
    let html = '<div class="quick-leave-title">请假 ' + dk + "（" + WEEK_FULL[d.getDay()] + "）</div>";
    html += '<div class="quick-leave-timerow">' +
      '<label class="switch switch-text quick-leave-allday" title="切换全天假 / 时段假"><input type="checkbox" checked><span class="slider"></span></label>' +
      '<div class="quick-leave-qlbox" id="qlStartBox"></div>' +
      '<span class="quick-leave-sep">至</span>' +
      '<div class="quick-leave-qlbox" id="qlEndBox"></div>' +
      "</div>";
    html += '<div class="quick-leave-opts">';
    QUICK_LEAVE_OPTIONS.forEach(function (o) {
      html += '<button class="quick-leave-opt" data-v="' + o.v + '">' + o.t + "</button>";
    });
    html += "</div>";
    const curLvs = cfg.leaves && cfg.leaves.hasOwnProperty(dk) ? parseLeaveValue(cfg.leaves[dk]) : [];
    curLvs.forEach(function (info, idx) {
      html += '<button class="quick-leave-del" data-idx="' + idx + '">✕ 删除 ' + info.reason + (info.start ? " " + info.start + "-" + info.end : "") + "</button>";
    });
    html += '<button class="quick-leave-cancel">取消</button>';
    quickLeaveBox.innerHTML = html;
    const allDay = quickLeaveBox.querySelector(".quick-leave-allday input");
    const startBox = quickLeaveBox.querySelector("#qlStartBox");
    const endBox = quickLeaveBox.querySelector("#qlEndBox");
    const startPk = createTimePicker("08:30");
    const endPk = createTimePicker("12:00");
    startBox.appendChild(startPk.el);
    endBox.appendChild(endPk.el);
    function syncTime() {
      const full = allDay.checked;
      startBox.style.display = full ? "none" : "";
      endBox.style.display = full ? "none" : "";
      quickLeaveBox.querySelector(".quick-leave-sep").style.display = full ? "none" : "";
    }
    allDay.addEventListener("change", syncTime);
    syncTime();
    quickLeaveBox.querySelectorAll(".quick-leave-opt").forEach(function (b) {
      b.addEventListener("click", function () {
        const reason = this.dataset.v;
        var start = null,
          end = null;
        if (!allDay.checked) {
          start = startPk.getValue();
          end = endPk.getValue();
          if (start >= end) {
            showToast("结束时间需晚于开始时间");
            return;
          }
        }
        const added = addLeaveEntry(dk, reason, start, end);
        if (!added.ok) {
          showToast(added.err);
          return;
        }
        persist();
        closeQuickLeave();
        renderLeaveList();
        update();
        showToast("已添加请假 " + dk + "（" + added.text + "）");
      });
    });
    quickLeaveBox.querySelectorAll(".quick-leave-del").forEach(function (b) {
      b.addEventListener("click", function () {
        var idx = parseInt(this.dataset.idx, 10);
        if (!cfg.leaves || !cfg.leaves.hasOwnProperty(dk)) return;
        var infos = parseLeaveValue(cfg.leaves[dk]);
        if (idx >= 0 && idx < infos.length) infos.splice(idx, 1);
        if (infos.length === 0) delete cfg.leaves[dk];
        else if (infos.length === 1)
          cfg.leaves[dk] = infos[0].start
            ? { reason: infos[0].reason, start: infos[0].start, end: infos[0].end }
            : infos[0].reason;
        else cfg.leaves[dk] = infos;
        persist();
        closeQuickLeave();
        renderLeaveList();
        update();
        showToast("已删除请假 " + dk);
      });
    });
    quickLeaveBox.querySelector(".quick-leave-cancel").addEventListener("click", closeQuickLeave);
    quickLeavePop.classList.add("open");
  }
  function closeQuickLeave() {
    if (quickLeavePop) quickLeavePop.classList.remove("open");
  }

  // ---------- 日历长按：单日调班/加班 ----------
  let dayOvPop = null, dayOvBox = null;
  function ensureDayOvPop() {
    if (dayOvPop) return;
    const overlay = document.createElement("div");
    overlay.className = "quick-leave-overlay"; // 复用快捷请假的遮罩/盒子样式
    const box = document.createElement("div");
    box.className = "quick-leave-box";
    overlay.appendChild(box);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeDayOverride();
    });
    document.body.appendChild(overlay);
    dayOvPop = overlay;
    dayOvBox = box;
  }
  function openDayOverride(dk) {
    ensureDayOvPop();
    const d = new Date(dk + "T00:00:00");
    const curOv = dayOverrideOf(d);
    // 预填：已有调班用调班值，否则用当天模板（不含请假注入）；休息段沿用模板快照
    const tmpl = daySchedule(d) || { workStart: "09:00", workEnd: "18:00", breaks: [] };
    const preWs = curOv && !curOv.off ? curOv.workStart : tmpl.workStart;
    const preWe = curOv && !curOv.off ? curOv.workEnd : tmpl.workEnd;
    let html = '<div class="quick-leave-title">调班 ' + dk + "（" + WEEK_FULL[d.getDay()] + "）</div>";
    html += '<div class="quick-leave-hint" style="font-size:12px;color:var(--text-dim);margin:2px 0 8px;">仅影响这一天：加班改下班时间、临时休息、或周末/假日临时上班。请假照常扣减。</div>';
    html += '<div class="quick-leave-timerow">' +
      '<div class="quick-leave-qlbox" id="doStartBox"></div>' +
      '<span class="quick-leave-sep">至</span>' +
      '<div class="quick-leave-qlbox" id="doEndBox"></div>' +
      "</div>";
    html += '<div class="quick-leave-opts">';
    html += '<button class="quick-leave-opt" data-act="off">😴 休息（调休）</button>';
    html += '<button class="quick-leave-opt" data-act="save">✅ 保存时段</button>';
    html += "</div>";
    if (curOv) html += '<button class="quick-leave-del" data-act="clear">🗑️ 清除调班（恢复常规）</button>';
    html += '<button class="quick-leave-cancel">取消</button>';
    dayOvBox.innerHTML = html;
    const startPk = createTimePicker(preWs);
    const endPk = createTimePicker(preWe);
    dayOvBox.querySelector("#doStartBox").appendChild(startPk.el);
    dayOvBox.querySelector("#doEndBox").appendChild(endPk.el);
    dayOvBox.querySelectorAll(".quick-leave-opt").forEach(function (b) {
      b.addEventListener("click", function () {
        var msg;
        if (this.dataset.act === "off") {
          if (!cfg.dayOverrides) cfg.dayOverrides = {};
          cfg.dayOverrides[dk] = { off: true };
          msg = "已设置 " + dk + " 调休休息";
        } else {
          var ws = startPk.getValue(), we = endPk.getValue();
          if (ws >= we) {
            showToast("结束时间需晚于开始时间");
            return;
          }
          if (!cfg.dayOverrides) cfg.dayOverrides = {};
          cfg.dayOverrides[dk] = {
            workStart: ws,
            workEnd: we,
            breaks: (tmpl.breaks || []).map(function (br) { return { name: br.name, start: br.start, end: br.end }; }),
          };
          msg = "已设置 " + dk + " " + ws + "-" + we;
        }
        persist();
        closeDayOverride();
        update();
        showToast(msg);
      });
    });
    const clearBtn = dayOvBox.querySelector('.quick-leave-del[data-act="clear"]');
    if (clearBtn)
      clearBtn.addEventListener("click", function () {
        if (cfg.dayOverrides) delete cfg.dayOverrides[dk];
        persist();
        closeDayOverride();
        update();
        showToast("已清除 " + dk + " 的调班");
      });
    dayOvBox.querySelector(".quick-leave-cancel").addEventListener("click", closeDayOverride);
    dayOvPop.classList.add("open");
  }
  function closeDayOverride() {
    if (dayOvPop) dayOvPop.classList.remove("open");
  }

  // ---------- 统计面板 ----------
  // 展示口径：天数/工时与主页面同源（rangeTime 工时口径）；金额为工资口径（带薪假即时视为已赚）
  let statsYear = new Date().getFullYear(), statsMonth = new Date().getMonth();
  function statsFmtH(ms) {
    return (ms / 3600000).toFixed(1) + "h";
  }
  function statsLeaveText(byReason) {
    const keys = Object.keys(byReason);
    if (!keys.length) return "0 天";
    return keys.map(function (k) { return k + " " + byReason[k] + " 天"; }).join(" · ");
  }
  function renderStatsPanel() {
    const now = new Date();
    const m = computeMonthStats(now, statsYear, statsMonth);
    const y = computeYearStats(now);
    let html = "";
    html += '<div class="stats-row"><span>📅 应上工作日</span><b>' + m.workDays + " 天</b></div>";
    html += '<div class="stats-row"><span>✅ 已完成工时</span><b>' + statsFmtH(m.doneMs) + " / " + statsFmtH(m.totalMs) + "</b></div>";
    html += '<div class="stats-row"><span>📝 全天请假</span><b>' + statsLeaveText(m.leaveByReason) + "</b></div>";
    html += '<div class="stats-row"><span>⏰ 调班上班</span><b>' + m.overtimeDays + " 天</b></div>";
    html += '<div class="stats-row"><span>😴 调休休息</span><b>' + m.offDays + " 天</b></div>";
    if (cfg.salaryEnabled && cfg.monthlySalary > 0) {
      const days = new Date(statsYear, statsMonth + 1, 0).getDate();
      const moP = rangeTime(now, new Date(statsYear, statsMonth, 1), days, true);
      const moStd = computeMonthStandardTime(new Date(statsYear, statsMonth, 15));
      if (moStd > 0) {
        const earned = Math.max(0, moP.totalMs - moP.futureWorkMs) * cfg.monthlySalary / moStd;
        html += '<div class="stats-row"><span>💰 本月已赚（确定到手）</span><b>¥' + (earned >= 100000 ? Math.round(earned) : earned.toFixed(2)) + "</b></div>";
      }
    }
    html += '<div class="stats-sub">🗓️ ' + now.getFullYear() + " 年累计</div>";
    html += '<div class="stats-row"><span>应上 / 已过工作日</span><b>' + y.workDays + " / " + y.pastWorkDays + " 天</b></div>";
    html += '<div class="stats-row"><span>已完成工时</span><b>' + statsFmtH(y.doneMs) + " / " + statsFmtH(y.totalMs) + "</b></div>";
    html += '<div class="stats-row"><span>全年请假</span><b>' + statsLeaveText(y.leaveByReason) + "</b></div>";
    html += '<div class="stats-row"><span>调班上班 / 调休休息</span><b>' + y.overtimeDays + " / " + y.offDays + " 天</b></div>";
    el.statsBody.innerHTML = html;
    el.statsMonthLabel.textContent = statsYear + "年" + (statsMonth + 1) + "月";
  }
  function openStatsPanel() {
    // 统计默认跟随月历当前显示的月份，之后面板内可独立翻月
    statsYear = calYear;
    statsMonth = calMonth;
    renderStatsPanel();
    el.statsOverlay.classList.add("open");
  }
  if (el.calStatsBtn) el.calStatsBtn.addEventListener("click", openStatsPanel);
  if (el.statsClose)
    el.statsClose.addEventListener("click", function () {
      el.statsOverlay.classList.remove("open");
    });
  if (el.statsOverlay)
    el.statsOverlay.addEventListener("click", function (e) {
      if (e.target === el.statsOverlay) el.statsOverlay.classList.remove("open");
    });
  if (el.statsPrevBtn)
    el.statsPrevBtn.addEventListener("click", function () {
      statsMonth--;
      if (statsMonth < 0) {
        statsMonth = 11;
        statsYear--;
      }
      renderStatsPanel();
    });
  if (el.statsNextBtn)
    el.statsNextBtn.addEventListener("click", function () {
      statsMonth++;
      if (statsMonth > 11) {
        statsMonth = 0;
        statsYear++;
      }
      renderStatsPanel();
    });

  function renderCalendar() {
    if (!el.calGrid) return;
    const key = calVersion + "|" + calYear + "-" + calMonth + "|" + ymd(new Date());
    if (key === calRenderKey) return;
    calRenderKey = key;
    const today = new Date();
    const todayKey = ymd(today);
    el.calMonthLabel.textContent = calYear + "年" + (calMonth + 1) + "月";
    const frag = document.createDocumentFragment();
    WEEK_ORDER.forEach(function (w) {
      const h = document.createElement("div");
      h.className = "cal-dow";
      h.textContent = WEEK_LABEL[w];
      frag.appendChild(h);
    });
    const first = new Date(calYear, calMonth, 1);
    const firstDow = first.getDay();
    const startOffset = firstDow === 0 ? 6 : firstDow - 1;
    const startCellCount = 42;
    const baseTime = new Date(calYear, calMonth, 1 - startOffset).getTime();

    for (let i = 0; i < startCellCount; i++) {
      const d = new Date(baseTime + i * 86400000);
      const inMonth = d.getMonth() === calMonth;
      const cell = document.createElement("div");
      cell.className = "cal-cell";
      if (!inMonth) cell.classList.add("outside");
      cell.dataset.date = ymd(d);
      const dk = ymd(d);
      const override = getHolidayOverride(d);
      const lvs = leaveInfosOf(d);
      const lvFull = !!(lvs && lvs.length && lvs.some(function (l) { return !l.start; }));
      const lvText = lvs && lvs.length
        ? lvs.map(function (l) { return l.start ? l.reason + " " + l.start + "-" + l.end : l.reason; }).join(" · ")
        : "";
      const work = isWorkDay(d);
      const dov = dayOverrideOf(d);
      let badge = "",
        hoursText = "",
        detail = WEEK_FULL[d.getDay()];
      if (lvFull) {
        // 全天假：整日休息
        cell.classList.add("leave");
        badge = "假";
        detail += " · 请假（" + lvText + "）";
      } else if (dov && dov.off) {
        cell.classList.add("rest");
        badge = "调";
        detail += " · 调休休息";
      } else if (dov) {
        // 单日调班/加班：按调班时段上班（配色同工作日）
        const hrs = totalWorkMs(effectiveDaySchedule(d)) / 3600000;
        cell.classList.add("work");
        badge = lvs ? "假" : "调";
        detail += " · 调班 " + dov.workStart + "-" + dov.workEnd + " 约" + hrs.toFixed(1) + "h";
        if (lvs) detail += " · 请假（" + lvText + "）";
        const alpha = Math.max(0.18, Math.min(0.55, hrs / 10));
        if (dk === todayKey) {
          cell.classList.add("cal-today-work");
          cell.style.color = "white";
          cell.style.background = todayWorkGradient(todayWorkPct(new Date()), hrs);
        } else if (dk < todayKey) {
          cell.style.color = "white";
          cell.style.background = "rgba(255, 209, 102, " + alpha.toFixed(3) + ")";
        } else {
          cell.style.background = "rgba(183, 128, 217, " + alpha.toFixed(3) + ")";
        }
        hoursText = hrs.toFixed(1) + "h";
      } else if (override === "holiday") {
        cell.classList.add("holiday");
        badge = "休";
        detail += " · 法定假日";
      } else if (override === "workday") {
        const mkHrs = totalWorkMs(effectiveDaySchedule(d)) / 3600000;
        cell.classList.add("makeup");
        badge = "班";
        detail += " · 调休上班 约" + mkHrs.toFixed(1) + "h";
        if (lvs) {
          badge = "假";
          detail += " · 请假（" + lvText + "）";
        }
        if (dk === todayKey) {
          cell.classList.add("cal-today-work");
          cell.style.color = "white";
          cell.style.background = todayWorkGradient(todayWorkPct(new Date()), mkHrs);
        }
      } else if (work) {
        cell.classList.add("work");
        const hrs = totalWorkMs(effectiveDaySchedule(d)) / 3600000;
        const alpha = Math.max(0.18, Math.min(0.55, hrs / 10));
        if (dk === todayKey) {
          cell.classList.add("cal-today-work");
          cell.style.color = "white";
          cell.style.background = todayWorkGradient(todayWorkPct(new Date()), hrs);
        } else if (dk < todayKey) {
          cell.style.color = "white";
          cell.style.background = "rgba(255, 209, 102, " + alpha.toFixed(3) + ")";
        } else {
          cell.style.background = "rgba(183, 128, 217, " + alpha.toFixed(3) + ")";
        }
        hoursText = hrs.toFixed(1) + "h";
        detail += " · 上班 约" + hrs.toFixed(1) + "h";
        if (lvs) {
          // 时段假：当天仍是工作日，角标记"假"、详情注明请假时段（工时已扣除）
          badge = "假";
          detail += " · 请假（" + lvText + "）";
        }
      } else {
        cell.classList.add("rest");
        detail += " · 休息";
      }
      if (dk === todayKey) {
        cell.classList.add("today");
        detail += " · 今天";
      }
      let inner = '<span class="cal-num">' + d.getDate() + "</span>";
      if (hoursText) inner += '<span class="cal-hours">' + hoursText + "</span>";
      if (badge) inner += '<span class="cal-badge">' + badge + "</span>";
      cell.innerHTML = inner;
      if (inMonth) {
        // 长按 550ms：调班/加班弹窗（touch 端）；桌面右键同入口
        var lpTimer = null, lpFired = false;
        cell.addEventListener("touchstart", function () {
          lpFired = false;
          lpTimer = setTimeout(function () {
            lpFired = true;
            openDayOverride(dk);
          }, 550);
        }, { passive: true });
        ["touchmove", "touchcancel"].forEach(function (ev) {
          cell.addEventListener(ev, function () {
            if (lpTimer) {
              clearTimeout(lpTimer);
              lpTimer = null;
            }
          }, { passive: true });
        });
        cell.addEventListener("touchend", function (e) {
          if (lpTimer) {
            clearTimeout(lpTimer);
            lpTimer = null;
          }
          if (lpFired) {
            e.preventDefault();
            lpFired = false;
          }
        });
        cell.addEventListener("contextmenu", function (e) {
          e.preventDefault();
          openDayOverride(dk);
        });
        cell.addEventListener("click", function () {
          if (lpFired) return;
          // 双击（400ms 内连点同一格）：快速请假；单击仍显示当天详情
          const t = Date.now();
          if (dk === quickTapDate && t - quickTapTime < 400) {
            quickTapDate = null;
            quickTapTime = 0;
            openQuickLeave(dk);
          } else {
            quickTapDate = dk;
            quickTapTime = t;
            showToast(dk + " " + detail);
          }
        });
      }
      frag.appendChild(cell);
    }
    el.calGrid.innerHTML = "";
    el.calGrid.appendChild(frag);
  }

  // ---------- 启动 ----------
  cfg = parseConfig(readLocalSync());
  rebuildRemoteHolidays();
  renderModeUI();
  renderWeekdayBar();
  renderDayForm();
  renderOtherSettings();
  update();
  updateMoneyDisplay();
  loadConfigAsync()
    .then(function (saved) {
      if (!isInitialLoad) return;
      isInitialLoad = false;
      if (!saved) return;
      const next = parseConfig(saved);
      cfg.schedules = next.schedules;
      cfg.mode = next.mode;
      cfg.bigSmallAnchor = next.bigSmallAnchor;
      cfg.holidays = next.holidays || {};
      cfg.leaves = next.leaves || {};
      cfg.deletedBuiltinHolidays = next.deletedBuiltinHolidays || {};
      cfg.dayOverrides = next.dayOverrides || {};
      cfg.showMonthProgress = !!next.showMonthProgress;
      cfg.salaryEnabled = !!next.salaryEnabled;
      cfg.monthlySalary = next.monthlySalary || 0;
      cfg.offworkReminder = next.offworkReminder || 0;
      cfg.remoteHolidays = next.remoteHolidays || {};
      rebuildRemoteHolidays();
      renderModeUI();
      renderWeekdayBar();
      renderDayForm();
      renderOtherSettings();
      update();
      updateMoneyDisplay();
    })
    .catch(function () {
      isInitialLoad = false;
    });

  setInterval(update, 1000); // update() 内部顺带刷新工资显示（每秒足够，金额每秒最多变 ¥0.01）
  function tickCountdown() {
    renderCountdown();
    requestAnimationFrame(tickCountdown);
  }
  requestAnimationFrame(tickCountdown);
})();
