// settings.js — 设置页（排班 / 节假日 / 请假 / 其他 四个 Tab）
const app = getApp();
const sched = require("../../utils/schedule.js");
const config = require("../../utils/config.js");
const holidays = require("../../utils/holidays.js");
const fmt = require("../../utils/format.js");
const feed = require("../../utils/holiday-feed.js");

const HOLIDAY_TYPE_OPTIONS = ["🎉 节假日", "💼 调休日"];
const HOLIDAY_TYPE_VALUES = ["holiday", "workday"];
const LEAVE_REASON_OPTIONS = ["🌴 年假", "📌 事假", "🤒 病假", "💍 婚假", "👶 产假", "🕯️ 丧假", "✏️ 其他"];

function showToast(msg) { wx.showToast({ title: msg, icon: "none", duration: 1600 }); }

Page({
  data: {
    activeTab: "schedule",
    // —— 排班 ——
    mode: "fixed",
    thisWeekBig: true,
    editingDay: 1,
    editingVariant: "big",
    isSatAlt: false,
    isAltDay: false,
    weekdayBar: [],
    weekdayLegend: [],
    dayEditorTitle: "—",
    workStart: "09:00",
    workEnd: "18:00",
    workdayChecked: true,
    dayBodyDisabled: false,
    satInfo: "",
    showVariantClear: false,
    breaks: [],
    workDurationHint: "",
    // —— 节假日 ——
    holidayDate: "",
    holidayTypeIndex: 0,
    holidayTypeOptions: HOLIDAY_TYPE_OPTIONS,
    holidaySubtab: "builtin",
    holidayOnlineStatus: "🌐 在线数据：未更新",
    holidayOnlineWarn: false,
    holidayUpdating: false,
    builtinGroups: [],
    customHolidays: [],
    // —— 请假 ——
    leaveDate: "",
    leaveReasonIndex: 0,
    leaveReasonOptions: LEAVE_REASON_OPTIONS,
    leaveAllDay: true,
    leaveStartTime: "08:30",
    leaveEndTime: "12:00",
    leaveList: [],
    // —— 其他 ——
    showMonthProgress: false,
    salaryEnabled: false,
    monthlySalaryText: "",
    showSalaryConfig: false,
  },

  onLoad() {
    this.cfg = app.getConfig();
    this.setData({ editingDay: new Date().getDay() });
    this.renderAll();
  },

  // 从 transfer 页导入返回后，刷新所有 Tab 显示（cfg 为同一引用，已被就地更新）
  onShow() {
    if (this.cfg) this.renderAll();
  },

  persist() { app.saveConfig(this.cfg); },

  // 当前正在编辑的 schedule（大小周小周切换时懒初始化 small）
  editingSchedule() {
    const cfg = this.cfg;
    const ed = this.data.editingDay;
    const main = cfg.schedules[ed];
    if (cfg.mode === "bigSmall" && ed >= 1 && ed <= 5 && this.data.editingVariant === "small") {
      if (!main.small) main.small = sched.cloneDayTimes(main);
      return main.small;
    }
    return main;
  },

  renderAll() {
    this.renderSchedule();
    this.renderHoliday();
    this.renderLeave();
    this.renderOther();
  },

  // ===================== Tab 切换 =====================
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
    if (tab === "schedule") this.renderSchedule();
    else if (tab === "holiday") this.renderHoliday();
    else if (tab === "leave") this.renderLeave();
    else if (tab === "other") this.renderOther();
  },

  // ===================== 排班 =====================
  renderSchedule() {
    const cfg = this.cfg;
    const ed = this.data.editingDay;
    const today = new Date().getDay();
    const thisWeekBig = sched.isBigWeek(cfg, new Date());
    const isSatAlt = (cfg.mode === "bigSmall" && ed === 6);
    const isAltDay = (cfg.mode === "bigSmall" && ed >= 1 && ed <= 5);
    const day = this.editingSchedule();

    const weekdayBar = sched.WEEK_ORDER.map(function (d) {
      let cls = "weekday";
      if (d === ed) cls += " active";
      if (d === today) cls += " today";
      const isSatAltD = (cfg.mode === "bigSmall" && d === 6);
      const hasAltD = (cfg.mode === "bigSmall" && d >= 1 && d <= 5 && cfg.schedules[d].small && !sched.dayTimesEqual(cfg.schedules[d].small, cfg.schedules[d]));
      if (isSatAltD) cls += " alt";
      else if (!cfg.schedules[d].enabled) cls += " off-day";
      if (hasAltD) cls += " has-alt";
      return { day: d, label: sched.WEEK_LABEL[d], cls: cls };
    });

    const base = Date.now();
    const ws = sched.toDate(day.workStart, base);
    const we = sched.toDate(day.workEnd, base);
    let workDurationHint = "";
    if (we <= ws) workDurationHint = "⚠️ 下班时间应晚于上班时间";
    else {
      const span = we - ws;
      const net = sched.netWorkMs(day, ws, we);
      const breakSum = span - net;
      workDurationHint = breakSum > 0
        ? "跨度 " + fmt.humanDuration(span) + " · 休息 " + fmt.humanDuration(breakSum) + " · 工作 " + fmt.humanDuration(net)
        : "跨度 " + fmt.humanDuration(span) + " · 工作 " + fmt.humanDuration(net);
    }
    let warn = "";
    (day.breaks || []).forEach((b, i) => { if (sched.toDate(b.end, base) <= sched.toDate(b.start, base)) warn += "；休息" + (i + 1) + "结束应晚于开始"; });
    if (warn) workDurationHint += " ⚠️" + warn.slice(1);

    const breaks = (day.breaks || []).map((b, i) => ({ idx: i, name: b.name || ("休息" + (i + 1)), start: b.start, end: b.end }));

    let satInfo = "";
    if (isSatAlt) satInfo = "🔄 大小周模式：周六是否上班由排班自动决定。本周六：" + (thisWeekBig ? "上班" : "休息") + "（" + (thisWeekBig ? "大周" : "小周") + "）";

    const weekdayLegend = ["描边 = 今天", "半透明 = 休息日"];
    if (cfg.mode === "bigSmall") weekdayLegend.push("蓝底六 = 大小周交替", "文字后 • = 大小周时间不同");

    this.setData({
      mode: cfg.mode,
      thisWeekBig,
      weekdayBar,
      weekdayLegend,
      dayEditorTitle: sched.WEEK_FULL[ed],
      isSatAlt, isAltDay,
      showVariantClear: (this.data.editingVariant === "small" && !!cfg.schedules[ed].small && !sched.dayTimesEqual(cfg.schedules[ed].small, cfg.schedules[ed])),
      workStart: day.workStart, workEnd: day.workEnd,
      workdayChecked: !!cfg.schedules[ed].enabled,
      dayBodyDisabled: isSatAlt ? false : !cfg.schedules[ed].enabled,
      satInfo, breaks, workDurationHint,
    });
  },

  setMode(e) {
    const mode = e.currentTarget.dataset.mode;
    this.cfg.mode = mode;
    if (mode === "bigSmall") {
      const sat = this.cfg.schedules[6];
      sat.workStart = sat.workStart || "09:00";
      sat.workEnd = sat.workEnd || "18:00";
      if (!sat.breaks || sat.breaks.length === 0) sat.breaks = [{ name: "午休", start: "12:00", end: "13:00" }];
      if (!this.cfg.bigSmallAnchor) sched.setThisWeekType(this.cfg, "big");
    }
    this.setData({ editingVariant: "big" });
    this.persist(); this.renderSchedule();
  },

  setWeekType(e) {
    const type = e.currentTarget.dataset.type;
    sched.setThisWeekType(this.cfg, type);
    this.persist(); this.renderSchedule();
    showToast("已设置本周为" + (type === "big" ? "大周" : "小周"));
  },

  selectDay(e) {
    this.setData({ editingDay: e.currentTarget.dataset.day, editingVariant: "big" });
    this.renderSchedule();
  },

  toggleWorkday(e) {
    const ed = this.data.editingDay;
    const day = this.cfg.schedules[ed];
    day.enabled = e.detail.value;
    if (day.enabled && (!day.breaks || day.breaks.length === 0)) day.breaks = [{ name: "午休", start: "12:00", end: "13:00" }];
    this.persist(); this.renderSchedule();
  },

  setVariant(e) {
    this.setData({ editingVariant: e.currentTarget.dataset.variant });
    this.renderSchedule();
  },

  clearVariant() {
    delete this.cfg.schedules[this.data.editingDay].small;
    this.setData({ editingVariant: "big" });
    this.persist(); this.renderSchedule();
    showToast("已清除小周差异");
  },

  changeWorkStart(e) { this.editingSchedule().workStart = e.detail.value; this.persist(); this.renderSchedule(); },
  changeWorkEnd(e) { this.editingSchedule().workEnd = e.detail.value; this.persist(); this.renderSchedule(); },

  changeBreakName(e) {
    const idx = e.currentTarget.dataset.idx;
    this.editingSchedule().breaks[idx].name = e.detail.value;
    this.persist();
  },
  changeBreakStart(e) {
    const idx = e.currentTarget.dataset.idx;
    this.editingSchedule().breaks[idx].start = e.detail.value;
    this.persist(); this.renderSchedule();
  },
  changeBreakEnd(e) {
    const idx = e.currentTarget.dataset.idx;
    this.editingSchedule().breaks[idx].end = e.detail.value;
    this.persist(); this.renderSchedule();
  },
  delBreak(e) {
    const idx = e.currentTarget.dataset.idx;
    this.editingSchedule().breaks.splice(idx, 1);
    this.persist(); this.renderSchedule();
  },
  addBreak() {
    const day = this.editingSchedule();
    if (!Array.isArray(day.breaks)) day.breaks = [];
    day.breaks.push({ name: "休息" + (day.breaks.length + 1), start: "12:00", end: "13:00" });
    this.persist(); this.renderSchedule();
  },

  applyAll() {
    const cfg = this.cfg;
    const isSmallVariant = (cfg.mode === "bigSmall" && this.data.editingVariant === "small");
    const src = this.editingSchedule();
    let count = 0;
    sched.WEEK_ORDER.forEach((d) => {
      if (d === this.data.editingDay) return;
      if (cfg.mode === "bigSmall" && d === 6) return;
      const dst = cfg.schedules[d];
      if (!dst.enabled) return;
      const target = isSmallVariant ? (dst.small || (dst.small = sched.cloneDayTimes(dst))) : dst;
      target.workStart = src.workStart;
      target.workEnd = src.workEnd;
      target.breaks = src.breaks.map((b) => ({ name: b.name, start: b.start, end: b.end }));
      count++;
    });
    this.persist(); this.renderSchedule();
    showToast("已应用到 " + count + " 个工作日" + (isSmallVariant ? "（小周）" : ""));
  },

  resetDefaults() {
    wx.showModal({
      title: "恢复默认排班",
      content: "确定恢复默认排班设置吗？（节假日、请假、工资等不受影响）",
      success: (res) => {
        if (!res.confirm) return;
        this.cfg.schedules = config.defaultSchedules();
        this.cfg.mode = "fixed";
        this.cfg.bigSmallAnchor = null;
        this.setData({ editingDay: new Date().getDay(), editingVariant: "big" });
        this.persist(); this.renderSchedule();
        showToast("已恢复默认排班设置");
      },
    });
  },

  goTransfer(e) {
    wx.navigateTo({ url: "../transfer/transfer?action=" + e.currentTarget.dataset.action });
  },

  // ===================== 节假日 =====================
  renderHoliday() {
    const cfg = this.cfg;
    const remote = sched.remoteHolidayInfo(cfg);
    const remoteMap = remote ? remote.map : {};
    // 展示分组：内置编译分组 + 在线数据分组（在线分组名带年份前缀并标 🌐；内置分组里已被在线修正的日期跳过）
    const groups = [];
    holidays.HOLIDAY_GROUPS.forEach(function (group) {
      groups.push({ name: group.name, holidays: group.holidays, workdays: group.workdays, online: false });
    });
    if (cfg.remoteHolidays && typeof cfg.remoteHolidays === "object") {
      Object.keys(cfg.remoteHolidays).sort().forEach(function (y) {
        if (!Array.isArray(cfg.remoteHolidays[y])) return;
        cfg.remoteHolidays[y].forEach(function (g) {
          if (!g || typeof g.name !== "string") return;
          groups.push({ name: y + " · " + g.name, holidays: Array.isArray(g.holidays) ? g.holidays : [], workdays: Array.isArray(g.workdays) ? g.workdays : [], online: true });
        });
      });
    }
    const builtinGroups = groups.map(function (group) {
      const items = [];
      group.holidays.forEach(function (d) {
        if (!group.online && remoteMap.hasOwnProperty(d)) return;
        if (!cfg.deletedBuiltinHolidays || !cfg.deletedBuiltinHolidays.hasOwnProperty(d))
          items.push({ date: d, type: "holiday", overridden: !!(cfg.holidays && cfg.holidays.hasOwnProperty(d)), builtin: 1 });
      });
      group.workdays.forEach(function (d) {
        if (!group.online && remoteMap.hasOwnProperty(d)) return;
        if (!cfg.deletedBuiltinHolidays || !cfg.deletedBuiltinHolidays.hasOwnProperty(d))
          items.push({ date: d, type: "workday", overridden: !!(cfg.holidays && cfg.holidays.hasOwnProperty(d)), builtin: 1 });
      });
      if (items.length === 0) return null;
      items.sort(function (a, b) { return a.date.localeCompare(b.date); });
      return { name: (group.online ? "🌐 " : "") + group.name, count: items.length, items: items };
    }).filter(Boolean);

    const customHolidays = [];
    if (cfg.holidays) Object.keys(cfg.holidays).forEach(function (k) {
      if (!sched.isPresetHolidayKey(cfg, k)) customHolidays.push({ date: k, type: cfg.holidays[k], builtin: 0 });
    });
    customHolidays.sort(function (a, b) { return a.date.localeCompare(b.date); });

    // 在线状态行：当前年份没有任何法定数据时给出醒目提醒
    const builtinYears = [];
    holidays.HOLIDAY_GROUPS.forEach(function (g) {
      g.holidays.concat(g.workdays).forEach(function (d) {
        const y = d.slice(0, 4);
        if (builtinYears.indexOf(y) < 0) builtinYears.push(y);
      });
    });
    builtinYears.sort();
    const remoteYears = remote ? remote.years : [];
    const thisYear = String(new Date().getFullYear());
    const missing = builtinYears.concat(remoteYears).indexOf(thisYear) < 0;
    let statusText = remoteYears.length > 0
      ? "🌐 在线数据已加载：" + remoteYears.join("、") + " 年"
      : "🌐 在线数据：未更新（当前为内置数据 " + builtinYears.join("、") + " 年）";
    if (missing) statusText += "\n⚠️ " + thisYear + " 年暂无法定节假日数据，请在线更新或手动添加";

    this.setData({ builtinGroups, customHolidays, holidayOnlineStatus: statusText, holidayOnlineWarn: missing });
  },

  // 在线更新节假日：wx.request 拉取仓库 holidays.json → 校验 → 写入 cfg.remoteHolidays
  onlineUpdateHoliday() {
    if (this.data.holidayUpdating) return;
    this.setData({ holidayUpdating: true });
    wx.request({
      url: feed.HOLIDAY_FEED_URL,
      method: "GET",
      timeout: 15000,
      success: (res) => {
        try {
          if (res.statusCode !== 200) throw new Error("HTTP " + res.statusCode);
          const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
          const v = feed.validateRemoteHolidayData(JSON.parse(text));
          this.cfg.remoteHolidays = v.years;
          this.persist();
          this.renderHoliday();
          showToast("✅ 已更新 " + v.count + " 天节假日");
        } catch (e) {
          showToast("❌ 数据无效：" + (e && e.message ? e.message : "未知错误"));
        }
      },
      fail: () => {
        showToast("❌ 网络错误，请稍后重试");
      },
      complete: () => {
        this.setData({ holidayUpdating: false });
      },
    });
  },

  changeHolidayDate(e) { this.setData({ holidayDate: e.detail.value }); },
  changeHolidayType(e) { this.setData({ holidayTypeIndex: e.detail.value }); },
  switchHolidaySubtab(e) { this.setData({ holidaySubtab: e.currentTarget.dataset.subtab }); },

  addHoliday() {
    const date = this.data.holidayDate;
    if (!date) { showToast("请先选择日期"); return; }
    const type = HOLIDAY_TYPE_VALUES[this.data.holidayTypeIndex];
    if (!this.cfg.holidays) this.cfg.holidays = {};
    this.cfg.holidays[date] = type;
    if (this.cfg.deletedBuiltinHolidays && this.cfg.deletedBuiltinHolidays.hasOwnProperty(date)) delete this.cfg.deletedBuiltinHolidays[date];
    this.persist(); this.renderHoliday();
    const typeName = type === "holiday" ? "节假日（休息）" : "调休日（上班）";
    showToast("已设置 " + date + " 为" + typeName);
    if (holidays.BUILTIN_HOLIDAYS.hasOwnProperty(date) || sched.isPresetHolidayKey(this.cfg, date)) this.setData({ holidaySubtab: "builtin" });
    else this.setData({ holidaySubtab: "custom" });
    this.setData({ holidayDate: "" });
  },

  editHoliday(e) {
    const { date, type } = e.currentTarget.dataset;
    const idx = HOLIDAY_TYPE_VALUES.indexOf(type);
    this.setData({ holidayDate: date, holidayTypeIndex: idx >= 0 ? idx : 0 });
    showToast("已载入 " + date + "，修改后点击添加即可覆盖");
  },

  delHoliday(e) {
    const { date, builtin } = e.currentTarget.dataset;
    if (builtin == 1 || builtin === "1") {
      if (!this.cfg.deletedBuiltinHolidays) this.cfg.deletedBuiltinHolidays = {};
      this.cfg.deletedBuiltinHolidays[date] = true;
    } else {
      if (this.cfg.holidays && this.cfg.holidays.hasOwnProperty(date)) delete this.cfg.holidays[date];
    }
    this.persist(); this.renderHoliday();
    showToast("已移除 " + date);
  },

  resetBuiltin() {
    wx.showModal({
      title: "恢复法定节假日",
      content: "确定要恢复全部默认法定节假日吗？这将撤销你对内置节假日的所有删除和修改，并清除已下载的在线节假日数据。",
      success: (res) => {
        if (!res.confirm) return;
        this.cfg.deletedBuiltinHolidays = {};
        if (this.cfg.holidays) Object.keys(this.cfg.holidays).forEach((k) => { if (sched.isPresetHolidayKey(this.cfg, k)) delete this.cfg.holidays[k]; });
        this.cfg.remoteHolidays = {};
        this.persist(); this.renderHoliday();
        showToast("已恢复全部默认法定节假日");
      },
    });
  },

  // ===================== 请假 =====================
  renderLeave() {
    const dates = this.cfg.leaves ? Object.keys(this.cfg.leaves) : [];
    dates.sort(function (a, b) { return a.localeCompare(b); });
    const leaveList = [];
    dates.forEach((d) => {
      sched.parseLeaveValue(this.cfg.leaves[d]).forEach((info) => {
        leaveList.push({ date: d, reason: info.reason + (info.start ? " " + info.start + "-" + info.end : "") });
      });
    });
    this.setData({ leaveList });
  },

  changeLeaveDate(e) { this.setData({ leaveDate: e.detail.value }); },
  changeLeaveReason(e) { this.setData({ leaveReasonIndex: e.detail.value }); },
  onLeaveAllDayChange(e) { this.setData({ leaveAllDay: e.detail.value }); },
  changeLeaveStartTime(e) { this.setData({ leaveStartTime: e.detail.value }); },
  changeLeaveEndTime(e) { this.setData({ leaveEndTime: e.detail.value }); },

  addLeave() {
    const date = this.data.leaveDate;
    if (!date) { showToast("请先选择日期"); return; }
    const reason = LEAVE_REASON_OPTIONS[this.data.leaveReasonIndex].replace(/^\S+\s*/, "");
    let start = null, end = null;
    if (!this.data.leaveAllDay) {
      // 按时段请假（picker mode=time 返回已补零的 "HH:MM"）
      start = this.data.leaveStartTime;
      end = this.data.leaveEndTime;
    }
    const r = sched.addLeaveEntry(this.cfg, date, reason, start, end);
    if (!r.ok) { showToast(r.err); return; }
    this.persist(); this.renderLeave();
    showToast("已添加请假 " + date + "（" + r.text + "）");
    this.setData({ leaveDate: "", leaveReasonIndex: 0, leaveAllDay: true });
  },

  delLeave(e) {
    const date = e.currentTarget.dataset.date;
    const idx = e.currentTarget.dataset.idx;
    sched.removeLeaveEntry(this.cfg, date, idx);
    this.persist(); this.renderLeave();
    showToast("已删除请假 " + date);
  },

  clearLeaves() {
    const n = this.cfg.leaves ? Object.keys(this.cfg.leaves).length : 0;
    if (n === 0) { showToast("没有请假记录"); return; }
    wx.showModal({
      title: "清空请假",
      content: "确定要清空全部 " + n + " 条请假记录吗？",
      success: (res) => {
        if (!res.confirm) return;
        this.cfg.leaves = {};
        this.persist(); this.renderLeave();
        showToast("已清空全部请假");
      },
    });
  },

  // ===================== 其他 =====================
  renderOther() {
    this.setData({
      showMonthProgress: !!this.cfg.showMonthProgress,
      salaryEnabled: !!this.cfg.salaryEnabled,
      monthlySalaryText: this.cfg.monthlySalary > 0 ? String(this.cfg.monthlySalary) : "",
      showSalaryConfig: !!this.cfg.salaryEnabled,
    });
  },

  toggleMonthProgress(e) {
    this.cfg.showMonthProgress = e.detail.value;
    this.persist(); this.renderOther();
    showToast(e.detail.value ? "已显示本月进度" : "已隐藏本月进度");
  },
  toggleSalary(e) {
    this.cfg.salaryEnabled = e.detail.value;
    this.persist(); this.renderOther();
    showToast(e.detail.value ? "已开启工资显示" : "已关闭工资显示");
  },
  changeSalary(e) {
    const val = Number(e.detail.value);
    this.cfg.monthlySalary = (isFinite(val) && val > 0) ? val : 0;
    this.persist();
  },
});
