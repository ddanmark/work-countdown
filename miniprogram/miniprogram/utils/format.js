/* ============================================================
   format.js — 纯格式化工具
   ============================================================ */

function pad(n) {
  return String(n).padStart(2, "0");
}

// 毫秒 -> { h, m, s }
function fmtDur(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  return {
    h: Math.floor(totalSec / 3600),
    m: Math.floor((totalSec % 3600) / 60),
    s: totalSec % 60,
  };
}

// 毫秒 -> 中文时长（如 8小时30分钟）
function humanDuration(ms) {
  const d = fmtDur(ms);
  if (d.h > 0) return d.h + "小时" + (d.m > 0 ? d.m + "分钟" : "");
  if (d.m > 0) return d.m + "分钟";
  return d.s + "秒";
}

// 金额格式化
function formatMoney(v) {
  if (v >= 100000) return Math.round(v).toLocaleString("zh-CN");
  return v.toFixed(2);
}

module.exports = { pad, fmtDur, humanDuration, formatMoney };
