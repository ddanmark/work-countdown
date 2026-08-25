// app.js — 下班了吗 ⏰ 小程序入口
const config = require('./utils/config.js');

App({
  globalData: {
    cfg: null, // 全局配置缓存（各页面共享同一份引用，编辑后统一保存）
  },

  onLaunch() {
    this.globalData.cfg = config.load();
  },

  // 读取当前配置（各页面通过 app.getConfig() 拿到同一份引用）
  getConfig() {
    if (!this.globalData.cfg) this.globalData.cfg = config.load();
    return this.globalData.cfg;
  },

  // 保存配置：写入全局缓存 + 持久化到本地存储
  saveConfig(cfg) {
    this.globalData.cfg = cfg;
    config.save(cfg);
  },
});
