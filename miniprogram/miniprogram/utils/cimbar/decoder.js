/* ============================================================
   decoder.js — 「扫码取文件」小程序端解码器

   上游：libcimbar（https://github.com/sz3/libcimbar，MPL-2.0）
   把官方 wasm 解码器（cimbar_glue.js + cimbar_js.wasm.br）接到微信小程序上：
     · wasm 用 WXWebAssembly.instantiate 加载（走 Module.instantiateWasm 钩子，
       绕开 glue 里的 fetch/XHR 逻辑）
     · 摄像头帧由页面用 camera 组件 + onCameraFrame 取到 RGBA，喂给 feed()
     · 解码在主线程同步执行（小程序 Worker + WXWebAssembly 不确定性较大，
       且单帧像素还要跨线程拷贝，这里先用主线程，用节流控制频率）

   与网页端 cimbar/cimbar-recv.js 是同一套链路：
     扫图取块 → 喷泉码重组 → zstd 解压 → 还原文件
   ============================================================ */
const info = require("./version.js");

// WXWebAssembly.instantiate 的第一个参数是「代码包内路径」，对前导斜杠的容忍度
// 各基础库不一致，这里按顺序试，第一个能用的胜出。
const WASM_CANDIDATES = ["utils/cimbar/cimbar_js.wasm.br", "/utils/cimbar/cimbar_js.wasm.br"];

// RGBA 像素格式的编号，与上游 cimbard_scan_extract_decode 的约定一致
const FMT_RGBA = 4;
const ERR_SIZE = 1024;

let Module = null;
let readyPromise = null;
let ready = false;
let currentMode = 0;

const bufs = { img: null, fountain: null, err: null, decomp: null };

// ---------------------------------------------------------------- 工具

/** 自带 UTF-8 解码，不依赖 TextDecoder（小程序里不一定有） */
function utf8Decode(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++];
    if (b < 0x80) {
      out += String.fromCharCode(b);
    } else if (b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
    } else if (b < 0xf0) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    } else {
      const cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      const u = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (u >> 10), 0xdc00 + (u & 0x3ff));
    }
  }
  return out;
}

/** wasm 内存可能增长导致视图失效，每次取用前校验一次 */
function view(name) {
  const b = bufs[name];
  if (!b) return null;
  if (b.buffer !== Module.HEAPU8.buffer) {
    bufs[name] = new Uint8Array(Module.HEAPU8.buffer, b.byteOffset, b.byteLength);
  }
  return bufs[name];
}

/** 拿到一块至少 size 字节的常驻缓冲 */
function ensure(name, size) {
  const cur = bufs[name];
  if (cur && cur.byteLength >= size) return view(name);
  if (cur) Module._free(cur.byteOffset);
  const ptr = Module._malloc(size);
  bufs[name] = new Uint8Array(Module.HEAPU8.buffer, ptr, size);
  return bufs[name];
}

function toId(res) {
  // cimbard_fountain_decode 返回 int64；小程序里可能拿到 BigInt
  if (typeof res === "bigint") {
    return typeof BigInt !== "undefined" ? Number(BigInt.asUintN(32, res)) : Number(res);
  }
  return Number(res) >>> 0;
}

// ---------------------------------------------------------------- 初始化

function tryWasm(imports) {
  return new Promise((resolve, reject) => {
    let i = 0;
    const errors = [];
    const next = () => {
      if (i >= WASM_CANDIDATES.length) {
        return reject(
          new Error("加载 wasm 失败（试过 " + WASM_CANDIDATES.join(" / ") + "）：" + errors.join(" ｜ "))
        );
      }
      const p = WASM_CANDIDATES[i++];
      let pr;
      try {
        pr = WXWebAssembly.instantiate(p, imports);
      } catch (e) {
        errors.push(p + " → " + (e && e.message ? e.message : e));
        return next();
      }
      Promise.resolve(pr).then(resolve, (e) => {
        errors.push(p + " → " + (e && e.message ? e.message : e));
        next();
      });
    };
    next();
  });
}

function init() {
  if (readyPromise) return readyPromise;
  readyPromise = new Promise((resolve, reject) => {
    if (typeof WXWebAssembly === "undefined") {
      return reject(new Error("当前微信版本不支持 WXWebAssembly（需基础库 ≥ 2.13.0，建议升级微信）"));
    }
    // glue 里 _emscripten_get_now 会用 performance.now()，小程序没有这个全局对象
    if (typeof globalThis !== "undefined" && typeof globalThis.performance === "undefined") {
      globalThis.performance = { now: () => Date.now() };
    }

    const M = {};
    M.onRuntimeInitialized = () => {
      ready = true;
      resolve(M);
    };
    M.onAbort = (what) => reject(new Error("解码器初始化失败：" + what));
    M.print = () => {};
    M.printErr = (msg) => {
      if (typeof console !== "undefined" && console.warn) console.warn("[cimbar] " + msg);
    };
    // 关键：由我们提供 wasm 实例，glue 就不会去 fetch
    M.instantiateWasm = (imports, successCallback) => {
      tryWasm(imports).then(
        (res) => successCallback(res.instance, res.module),
        reject
      );
      return {};
    };

    Module = M;
    try {
      require("./cimbar_glue.js")(M);
    } catch (e) {
      reject(new Error("解码器加载异常：" + (e && e.message ? e.message : e)));
    }
  });
  return readyPromise;
}

