/* ============================================================
   theme.js — 首页背景配色（供主页与解压组件共享）
   变色特效会切换首页背景渐变，并持久化到本地。
   ============================================================ */
const BG_KEY = "work-countdown-bg";

const BG_PALETTES = [
  ["#667eea", "#764ba2"], ["#f093fb", "#f5576c"], ["#4facfe", "#00f2fe"],
  ["#43e97b", "#38f9d7"], ["#fa709a", "#fee140"], ["#30cfd0", "#330867"],
  ["#a8edea", "#fed6e3"], ["#ff9a9e", "#fecfef"], ["#5ee7df", "#b490ca"],
  ["#f6d365", "#fda085"], ["#0ba360", "#3cba92"], ["#ee9ca7", "#ffdde1"],
];

// 渐变方向用 180deg（自上而下）：顶部恒为 p[0]，与导航条颜色一致，无割裂接缝
function gradient(idx) {
  const p = BG_PALETTES[idx] || BG_PALETTES[0];
  return "linear-gradient(180deg," + p[0] + "," + p[1] + ")";
}

// 按顶部色亮度推导状态栏/标题文字颜色（frontColor 仅支持 #ffffff / #000000）
function _isLight(hex) {
  const c = String(hex).replace("#", "");
  const r = parseInt(c.substr(0, 2), 16);
  const g = parseInt(c.substr(2, 2), 16);
  const b = parseInt(c.substr(4, 2), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 170;
}
function textColorFor(idx) {
  const p = BG_PALETTES[idx] || BG_PALETTES[0];
  return _isLight(p[0]) ? "#000000" : "#ffffff";
}

function loadBgIdx() {
  try {
    const i = parseInt(wx.getStorageSync(BG_KEY));
    if (!isNaN(i) && i >= 0 && i < BG_PALETTES.length) return i;
  } catch (e) {}
  return 0;
}

function saveBgIdx(idx) {
  try { wx.setStorageSync(BG_KEY, String(idx)); } catch (e) {}
}

module.exports = { BG_KEY, BG_PALETTES, gradient, textColorFor, loadBgIdx, saveBgIdx };
