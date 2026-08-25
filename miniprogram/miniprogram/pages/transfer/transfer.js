// transfer.js — 配置导入导出（剪贴板 / 文本）
const app = getApp();
const config = require("../../utils/config.js");
const LZ = require("../../utils/lz-string.js");

Page({
  data: {
    mode: "export",
    exportText: "",
    showPaste: false,
    pasteText: "",
  },

  onLoad(opts) {
    this.cfg = app.getConfig();
    if (opts && opts.action === "import") this.setData({ mode: "import" });
    this.computeExport();
  },

  switchMode(e) {
    this.setData({ mode: e.currentTarget.dataset.mode });
  },

  // —— 导出：压缩配置文本 ——
  computeExport() {
    const compact = config.compactConfig(this.cfg);
    const json = JSON.stringify(compact);
    const text = "Z1:" + LZ.compressToEncodedURIComponent(json);
    this.setData({ exportText: text });
  },

  copyExport() {
    wx.setClipboardData({
      data: this.data.exportText,
      success: () => wx.showToast({ title: "✅ 已复制配置文本", icon: "none" }),
    });
  },

  importFromClipboard() {
    wx.getClipboardData({
      success: (res) => {
        const v = (res.data || "").trim();
        if (!v) { wx.showToast({ title: "剪贴板为空", icon: "none" }); return; }
        this.applyImportedConfig(v);
      },
    });
  },

  showPasteBox() { this.setData({ showPaste: true, pasteText: "" }); },
  pasteInput(e) { this.setData({ pasteText: e.detail.value }); },
  confirmPaste() {
    const v = (this.data.pasteText || "").trim();
    if (!v) { wx.showToast({ title: "请先粘贴配置文本", icon: "none" }); return; }
    this.applyImportedConfig(v);
  },

  // —— 解析并写入配置（兼容明文 JSON / 紧凑格式 / Z1: 压缩）——
  applyImportedConfig(str) {
    try {
      str = str.replace(/^\uFEFF/, "").trim();
      if (str.indexOf("Z1:") === 0) {
        const dec = LZ.decompressFromEncodedURIComponent(str.slice(3));
        if (!dec) throw new Error("解压失败");
        str = dec;
      }
      const parsed = JSON.parse(str);
      let validated;
      if (parsed.schedules) validated = config.parseConfig(parsed);
      else if (parsed.s) validated = config.parseConfig(config.expandConfig(parsed));
      else throw new Error("配置格式无效");
      if (!validated.schedules) throw new Error("配置格式无效");

      // 就地写入共享 cfg 引用（保证设置页/主页即时一致）
      const cfg = app.getConfig();
      cfg.schedules = validated.schedules;
      cfg.mode = validated.mode;
      cfg.bigSmallAnchor = validated.bigSmallAnchor;
      cfg.holidays = validated.holidays || {};
      cfg.deletedBuiltinHolidays = validated.deletedBuiltinHolidays || {};
      cfg.leaves = validated.leaves || {};
      cfg.showMonthProgress = !!validated.showMonthProgress;
      cfg.salaryEnabled = !!validated.salaryEnabled;
      cfg.monthlySalary = validated.monthlySalary || 0;
      app.saveConfig(cfg);

      wx.showToast({ title: "✅ 配置导入成功", icon: "none" });
      setTimeout(() => wx.navigateBack(), 900);
    } catch (e) {
      wx.showToast({ title: "❌ 配置无效，请检查文本", icon: "none" });
    }
  },
});