// ---------------------------------------------------------------- 解码

function configure(mode) {
  if (!ready || !mode || mode === currentMode) return;
  Module._cimbard_configure_decode(mode);
  currentMode = mode;
  ensure("fountain", Module._cimbard_get_bufsize());
}

/** 扫一帧：从 RGBA 像素里提取喷泉码数据块 */
function extract(rgba, width, height) {
  const need = width * height * 4;
  const src = rgba instanceof ArrayBuffer ? new Uint8Array(rgba) : rgba;
  if (!src || src.length < need) return { code: -100 };

  const img = ensure("img", need);
  const imgPtr = img.byteOffset;
  img.set(src.subarray(0, need), 0);

  const fb = ensure("fountain", Module._cimbard_get_bufsize());
  const fbPtr = fb.byteOffset;
  const fbLen = fb.byteLength;

  const len = Module._cimbard_scan_extract_decode(imgPtr, width, height, FMT_RGBA, fbPtr, fbLen);
  if (len <= 0) return { code: len };
  // 拷贝出来：wasm 内存随时可能被下一次调用覆盖
  const block = new Uint8Array(Module.HEAPU8.buffer, fbPtr, len).slice();
  return { code: len, block: block };
}

function getReport() {
  const p = ensure("err", ERR_SIZE);
  const len = Module._cimbard_get_report(p.byteOffset, p.byteLength);
  if (len <= 0) return null;
  const text = utf8Decode(new Uint8Array(Module.HEAPU8.buffer, p.byteOffset, len));
  try {
    return JSON.parse(text);
  } catch (e) {
    return text;
  }
}

/** 数据够了：取文件名 → zstd 流式解压 → 返回完整文件 */
function reassemble(id) {
  const p = ensure("err", ERR_SIZE);
  let name = id + ".bin";
  const fnsize = Module._cimbard_get_filename(id, p.byteOffset, p.byteLength);
  if (fnsize < 0) return { error: "文件名读取失败，请重试" };
  if (fnsize > 0) {
    name = utf8Decode(new Uint8Array(Module.HEAPU8.buffer, p.byteOffset, fnsize)) || name;
  }

  const chunkSize = Module._cimbard_get_decompress_bufsize();
  const dp = ensure("decomp", chunkSize);
  const dpPtr = dp.byteOffset;
  const parts = [];
  let total = 0;
  for (let guard = 0; guard < 200000; guard++) {
    const n = Module._cimbard_decompress_read(id, dpPtr, chunkSize);
    if (n <= 0) break;
    const copy = new Uint8Array(Module.HEAPU8.buffer, dpPtr, n).slice();
    parts.push(copy);
    total += copy.length;
  }
  if (total === 0) return { error: "解压结果为空" };

  const out = new Uint8Array(total);
  let off = 0;
  for (let i = 0; i < parts.length; i++) {
    out.set(parts[i], off);
    off += parts[i].length;
  }
  return { name: name, size: total, buffer: out.buffer };
}

/**
 * 喂一帧摄像头画面，返回本次结果
 * @param {ArrayBuffer} rgba  camera 组件 onCameraFrame 给的 RGBA 像素
 * @param {number} width
 * @param {number} height
 * @param {number} mode  编码模式（自动识别时由页面逐帧轮换）
 * @returns {{extracted:boolean, code:number, progress?:number[], message?:string, file?:object}}
 */
function feed(rgba, width, height, mode) {
  if (!ready) return { extracted: false, code: 0, message: "解码器未就绪" };
  if (mode) configure(mode);

  const r = extract(rgba, width, height);
  if (!r.block) return { extracted: false, code: r.code };

  const fb = ensure("fountain", Module._cimbard_get_bufsize());
  fb.set(r.block, 0);
  const res = Module._cimbard_fountain_decode(fb.byteOffset, r.block.length);

  const report = getReport();
  const out = { extracted: true, code: r.code };
  if (Array.isArray(report)) out.progress = report;
  else if (report) out.message = String(report);

  if (res > 0) {
    const id = toId(res);
    const file = reassemble(id);
    if (file.error) out.message = file.error;
    else out.file = file;
  }
  return out;
}

module.exports = {
  init: init,
  isReady: () => ready,
  feed: feed,
  version: info,
  /** 单块上限（字节），用于估算一个文件大概要多少帧 */
  blockSize: () => (ready ? Module._cimbard_get_bufsize() : 0),
};
