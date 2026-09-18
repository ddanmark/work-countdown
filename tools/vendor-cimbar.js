#!/usr/bin/env node
/* ============================================================
   vendor-cimbar.js — 把 libcimbar 官方的 wasm 解码器加工成三端可用的产物

   上游：https://github.com/sz3/libcimbar （MPL-2.0）
        发布包 cimbar.wasm.tar.gz 里就是 cimbar.org / re.cimbar.org 用的同一份 wasm，
        同一个模块同时导出编码端（cimbare_*）与解码端（cimbard_*）接口。
        本脚本只取「解码」相关文件，供「扫码取文件」功能使用。

   产物：
     app/www/cimbar/                           ← 网页版 + Android App（Capacitor）共用
       cimbar_js.js        解码器 wasm glue（补丁：wasm 文件名去掉版本号）
       cimbar_js.wasm      解码器 wasm（1.85 MB）
       zstd.js             zstd 解压 + 下载辅助（依赖同一个 Module）
       recv-worker.js      Worker 内单帧「扫图 →  fountain 块」解码
       LICENSE-libcimbar.txt / README.md
     miniprogram/miniprogram/utils/cimbar/     ← 微信小程序
       cimbar_glue.js      glue 包装成 CommonJS 工厂（配合 WXWebAssembly）
       cimbar_js.wasm.br   brotli 压缩后的 wasm（448 KB，绕开小程序代码包体积限制）
       version.js          版本信息
       LICENSE-libcimbar.txt

   用法：
     node tools/vendor-cimbar.js             # 缺资源时自动下载（走 GitHub Release）
     node tools/vendor-cimbar.js --offline   # 只用本地缓存 .cimbar-dist/
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const https = require("https");

const ROOT = path.resolve(__dirname, "..");
const CACHE = path.join(ROOT, ".cimbar-dist");
const WWW_OUT = path.join(ROOT, "app", "www", "cimbar");
const MP_OUT = path.join(ROOT, "miniprogram", "miniprogram", "utils", "cimbar");

// 固定版本，保证可复现（上游 build 时间戳不同 → 二进制不同）
const VERSION = "v0.6.8";
const BUILD = "2026-08-21T2336";
const TARBALL = "cimbar.wasm.tar.gz";
const RELEASE_URL = `https://github.com/sz3/libcimbar/releases/download/${VERSION}/${TARBALL}`;

const OFFLINE = process.argv.indexOf("--offline") >= 0;

// ---------------------------------------------------------------- 下载 / 解包

function download(url, dest, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("重定向次数过多"));
    https
      .get(url, { headers: { "User-Agent": "work-countdown-vendor" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(download(res.headers.location, dest, redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error("HTTP " + res.statusCode + " " + url));
        }
        const tmp = dest + ".part";
        const out = fs.createWriteStream(tmp);
        res.pipe(out);
        out.on("finish", () => {
          out.close(() => {
            fs.renameSync(tmp, dest);
            resolve(dest);
          });
        });
        out.on("error", reject);
      })
      .on("error", reject);
  });
}

function run(cmd, args) {
  const r = require("child_process").spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(cmd + " 失败，退出码 " + r.status);
}

async function ensureDist() {
  fs.mkdirSync(CACHE, { recursive: true });
  const tarPath = path.join(CACHE, TARBALL);
  const srcDir = path.join(CACHE, "src");
  const gluePath = path.join(srcDir, `cimbar_js.${BUILD}.js`);

  if (!fs.existsSync(gluePath)) {
    if (!fs.existsSync(tarPath)) {
      if (OFFLINE) throw new Error("离线模式但缺少缓存：" + tarPath);
      console.log("⬇️  下载 " + RELEASE_URL);
      await download(RELEASE_URL, tarPath);
    }
    console.log("📦 解包 " + TARBALL);
    fs.mkdirSync(srcDir, { recursive: true });
    // Windows 10+ 自带 bsdtar；Linux/macOS 也都有
    run("tar", ["-xzf", tarPath, "-C", srcDir]);
  }

  const need = [
    `cimbar_js.${BUILD}.js`,
    `cimbar_js.${BUILD}.wasm`,
    `zstd.${BUILD}.js`,
    `recv-worker.${BUILD}.js`,
  ];
  need.forEach((f) => {
    if (!fs.existsSync(path.join(srcDir, f))) {
      throw new Error("发布包内容与预期不符，缺少 " + f + "（上游换了构建？请更新 BUILD 常量）");
    }
  });
  return srcDir;
}

// ---------------------------------------------------------------- 补丁

const HEADER = (file, note) =>
  `/* ============================================================\n` +
  `   ${file} — 由 tools/vendor-cimbar.js 从 libcimbar ${VERSION} 官方发布包加工而来，请勿手改。\n` +
  `   上游：https://github.com/sz3/libcimbar （MPL-2.0，见同目录 LICENSE-libcimbar.txt）\n` +
  (note ? `   本地改动：${note}\n` : "") +
  `   要升级：改 tools/vendor-cimbar.js 里的 VERSION / BUILD 后重新运行。\n` +
  `   ============================================================ */\n`;

/** glue：把写死的 wasm 文件名去掉版本号，并校验 instantiateWasm 钩子存在 */
function patchGlue(src) {
  if (src.indexOf('Module["instantiateWasm"]') < 0) {
    throw new Error("glue 里找不到 instantiateWasm 钩子，小程序端无法指定 wasm 路径");
  }
  const before = `cimbar_js.${BUILD}.wasm`;
  if (src.indexOf(before) < 0) throw new Error("glue 里找不到 wasm 文件名 " + before);
  return HEADER("cimbar_js.js", `wasm 文件名 ${before} → cimbar_js.wasm`) +
    src.split(before).join("cimbar_js.wasm");
}

/** worker：改 importScripts 路径；修掉官方 fountainBuff() 里堆搬移后写错键名的 bug */
function patchWorker(src) {
  let out = src;
  const imp = `importScripts('cimbar_js.${BUILD}.js');`;
  if (out.indexOf(imp) < 0) throw new Error("worker 里找不到 importScripts 语句");
  out = out.split(imp).join("importScripts('cimbar_js.js');");

  const buggy =
    "    fountainBuff: function () {\n" +
    "      let buff = _buffs['fountain'];\n" +
    "      if (buff.buffer !== Module.HEAPU8.buffer) {\n" +
    "        _buffs['img'] = new Uint8Array(Module.HEAPU8.buffer, buff.byteOffset, buff.byteLength);\n" +
    "        buff = _buffs['fountain'];\n" +
    "      }\n" +
    "      return buff;\n" +
    "    }";
  if (out.indexOf(buggy) >= 0) {
    out = out.replace(
      buggy,
      "    fountainBuff: function () {\n" +
        "      let buff = _buffs['fountain'];\n" +
        "      if (buff.buffer !== Module.HEAPU8.buffer) {\n" +
        "        // 上游这里误写成 _buffs['img']，堆搬移后会拿到过期视图，这里修正为 fountain\n" +
        "        _buffs['fountain'] = new Uint8Array(Module.HEAPU8.buffer, buff.byteOffset, buff.byteLength);\n" +
        "        buff = _buffs['fountain'];\n" +
        "      }\n" +
        "      return buff;\n" +
        "    }"
    );
  }
  return HEADER("recv-worker.js", "importScripts 指向 cimbar_js.js；修正 fountainBuff() 堆搬移后写错的键名") + out;
}

function patchZstd(src) {
  return HEADER("zstd.js", "无（原样 vendored；download_blob 可在调用方覆盖）") + src;
}

/** 小程序：把 glue 包成 CommonJS 工厂，Module 由调用方传入（参数同名，var 声明自动被忽略） */
function wrapGlueForMiniprogram(src) {
  if (src.indexOf("import.meta") >= 0) throw new Error("glue 使用了 import.meta，需要额外处理");
  const first = src.slice(0, 200);
  if (first.indexOf("var Module=") < 0) throw new Error("glue 开头不是预期的 var Module 声明");
  return (
    HEADER("cimbar_glue.js", "整体包进 CommonJS 工厂，Module 由调用方注入；其余原样") +
    "\n" +
    "// 用法：const Module = { instantiateWasm: ... }; require('./cimbar_glue.js')(Module);\n" +
    "// 工厂内部 `var Module = typeof Module != 'undefined' ? Module : {}` 里的 var 声明\n" +
    "// 与形参同名，会被引擎忽略，因此注入的 Module 会被沿用。\n" +
    "module.exports = function createCimbarModule(Module) {\n" +
    src +
    "\n  return Module;\n" +
    "};\n"
  );
}

// ---------------------------------------------------------------- 主流程

(async function main() {
  const srcDir = await ensureDist();
  const read = (f) => fs.readFileSync(path.join(srcDir, f), "utf8");

  fs.mkdirSync(WWW_OUT, { recursive: true });
  fs.mkdirSync(MP_OUT, { recursive: true });

  const glue = read(`cimbar_js.${BUILD}.js`);
  const worker = read(`recv-worker.${BUILD}.js`);
  const zstd = read(`zstd.${BUILD}.js`);
  const wasm = fs.readFileSync(path.join(srcDir, `cimbar_js.${BUILD}.wasm`));

  // ---- 网页 / App ----
  fs.writeFileSync(path.join(WWW_OUT, "cimbar_js.js"), patchGlue(glue), "utf8");
  fs.writeFileSync(path.join(WWW_OUT, "cimbar_js.wasm"), wasm);
  fs.writeFileSync(path.join(WWW_OUT, "zstd.js"), patchZstd(zstd), "utf8");
  fs.writeFileSync(path.join(WWW_OUT, "recv-worker.js"), patchWorker(worker), "utf8");

  // ---- 小程序 ----
  fs.writeFileSync(path.join(MP_OUT, "cimbar_glue.js"), wrapGlueForMiniprogram(glue), "utf8");
  const br = zlib.brotliCompressSync(wasm, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: wasm.length,
    },
  });
  fs.writeFileSync(path.join(MP_OUT, "cimbar_js.wasm.br"), br);
  fs.writeFileSync(
    path.join(MP_OUT, "version.js"),
    "// 由 tools/vendor-cimbar.js 生成，勿手改\n" +
      "module.exports = {\n" +
      `  libcimbar: "${VERSION}",\n` +
      `  build: "${BUILD}",\n` +
      `  wasmBytes: ${wasm.length},\n` +
      `  wasmBrotliBytes: ${br.length},\n` +
      "};\n",
    "utf8"
  );

  // ---- 许可证：两处各放一份 ----
  const licenseText = fetchLicense();
  fs.writeFileSync(path.join(WWW_OUT, "LICENSE-libcimbar.txt"), licenseText, "utf8");
  fs.writeFileSync(path.join(MP_OUT, "LICENSE-libcimbar.txt"), licenseText, "utf8");

  console.log("✅ cimbar 解码器已加工完成");
  console.log("   网页/App: " + path.relative(ROOT, WWW_OUT));
  console.log("   小程序  : " + path.relative(ROOT, MP_OUT) + "（wasm " + (br.length / 1024).toFixed(0) + " KB brotli）");
})().catch((e) => {
  console.error("❌ " + e.message);
  process.exit(1);
});

/** libcimbar 的 LICENSE 不在发布包里，随仓库固化一份 MPL-2.0 全文（tools/vendor/LICENSE-libcimbar.txt） */
function fetchLicense() {
  const tracked = path.join(ROOT, "tools", "vendor", "LICENSE-libcimbar.txt");
  if (fs.existsSync(tracked)) return fs.readFileSync(tracked, "utf8");
  const local = path.join(CACHE, "LICENSE-libcimbar.txt");
  if (fs.existsSync(local)) return fs.readFileSync(local, "utf8");
  throw new Error(
    "缺少 " + tracked + "\n" +
      "   请从 https://github.com/sz3/libcimbar/blob/master/LICENSE 复制 MPL-2.0 全文到该路径后重试。"
  );
}
