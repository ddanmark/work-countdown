/* ============================================================
   calendar 组件 — 首页月历
   单元格颜色体现：上班(按工时渐变)/法定假(休)/调休(班)/请假(假)/休息
   ============================================================ */
const sched = require("../../utils/schedule.js");
const WEEK_ORDER = sched.WEEK_ORDER;
const WEEK_LABEL = sched.WEEK_LABEL;
const WEEK_FULL = sched.WEEK_FULL;

Component({
  options: { addGlobalClass: true, multipleSlots: false },
  properties: {
    cfg: { type: Object, value: null, observer() { this.build(); } },
  },

  data: {
    weekLabels: [],
    monthLabel: "",
    cells: [],
  },

  lifetimes: {
    attached() {
      const t = new Date();
      this.calYear = t.getFullYear();
      this.calMonth = t.getMonth();
      this.setData({ weekLabels: WEEK_ORDER.map(function (w) { return WEEK_LABEL[w]; }) });
    },
    ready() { this.build(); },
  },

  methods: {
    // 供父页面在 onShow / 配置变更后调用
    refresh() { this.build(); },

    build() {
      const cfg = this.data.cfg;
      if (!cfg) return;
      const y = this.calYear, m = this.calMonth;
      const cells = this.buildCells(cfg, y, m);
      this.setData({ monthLabel: y + "年" + (m + 1) + "月", cells: cells });
    },

    buildCells(cfg, calYear, calMonth) {
      const cells = [];
      const first = new Date(calYear, calMonth, 1);
      const firstDow = first.getDay();
      const startOffset = (firstDow === 0 ? 6 : firstDow - 1); // 周一为首
      const baseTime = new Date(calYear, calMonth, 1 - startOffset).getTime();
      const todayKey = sched.ymd(new Date());
      for (let i = 0; i < 42; i++) {
        const d = new Date(baseTime + i * 86400000);
        const dk = sched.ymd(d);
        const inMonth = d.getMonth() === calMonth;
        const override = sched.getHolidayOverride(cfg, d);
        const lvs = sched.leaveInfosOf(cfg, d);
        const lvFull = !!(lvs && lvs.length && lvs.some(function (l) { return !l.start; }));
        const lvText = lvs && lvs.length
          ? lvs.map(function (l) { return l.start ? l.reason + " " + l.start + "-" + l.end : l.reason; }).join(" · ")
          : "";
        const work = sched.isWorkDay(cfg, d);
        let cls = "cal-cell";
        if (!inMonth) cls += " outside";
        let badge = "", badgeType = "", hoursText = "", style = "";
        let detail = WEEK_FULL[d.getDay()];

        if (lvFull) {
          // 全天假：整日休息
          cls += " leave"; badge = "假"; badgeType = "leave";
          detail += " · 请假（" + lvText + "）";
        } else if (override === "holiday") {
          cls += " holiday"; badge = "休"; badgeType = "holiday";
          detail += " · 法定假日";
        } else if (override === "workday") {
          cls += " makeup"; badge = "班"; badgeType = "makeup";
          const h = sched.totalWorkMs(sched.effectiveDaySchedule(cfg, d)) / 3600000;
          detail += " · 调休上班 约" + h.toFixed(1) + "h";
          if (lvs) { badge = "假"; badgeType = "leave"; detail += " · 请假（" + lvText + "）"; }
        } else if (work) {
          cls += " work";
          const hrs = sched.totalWorkMs(sched.effectiveDaySchedule(cfg, d)) / 3600000;
          const alpha = Math.max(0.18, Math.min(0.55, hrs / 10));
          if (dk === todayKey) style = "color:#fff;background:linear-gradient(135deg,rgba(255,209,102,0.8),rgba(183,128,217,0.8));";
          else if (dk < todayKey) style = "color:#fff;background:rgba(255,209,102," + alpha.toFixed(3) + ");";
          else style = "background:rgba(183,128,217," + alpha.toFixed(3) + ");";
          hoursText = hrs.toFixed(1) + "h";
          detail += " · 上班 约" + hrs.toFixed(1) + "h";
          if (lvs) { badge = "假"; badgeType = "leave"; detail += " · 请假（" + lvText + "）"; }
        } else {
          cls += " rest"; detail += " · 休息";
        }
        if (dk === todayKey) { cls += " today"; detail += " · 今天"; }
        cells.push({ dayText: String(d.getDate()), dateKey: dk, inMonth: inMonth, cls: cls, style: style, badge: badge, badgeType: badgeType, hoursText: hoursText, detail: detail });
      }
      return cells;
    },

    prevMonth() { this.calMonth--; if (this.calMonth < 0) { this.calMonth = 11; this.calYear--; } this.build(); },
    nextMonth() { this.calMonth++; if (this.calMonth > 11) { this.calMonth = 0; this.calYear++; } this.build(); },

    onCellTap(e) {
      const i = e.currentTarget.dataset.i;
      const cell = this.data.cells[i];
      if (!cell || !cell.inMonth) return;
      // 双击（400ms 内连点同一格）：快速请假，抛给父页面；单击仍显示当天详情
      const t = Date.now();
      if (this._lastTapKey === cell.dateKey && t - (this._lastTapTime || 0) < 400) {
        this._lastTapKey = null;
        this._lastTapTime = 0;
        this.triggerEvent("quickleave", { dateKey: cell.dateKey });
      } else {
        this._lastTapKey = cell.dateKey;
        this._lastTapTime = t;
        wx.showToast({ title: cell.dateKey + " " + cell.detail, icon: "none", duration: 1600 });
      }
    },
  },
});
