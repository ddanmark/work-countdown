// index.js — 主页：倒计时 / 进度 / 工资 / 月历
const app = getApp();
const sched = require("../../utils/schedule.js");
const fmt = require("../../utils/format.js");
const holidays = require("../../utils/holidays.js");
const theme = require("../../utils/theme.js");

// 月历双击快速请假的类型选项（与设置页下拉同源，无"调休"）
const QUICK_LEAVE_TYPES = [
  { v: "年假", t: "🌴 年假" },
  { v: "事假", t: "📌 事假" },
  { v: "病假", t: "🤒 病假" },
  { v: "婚假", t: "💍 婚假" },
  { v: "产假", t: "👶 产假" },
  { v: "丧假", t: "🕯️ 丧假" },
  { v: "其他", t: "✏️ 其他" },
];

Page({
  data: {
    cfg: null,
    ventOpen: false,
    // 月历双击快速请假弹窗
    qlOpen: false,
    qlDate: "",
    qlWeek: "",
    qlAllDay: true,
    qlStart: "08:30",
    qlEnd: "12:00",
    qlTypes: QUICK_LEAVE_TYPES,
    qlEntries: [],
    pageBg: "linear-gradient(180deg,#667eea,#764ba2)",
    cssVars: "",
    navBg: "#667eea", navFront: "#ffffff", topInset: 88,
    hh: "00", mm: "00", ss: "00", ms: ".00",
    statusClass: "before", statusText: "计算中…",
    progressLabel: "🕰️ 今日工作进度", dayPctText: "0.0", dayEarned: "",
    weekLabel: "📅 本周工作进度", weekPctText: "0.0", weekEarned: "",
    showMonth: false, monthLabel: "🗓️ 本月工作进度", monthPctText: "0.0", monthEarned: "",
    subInfo: "",
  },

  onLoad() {
    this.lastTargetEpoch = 0;
    this.setData({ cfg: app.getConfig() });
    this.applyTheme(theme.loadBgIdx());
    // 自定义导航栏：按状态栏 + 胶囊按钮高度计算顶部留白
    try {
      const sys = wx.getWindowInfo();
      const menu = wx.getMenuButtonBoundingClientRect();
      const sb = sys.statusBarHeight || 20;
      const navH = (menu.top - sb) * 2 + menu.height;
      this.setData({ topInset: sb + navH });
    } catch (e) {}
    this.slowTimer = setInterval(this.update.bind(this), 1000);
    this.msTimer = setInterval(this.tickMs.bind(this), 50);
    this.update();
  },

  // 应用背景渐变 + 同步状态栏颜色（浅色主题自动用黑字）
  applyTheme(idx) {
    const p = theme.BG_PALETTES[idx] || theme.BG_PALETTES[0];
    const lightBg = theme.textColorFor(idx) === "#000000"; // 浅色背景需用深色文字
    const text = lightBg ? "#24243a" : "#ffffff";
    const textDim = lightBg ? "rgba(40,40,64,0.72)" : "rgba(255,255,255,0.8)";
    this.setData({
      pageBg: theme.gradient(idx),
      cssVars: "color:" + text + ";--text:" + text + ";--text-dim:" + textDim + ";",
      navBg: p[0],
      navFront: theme.textColorFor(idx),
    });
  },

  onShow() {
    // 页面重新可见：重启计时器（onHide 时已停，首次进入由 onLoad 后的 onShow 兜底）
    if (!this.slowTimer) {
      this.slowTimer = setInterval(this.update.bind(this), 1000);
      this.msTimer = setInterval(this.tickMs.bind(this), 50);
    }
    this.setData({ cfg: app.getConfig() });
    this.applyTheme(theme.loadBgIdx());
    this.update();
    const cal = this.selectComponent("#cal");
    if (cal) cal.refresh();
  },

  onHide() {
    // 页面不可见（navigateTo 到设置/导入页）时停表：
    // 小程序所有页面共享一个 JS 线程，隐藏页上每秒 update + 每 50ms setData 纯浪费
    this.stopTimers();
  },

  onUnload() {
    this.stopTimers();
  },

  stopTimers() {
    if (this.slowTimer) { clearInterval(this.slowTimer); this.slowTimer = null; }
    if (this.msTimer) { clearInterval(this.msTimer); this.msTimer = null; }
  },

  // 每秒刷新状态 / 进度 / 工资
  update() {
    const cfg = app.getConfig();
    const now = new Date();
    const todayIdx = now.getDay();
    // 有效排班：按时段请假已作为附加休息段注入（"假中"状态与休息共用一套逻辑，工时自动扣除）
    const today = sched.effectiveDaySchedule(cfg, now);
    const todayIsWork = sched.isWorkDay(cfg, now);
    let statusClass = "before", statusText = "", targetMs = 0, subInfo = "";

    if (!todayIsWork) {
      const ov = sched.getHolidayOverride(cfg, now);
      const isLegal = ov === "holiday";
      const lvReason = sched.normalizeLeaveReason(sched.leaveReasonOf(cfg, now));
      statusClass = "holiday";
      statusText = isLegal
        ? "🎊 今天是法定节假日，" + sched.WEEK_FULL[todayIdx] + "休息！"
        : lvReason
          ? sched.isPaidLeaveDay(cfg, now)
            ? "🌴 " + lvReason + "中，带薪休息，工资不受影响"
            : "🍃 " + lvReason + "中"
          : "🎉 今天是" + sched.WEEK_FULL[todayIdx] + "，休息日！";
      const next = sched.findNextWorkStart(cfg, now);
      subInfo = next
        ? "距下一个工作日（" + sched.WEEK_FULL[next.idx] + "）上班还有 <b style=\"color:#ffd166\">" + fmt.humanDuration(next.start - now) + "</b>"
        : "近期没有工作日了 😎";
    } else {
      const base = now.getTime();
      const ws = sched.toDate(today.workStart, base);
      const we = sched.toDate(today.workEnd, base);
      const brk = sched.currentBreak(today, now);
      const isMakeup = sched.getHolidayOverride(cfg, now) === "workday";
      const makeupSuffix = isMakeup ? "（调休上班）" : "";
      if (now < ws) {
        statusClass = "before"; statusText = "😴 还没到上班时间" + makeupSuffix; targetMs = we - now;
        subInfo = "距离上班还有 <b style=\"color:#ffd166\">" + fmt.humanDuration(ws - now) + "</b>";
      } else if (now >= we) {
        statusClass = "off"; statusText = "🎉 已经下班啦，好好休息！"; targetMs = 0;
        const next = sched.findNextWorkStart(cfg, now);
        subInfo = next
          ? "距下一个工作日（" + sched.WEEK_FULL[next.idx] + "）上班还有 <b style=\"color:#ffd166\">" + fmt.humanDuration(next.start - now) + "</b>"
          : "近期没有工作日了 😎";
      } else if (brk) {
        statusClass = "break"; const bName = brk.name || "休息"; statusText = "🍵 " + bName + "中，放松一下吧"; targetMs = we - now;
        const be = sched.toDate(brk.end, base);
        subInfo = "距离" + bName + "结束 <b style=\"color:#ffd166\">" + fmt.humanDuration(be - now) + "</b> · 距下班 <b style=\"color:#ffd166\">" + fmt.humanDuration(we - now) + "</b>";
      } else {
        statusClass = "working"; statusText = "💼 努力工作中…" + (isMakeup ? "（调休）" : ""); targetMs = we - now;
        const nb = sched.findNextBreak(today, now);
        if (nb) statusText += " ｜ ☕ 距" + nb.name + " " + fmt.humanDuration(nb.time - now);
      }
    }
    this.lastTargetEpoch = targetMs > 0 ? now.getTime() + targetMs : 0;

    // —— 今日进度 ——（纯工时口径：所有请假日一律 0，带薪假只体现在工资）
    const totalWork = todayIsWork ? sched.totalWorkMs(today) : 0;
    let doneMs = 0;
    if (todayIsWork) { const ws2 = sched.toDate(today.workStart, now.getTime()); if (now > ws2) doneMs = sched.netWorkMs(today, ws2, now); }
    const dayPct = totalWork > 0 ? Math.min(100, Math.max(0, (doneMs / totalWork) * 100)) : 0;
    // 倒计时未结束（仍有剩余净工时）时封顶 99.9%，倒计时结束才显示 100%（与安卓/网页端一致）
    const dayPctShow = totalWork > 0 ? (totalWork - doneMs > 0 ? Math.min(dayPct, 99.9) : 100) : 0;
    let progressLabel = "🕰️ 今日";
    if (todayIsWork) {
      const wStart = sched.toDate(today.workStart, now.getTime()), wEnd = sched.toDate(today.workEnd, now.getTime());
      if (now >= wStart && now < wEnd) { const rem = Math.max(0, totalWork - doneMs); if (rem > 0) progressLabel = "🕰️ 今日 · 还需🦬 " + fmt.humanDuration(rem); }
    }

    // —— 本周进度 ——
    const week = sched.computeWeekProgress(cfg, now);
    let weekLabel = "⌛️ 本周";
    const wr = week.totalMs - week.doneMs;
    if (wr > 0) weekLabel = "⌛️ 本周 · 还需🏇 " + fmt.humanDuration(wr);

    // —— 本月进度 ——
    const showMonth = !!cfg.showMonthProgress;
    let monthPct = 0, monthLabel = "🗓️ 本月", monthTotal = 0, monthDone = 0;
    if (showMonth) {
      const month = sched.computeMonthProgress(cfg, now);
      monthPct = month.pct; monthTotal = month.totalMs; monthDone = month.doneMs;
      const mr = monthTotal - monthDone;
      if (mr > 0) monthLabel = "🗓️ 本月 · 还需🫏 " + fmt.humanDuration(mr);
    }

    // —— 工资 ——（工资口径：带薪假照常计入费率与已赚，不影响当月工资）
    const showMoney = !!cfg.salaryEnabled && cfg.monthlySalary > 0;
    const monthPaid = showMoney ? sched.computeMonthPaidTime(cfg, now) : { totalMs: 0, doneMs: 0 };
    // 费率分母用"标准月工时"（分母不随请假浮动）：事假不累计已赚 → 月底扣款；带薪假照常累计 → 月底拿满
    const monthStd = showMoney ? sched.computeMonthStandardTime(cfg, now) : 0;
    const rate = showMoney && monthStd > 0 ? cfg.monthlySalary / (monthStd / 3600000) : 0;
    let dayDoneMs = 0;
    // 今日已赚（工资口径：只扣不带薪假段，带薪时段照常累计）
    {
      const paidToday = sched.isPaidLeaveDay(cfg, now);
      const todayMoney = sched.effectiveDaySchedule(cfg, now, true);
      if (todayMoney && (todayIsWork || paidToday)) { const ws2 = sched.toDate(todayMoney.workStart, now.getTime()); if (now > ws2) dayDoneMs = sched.netWorkMs(todayMoney, ws2, now); }
    }
    const dayEarned = showMoney && dayDoneMs > 0 && rate > 0 ? "¥" + fmt.formatMoney((dayDoneMs / 3600000) * rate) : "";
    // 周/月已赚 = 确定到手工时（带薪总工时 − 未来仍需上班工时）：带薪假（含未来）立即视为已赚
    const weekPaid = showMoney ? sched.computeWeekPaidTime(cfg, now) : { totalMs: 0, futureWorkMs: 0 };
    const weekDoneMs = showMoney ? Math.max(0, weekPaid.totalMs - weekPaid.futureWorkMs) : 0;
    const weekEarned = showMoney && weekDoneMs > 0 && rate > 0 ? "¥" + fmt.formatMoney((weekDoneMs / 3600000) * rate) : "";
    let monthEarned = "";
    if (showMoney && showMonth && rate > 0) {
      const earnedMs = Math.max(0, monthPaid.totalMs - monthPaid.futureWorkMs);
      if (earnedMs > 0) monthEarned = "¥" + fmt.formatMoney((earnedMs / 3600000) * rate);
    }

    this.setData({
      statusClass, statusText, subInfo,
      progressLabel, dayPctText: dayPctShow.toFixed(1), dayEarned,
      weekLabel, weekPctText: week.pct.toFixed(1), weekEarned,
      showMonth, monthLabel, monthPctText: monthPct.toFixed(1), monthEarned,
    });
    this.tickMs();
  },

  // 高频刷新倒计时数字（含厘秒）
  tickMs() {
    const now = Date.now();
    let ms = this.lastTargetEpoch > 0 ? this.lastTargetEpoch - now : 0;
    if (ms < 0) ms = 0;
    const d = fmt.fmtDur(ms);
    this.setData({ hh: fmt.pad(d.h), mm: fmt.pad(d.m), ss: fmt.pad(d.s), ms: "." + fmt.pad(Math.floor((ms % 1000) / 10)) });
  },

  goSettings() { wx.navigateTo({ url: "../settings/settings" }); },
  toggleVent() { this.setData({ ventOpen: !this.data.ventOpen }); },
  // 解压「变色」切换主页背景 + 状态栏颜色
  onPageBgChange(e) { this.applyTheme(e.detail.idx); },

  // ---------- 月历双击快速请假 ----------
  onQuickLeave(e) {
    const dk = e.detail.dateKey;
    const d = new Date(dk + "T00:00:00");
    const cfg = app.getConfig();
    const infos = cfg.leaves && cfg.leaves.hasOwnProperty(dk) ? sched.parseLeaveValue(cfg.leaves[dk]) : [];
    this.setData({
      qlOpen: true,
      qlDate: dk,
      qlWeek: sched.WEEK_FULL[d.getDay()],
      qlAllDay: true,
      qlStart: "08:30",
      qlEnd: "12:00",
      qlEntries: infos.map(function (l) {
        return { text: l.reason + (l.start ? " " + l.start + "-" + l.end : "") };
      }),
    });
  },
  qlAllDayChange(e) { this.setData({ qlAllDay: e.detail.value }); },
  qlStartChange(e) { this.setData({ qlStart: e.detail.value }); },
  qlEndChange(e) { this.setData({ qlEnd: e.detail.value }); },
  qlPick(e) {
    const reason = e.currentTarget.dataset.v;
    const dk = this.data.qlDate;
    let start = null, end = null;
    if (!this.data.qlAllDay) {
      start = this.data.qlStart;
      end = this.data.qlEnd;
    }
    const cfg = app.getConfig();
    const r = sched.addLeaveEntry(cfg, dk, reason, start, end);
    if (!r.ok) { wx.showToast({ title: r.err, icon: "none" }); return; }
    app.saveConfig(cfg);
    this.afterLeaveChange();
    wx.showToast({ title: "已添加请假 " + dk + "（" + r.text + "）", icon: "none" });
  },
  qlDelete(e) {
    const idx = e.currentTarget.dataset.idx;
    const cfg = app.getConfig();
    sched.removeLeaveEntry(cfg, this.data.qlDate, idx);
    app.saveConfig(cfg);
    this.afterLeaveChange();
    wx.showToast({ title: "已删除请假 " + this.data.qlDate, icon: "none" });
  },
  afterLeaveChange() {
    // 配置是共享引用，直接 setData 同一引用不触发组件 observer，需显式 refresh
    this.setData({ cfg: app.getConfig() });
    this.update();
    const cal = this.selectComponent("#cal");
    if (cal) cal.refresh();
    this.setData({ qlOpen: false });
  },
  qlClose() { this.setData({ qlOpen: false }); },
  noop() {},

  // ---------- 月历长按：单日调班/加班 ----------
  onDayOverride(e) {
    const dk = e.detail.dateKey;
    const d = new Date(dk + "T00:00:00");
    const cfg = app.getConfig();
    const cur = sched.dayOverrideOf(cfg, d);
    const tmpl = sched.daySchedule(cfg, d) || { workStart: "09:00", workEnd: "18:00", breaks: [] };
    this.setData({
      doOpen: true,
      doDate: dk,
      doWeek: sched.WEEK_FULL[d.getDay()],
      doStart: cur && !cur.off ? cur.workStart : tmpl.workStart,
      doEnd: cur && !cur.off ? cur.workEnd : tmpl.workEnd,
      doHas: !!cur,
      doTmplBreaks: (tmpl.breaks || []).map(function (b) { return { name: b.name, start: b.start, end: b.end }; }),
    });
  },
  doStartChange(e) { this.setData({ doStart: e.detail.value }); },
  doEndChange(e) { this.setData({ doEnd: e.detail.value }); },
  doPick(e) {
    const act = e.currentTarget.dataset.act;
    const dk = this.data.doDate;
    const cfg = app.getConfig();
    let msg;
    if (act === "off") {
      if (!cfg.dayOverrides) cfg.dayOverrides = {};
      cfg.dayOverrides[dk] = { off: true };
      msg = "已设置 " + dk + " 调休休息";
    } else if (act === "clear") {
      if (cfg.dayOverrides) delete cfg.dayOverrides[dk];
      msg = "已清除 " + dk + " 的调班";
    } else {
      const ws = this.data.doStart, we = this.data.doEnd;
      if (ws >= we) { wx.showToast({ title: "结束时间需晚于开始时间", icon: "none" }); return; }
      if (!cfg.dayOverrides) cfg.dayOverrides = {};
      cfg.dayOverrides[dk] = { workStart: ws, workEnd: we, breaks: this.data.doTmplBreaks || [] };
      msg = "已设置 " + dk + " " + ws + "-" + we;
    }
    app.saveConfig(cfg);
    this.afterLeaveChange();
    this.setData({ doOpen: false });
    wx.showToast({ title: msg, icon: "none" });
  },
  doClose() { this.setData({ doOpen: false }); },

  // ---------- 📊 统计（跟随月历当前显示月份） ----------
  onStats(e) {
    const cfg = app.getConfig();
    const now = new Date();
    const y = e.detail.year, m = e.detail.month;
    const ms = sched.computeMonthStats(cfg, now, y, m);
    const ys = sched.computeYearStats(cfg, now);
    const fmtH = (v) => (v / 3600000).toFixed(1) + "h";
    const leaveTxt = (by) => {
      const ks = Object.keys(by);
      return ks.length ? ks.map((k) => k + " " + by[k] + " 天").join(" · ") : "0 天";
    };
    const rows = [
      ["📅 应上工作日", ms.workDays + " 天"],
      ["✅ 已完成工时", fmtH(ms.doneMs) + " / " + fmtH(ms.totalMs)],
      ["📝 全天请假", leaveTxt(ms.leaveByReason)],
      ["⏰ 调班上班", ms.overtimeDays + " 天"],
      ["😴 调休休息", ms.offDays + " 天"],
    ];
    if (cfg.salaryEnabled && cfg.monthlySalary > 0) {
      const days = new Date(y, m + 1, 0).getDate();
      const moP = sched.rangeTime(cfg, now, new Date(y, m, 1), days, true);
      const moStd = sched.computeMonthStandardTime(cfg, new Date(y, m, 15));
      if (moStd > 0) {
        const earned = Math.max(0, moP.totalMs - moP.futureWorkMs) * cfg.monthlySalary / moStd;
        rows.push(["💰 本月已赚（确定到手）", "¥" + (earned >= 100000 ? Math.round(earned) : earned.toFixed(2))]);
      }
    }
    const yrows = [
      ["应上 / 已过工作日", ys.workDays + " / " + ys.pastWorkDays + " 天"],
      ["已完成工时", fmtH(ys.doneMs) + " / " + fmtH(ys.totalMs)],
      ["全年请假", leaveTxt(ys.leaveByReason)],
      ["调班上班 / 调休休息", ys.overtimeDays + " / " + ys.offDays + " 天"],
    ];
    this.setData({ stOpen: true, stTitle: y + "年" + (m + 1) + "月 统计", stRows: rows, stYearRows: yrows });
  },
  stClose() { this.setData({ stOpen: false }); },
});
