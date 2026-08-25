/* ============================================================
   qrcode.js — 二维码生成（封装 qrcode-lib.js 的矩阵核心，
   提供绘制到小程序 Canvas 2D 上下文的便捷方法）
   ============================================================ */
const qrcode = require("./qrcode-lib.js");

/**
 * 生成二维码模块矩阵
 * @param {string} text        编码内容
 * @param {string} [ecl='M']   纠错级别 'L' | 'M' | 'Q' | 'H'
 * @returns {{ size:number, modules:boolean[][] }}
 */
function encodeModules(text, ecl) {
  const qr = qrcode(0, ecl || "M"); // typeNumber=0 自动按数据量选型
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const modules = [];
  for (let r = 0; r < count; r++) {
    const row = [];
    for (let c = 0; c < count; c++) row.push(qr.isDark(r, c));
    modules.push(row);
  }
  return { size: count, modules };
}

/**
 * 把二维码绘制到 Canvas 2D 上下文（居中、含留白）
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} canvasSize      画布逻辑像素边长
 * @param {string} text
 * @param {object} [opts] { ecl, margin, colorDark, colorLight }
 */
function drawQRToCanvas(ctx, canvasSize, text, opts) {
  opts = opts || {};
  const ecl = opts.ecl || "M";
  const margin = opts.margin != null ? opts.margin : 2;
  const colorDark = opts.colorDark || "#1a1530";
  const colorLight = opts.colorLight || "#ffffff";

  const { size, modules } = encodeModules(text, ecl);
  const total = size + margin * 2;
  const cell = canvasSize / total;

  // 背景
  ctx.fillStyle = colorLight;
  ctx.fillRect(0, 0, canvasSize, canvasSize);

  // 模块
  ctx.fillStyle = colorDark;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) {
        const x = (c + margin) * cell;
        const y = (r + margin) * cell;
        // 向上取整避免子像素留缝
        ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(cell), Math.ceil(cell));
      }
    }
  }
}

module.exports = { encodeModules, drawQRToCanvas };
