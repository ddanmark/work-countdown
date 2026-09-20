/* ============================================================
   cimbar-recv.js — 「扫码取文件」：扫屏幕上的 libcimbar 动态码把文件收下来

   上游解码器：libcimbar（https://github.com/sz3/libcimbar，MPL-2.0）
   本文件是「壳」：摄像头采集 → Worker 逐帧提取 → 主线程喷泉码重组 →
   zstd 解压 → 保存/分享。与 re.cimbar.org 的解码链路一致，只是换了 UI 与存储层。

   三端共用（网页版 PWA / Android App 的 WebView）。
   对外的唯一入口：window.CimbarRecv.open() / .close()

   ------------------------------------------------------------
   2026-09 修复（真机扫不出来的三个原因）：

   1) 取景框裁剪：libcimbar 的解码器要求动态码在「喂进去的图像」里占到宽度的
      约 45% 以上，否则会一直返回 -3（找到码但解不出）。手机竖屏拍横屏显示器时，
      整帧喂进去码只占宽度的 20~30%，永远解不出来。所以这里只喂取景框那一块
      （中央正方形），并按档位变焦，覆盖不同距离。
   2) 帧计数泄漏：Worker 的 wasm 还没就绪时会回 {type:'startWasm'}，
      旧代码把这个回包直接 return，导致 framesInFlight 只增不减，
      累计到上限后永久停止送帧（画面还在动，但一个字节都收不到）。
      现在改成「只往已就绪且空闲的 Worker 送帧」。
   3) 摄像头分辨率：原来允许降到 640x480，码再大也只有 480px。现在要求 >= 720p。
   ============================================================ */
(function () {
  "use strict";

  var BASE = "cimbar/"; // 资源目录，相对 index.html
  var ERR_SIZE = 1024;
  var AUTO_MODES = [66, 68, 67, 4]; // Bu / B / Bm / 4C，自动识别时逐帧轮换
  var MODE_NAMES = { 4: "4C", 8: "8C", 66: "Bu", 67: "Bm", 68: "B" };
  // 取景框档位：正方形边长 = 画面短边 × 该比例。越小等效变焦越大。
  // 覆盖范围很重要：码相对画面太小（离得远）和太大（离得太近、被裁掉）都会一直
  // 返回 -3，所以档位要能从「整块短边」一路收到「1/4 短边」。
  var ZOOMS = [1, 0.72, 0.52, 0.36, 0.25];
  var MAX_WORKERS = 4;
  // 裁剪后要放大到的边长上限，以及允许的最大放大倍数（超过 2 倍插值也换不回信息）
  var WORK_SIZE = 1024;
  var MAX_UPSCALE = 2;
  // 提取成功过、但连续这么多帧没有新数据 → 认为用户挪动了手机，重新找取景框档位
  var STALL_FRAMES = 150;

  // ---------- 运行时状态 ----------
  var el = null;
  var modulePromise = null;
  var workers = [];
  var workerReady = []; // 每个 Worker 的 wasm 是否就绪
  var workerBusy = []; // 每个 Worker 是否正在处理一帧
  var workerZoom = []; // 每个 Worker 当前这一帧用的取景框档位
  var nextWorker = 0;
  var stream = null;
  var running = false;
  var counter = 0;
  var recentDecode = -1;
  var recentExtract = -1;
  var mode = 0; // 0 = 自动识别
  var zoomIdx = 0;
  var lockedZoom = 0; // 0 = 还没锁定
  var manualZoom = 0; // 用户手动指定的档位，0 = 自动
  var solved = false;
  var captureCanvas = null;
  var captureCtx = null;
  var workCanvas = null;
  var workCtx = null;
  var lastStatus = "";
  var stats = { frames: 0, extract: 0, nodata: 0, failed: 0, sent: 0 };

  // ================================================================
  // 1. 懒加载 wasm 解码器（首次打开扫码时才下载 1.85 MB 的 wasm）
  // ================================================================

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("加载失败：" + src)); };
      document.head.appendChild(s);
    });
  }

  function ensureModule() {
    if (modulePromise) return modulePromise;
    modulePromise = new Promise(function (resolve, reject) {
      // 先建好 Module，glue 里的 `var Module = typeof Module != "undefined" ? Module : {}`
      // 会沿用我们这份，于是 onRuntimeInitialized / locateFile 都归我们控制。
      // 已存在的字段（如测试页注入的 canvas）保留。
      window.Module = Object.assign({}, window.Module || {}, {
        locateFile: function (p) { return BASE + p; },
        onRuntimeInitialized: function () { resolve(window.Module); },
        onAbort: function (what) { reject(new Error("解码器初始化失败：" + what)); },
        print: function () {},
        printErr: function (msg) { if (window.console) console.warn("[cimbar] " + msg); },
      });
      loadScript(BASE + "zstd.js")
        .then(function () { return loadScript(BASE + "cimbar_js.js"); })
        .catch(reject);
    });
    return modulePromise;
  }

  function startWorkers(n) {
    for (var i = 0; i < n; i++) {
      (function (idx) {
        var w = new Worker(BASE + "recv-worker.js");
        w.onmessage = function (ev) { onWorkerMessage(idx, ev.data); };
        w.onerror = function (err) {
          workerReady[idx] = false;
          workerBusy[idx] = false;
          setStatus("解码线程出错：" + (err && err.message ? err.message : err));
        };
        workers.push(w);
        workerReady.push(false);
        workerBusy.push(false);
      })(i);
    }
  }

  function readyWorkerCount() {
    var n = 0;
    for (var i = 0; i < workers.length; i++) if (workerReady[i]) n++;
    return n;
  }

  // ================================================================
  // 2. 主线程侧：喷泉码重组 + zstd 解压（等价于上游 recv.js 里的 Sink）
  // ================================================================

  var sink = (function () {
    var fountainBuff = null;
    var errBuff = null;

    function heapView(ptr, len) {
      return new Uint8Array(window.Module.HEAPU8.buffer, ptr, len);
    }
    function fountain() {
      if (!fountainBuff) return null;
      if (fountainBuff.buffer !== window.Module.HEAPU8.buffer) {
        fountainBuff = new Uint8Array(window.Module.HEAPU8.buffer, fountainBuff.byteOffset, fountainBuff.byteLength);
      }
      return fountainBuff;
    }
    function err() {
      if (!errBuff) errBuff = window.Module._malloc(ERR_SIZE);
      return errBuff;
    }

    return {
      allocate: function () {
        var need = window.Module._cimbard_get_bufsize();
        if (fountainBuff && need > fountainBuff.length) {
          window.Module._free(fountainBuff.byteOffset);
          fountainBuff = null;
        }
        if (!fountainBuff) {
          fountainBuff = new Uint8Array(window.Module.HEAPU8.buffer, window.Module._malloc(need), need);
        }
      },

      /** 一帧提取出的数据块 → 喂给喷泉解码器 */
      onDecode: function (buff) {
        if (!buff || buff.length === 0) return;
        var fb = fountain();
        if (!fb) return;
        fb.set(buff);

        var res = window.Module._cimbard_fountain_decode(fb.byteOffset, buff.length);
        var report = sink.report();
        if (Array.isArray(report)) renderProgress(report);
        else if (report) setStatus(String(report));

        if (res > 0) {
          var id = Number(BigInt.asUintN(32, res)); // 返回值是 int64，取低 32 位
          sink.reassemble(id);
        }
      },

      /** 解码进度报告：进度数组（每个文件一条）或错误文本 */
      report: function () {
        var p = err();
        var len = window.Module._cimbard_get_report(p, ERR_SIZE);
        if (len <= 0) return null;
        var text = utf8Decode(heapView(p, len));
        try { return JSON.parse(text); } catch (e) { return text; }
      },

      /** 数据够了 → 拿文件名 → zstd 解压 → 保存 */
      reassemble: function (id) {
        var size = window.Module._cimbard_get_filesize(id);
        var p = err();
        var name = id + "." + size;
        var fnsize = window.Module._cimbard_get_filename(id, p, ERR_SIZE);
        if (fnsize < 0) {
          setStatus("文件重组失败，请重试");
          return;
        }
        if (fnsize > 0) name = utf8Decode(heapView(p, fnsize)) || name;
        solved = true;
        setStatus("✅ 收完了，正在解压 " + name + " …");
        window.Zstd.decompress(name, id);
      },
    };
  })();

  // ================================================================
  // 3. Worker 回包处理
  // ================================================================

  function onWorkerMessage(wid, data) {
    if (!data) return;

    // Worker 的 wasm 就绪 / 未就绪通知。注意这里**没有**对应的送帧，
    // 所以不能去减 framesInFlight 之类的计数（旧代码在这里踩过坑）。
    if (data.type === "startWasm") {
      if (data.ready) {
        workerReady[wid] = true;
        workerBusy[wid] = false;
      } else {
        workerReady[wid] = false;
        workerBusy[wid] = false;
      }
      return;
    }

    workerBusy[wid] = false; // 这个 Worker 空出来了

    if (data.nodata) { recentExtract = counter; stats.nodata++; return; }
    if (data.failed_extract) { stats.failed++; return; }
    if (data.res) { setStatus(String(data.res)); return; }
    if (!data.buff) return;

    recentDecode = counter;
    stats.extract++;
    if (data.buff.length > 0) {
      // 扫出东西了：锁定模式（切模式会重置喷泉码状态，不能来回切）
      if (!mode) setMode(data.mode);
      // 同时也锁定这一帧用的取景框档位：这一档能解出来，就别再换
      if (!lockedZoom && !manualZoom) {
        lockedZoom = workerZoom[wid] || ZOOMS[0];
        updateZoomUi();
      }
      sink.onDecode(data.buff);
    }
    updateDiag();
  }

  function setMode(next) {
    if (!next || next === mode) return;
    mode = next;
    window.Module._cimbard_configure_decode(mode);
    sink.allocate();
    if (el && el.mode) el.mode.textContent = "已识别：" + (MODE_NAMES[mode] || mode);
  }

  // ================================================================
  // 4. 摄像头采集
  // ================================================================

  function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(
        new Error("这个环境不给摄像头权限。网页版需要用 https 打开（或 localhost），App 端请确认已授予相机权限。")
      );
    }
    var landscape = window.matchMedia("all and (orientation:landscape)").matches;
    return navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          // 码要有足够像素才解得动：下限抬到 720p（原来是 640x480，太低）
          width: { min: 720, ideal: 1920 },
          height: { min: 720, ideal: 1080 },
          aspectRatio: landscape ? 16 / 9 : 9 / 16,
          frameRate: { ideal: 15 },
          // 对焦/曝光交给相机自己连续调，不然对着屏幕容易糊
          focusMode: "continuous",
          exposureMode: "continuous",
        },
      })
      .then(function (s) {
        stream = s;
        var v = el.video;
        if ("srcObject" in v) v.srcObject = s;
        else v.src = URL.createObjectURL(s);
        return v.play().catch(function () {});
      })
      .then(function () {
        running = true;
        counter = 0;
        recentDecode = recentExtract = -1;
        stats = { frames: 0, extract: 0, nodata: 0, failed: 0, sent: 0 };
        scheduleFrame();
      })
      .catch(function (err) {
        throw new Error(describeCameraError(err));
      });
  }

  function describeCameraError(err) {
    var name = (err && err.name) || "";
    var msg = (err && err.message) || String(err);
    if (name === "NotAllowedError" || /permission|denied/i.test(msg)) {
      return "没有摄像头权限，请在系统或浏览器设置里允许后重试。";
    }
    if (name === "NotFoundError" || name === "OverconstrainedError" || /not found|no camera/i.test(msg)) {
      return "没找到可用的摄像头设备。";
    }
    if (name === "NotReadableError" || /in use/i.test(msg)) {
      return "摄像头被其他应用占用了，关掉别的相机应用再试。";
    }
    if (name === "NotSupportedError" || /not supported/i.test(msg)) {
      return "这个环境不支持调用摄像头（网页版需 https 打开，App 端请确认已授予相机权限）。";
    }
    return "摄像头打不开：" + msg;
  }

  function scheduleFrame() {
    if (!running) return;
    var v = el.video;
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(onFrame);
    else requestAnimationFrame(onFrame);
  }

  function onFrame() {
    if (!running) return;
    scheduleFrame();
    counter++;
    stats.frames++;
    if (counter % 15 === 0) updateDiag();

    if (!el.video.videoWidth) return;
    // 只往「已就绪且空闲」的 Worker 送帧：避免堆积，也避免旧代码那种计数泄漏死锁
    var pick = -1;
    for (var i = 0; i < workers.length; i++) {
      var idx = (nextWorker + i) % workers.length;
      if (workerReady[idx] && !workerBusy[idx]) { pick = idx; break; }
    }
    if (pick < 0) return;
    nextWorker = (pick + 1) % workers.length;

    var frame = grabFrame();
    if (!frame) return;

    workerBusy[pick] = true;
    var z = currentZoom();
    workerZoom[pick] = z;
    stats.sent++;
    workers[pick].postMessage(
      {
        type: "proc",
        pixels: frame.pixels,
        format: "RGBA",
        width: frame.width,
        height: frame.height,
        mode: mode || AUTO_MODES[counter % AUTO_MODES.length],
      },
      [frame.pixels.buffer]
    );
    // 自动找档位：每帧换一档，直到某档解出东西（或用户手动指定）
    if (!lockedZoom && !manualZoom) zoomIdx++;
    updateVisualState();
  }

  /** 当前该用哪一档取景框：手动指定 > 锁定 > 自动轮流试 */
  function currentZoom() {
    if (manualZoom) return manualZoom;
    return lockedZoom || ZOOMS[zoomIdx % ZOOMS.length];
  }

  /** 变焦倍数，用于 UI 显示：档位 0.5 → ×2 */
  function zoomLabel(z) {
    if (!z) return "自动";
    if (z >= 1) return "×1";
    return "×" + (1 / z).toFixed(1).replace(/\.0$/, "");
  }

  /** 点变焦按钮：自动 → ×1 → ×1.4 → ×2 → ×2.8 → ×4 → 自动 */
  function cycleZoom() {
    var order = [0].concat(ZOOMS);
    var cur = manualZoom || 0;
    var i = order.indexOf(cur);
    manualZoom = order[(i + 1) % order.length];
    lockedZoom = 0; // 手动改档位后取消自动锁定
    zoomIdx = 0;
    updateZoomUi();
    updateDiag();
  }

  function updateZoomUi() {
    if (el && el.zoom) el.zoom.textContent = "变焦 " + zoomLabel(manualZoom || lockedZoom);
  }

  /** 取景框的裁剪矩形：画面中央的正方形，边长 = 短边 × 档位 */
  function cropRect(vw, vh, zoom) {
    var frac = zoom > 0 && zoom <= 1 ? zoom : 1;
    var side = Math.max(64, Math.round(Math.min(vw, vh) * frac));
    return {
      side: side,
      sx: Math.round((vw - side) / 2),
      sy: Math.round((vh - side) / 2),
    };
  }

  /**
   * 裁剪之后要放大到的边长。
   *
   * 这一步是真正的关键：裁剪本身不改变动态码的像素数，只有**放大**才会。
   * 实测同一个裁剪区域，输出 562px 时解不出来、放大到 1024px 就能解出来。
   * 上限 2 倍是为了别把码插值糊掉（再往上插值也换不回信息）。
   */
  function workSize(side) {
    return Math.min(WORK_SIZE, side * MAX_UPSCALE);
  }

  /**
   * 取一帧：从摄像头画面中央裁一个正方形（边长 = 短边 × 档位），放大到工作分辨率后
   * 喂给解码器。
   *
   * 为什么必须裁 + 放大：libcimbar 的解码器要求动态码在输入图像里占到足够的像素
   * （实测约 450px 以上才稳定），否则一直返回 -3（找到码但解不出）。
   * 手机竖屏拍横屏显示器时整帧喂进去码只有 200~300px，永远解不出来。
   */
  function grabFrame() {
    var v = el.video;
    var vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return null;

    var r = cropRect(vw, vh, currentZoom());
    var out = Math.round(workSize(r.side));
    if (!captureCanvas) {
      captureCanvas = document.createElement("canvas");
      captureCtx = captureCanvas.getContext("2d", { willReadFrequently: true });
    }
    if (captureCanvas.width !== out || captureCanvas.height !== out) {
      captureCanvas.width = out;
      captureCanvas.height = out;
    }
    captureCtx.imageSmoothingEnabled = true;
    captureCtx.imageSmoothingQuality = "high";
    // 源矩形 → 目标整块：画布自己完成缩放
    captureCtx.drawImage(v, r.sx, r.sy, r.side, r.side, 0, 0, out, out);
    var img = captureCtx.getImageData(0, 0, out, out);
    return { pixels: new Uint8Array(img.data.buffer), width: out, height: out };
  }

  function stopCamera() {
    running = false;
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    if (el && el.video) {
      try { el.video.srcObject = null; } catch (e) {}
    }
  }

  // ================================================================
  // 5. UI
  // ================================================================

  function setStatus(msg) {
    if (!el || !el.status || msg === lastStatus) return;
    lastStatus = msg;
    el.status.textContent = msg;
  }

  /** 调试用读数：扫不出来时靠它区分「没取到帧 / 没找到码 / 找到了解不出」 */
  function updateDiag() {
    if (!el || !el.diag) return;
    el.diag.textContent =
      "帧 " + stats.frames + " · 送解 " + stats.sent + " · 找到码 " + (stats.nodata + stats.extract + stats.failed) +
      " · 提取 " + stats.extract + " · 解不出 " + stats.failed +
      " · 变焦 " + zoomLabel(currentZoom()) +
      " · 线程 " + readyWorkerCount() + "/" + workers.length;
  }

  function renderProgress(report) {
    if (!el || !el.bars) return;
    var bars = el.bars;
    while (bars.children.length < report.length) {
      var d = document.createElement("div");
      d.className = "cimbar-bar";
      d.appendChild(document.createElement("i"));
      bars.appendChild(d);
    }
    while (bars.children.length > report.length) bars.removeChild(bars.lastChild);

    var done = 0;
    for (var i = 0; i < report.length; i++) {
      var v = Math.max(0, Math.min(1, Number(report[i]) || 0));
      bars.children[i].firstChild.style.width = (v * 100).toFixed(1) + "%";
      if (v >= 1) done++;
    }
    var total = report.length;
    if (total === 1) setStatus("已收到 " + Math.round((report[0] || 0) * 100) + "%");
    else setStatus("已收到 " + done + "/" + total + " 个文件");

    // 提取过但很久没有新数据 → 大概率是用户挪了手机，换回自动找档位
    if (stats.extract > 0 && recentDecode > 0 && counter - recentDecode > STALL_FRAMES) {
      lockedZoom = 0;
      zoomIdx = (zoomIdx + 1) % ZOOMS.length;
      recentDecode = counter;
    }
  }

  function updateVisualState() {
    if (!el || !el.frame) return;
    var fresh = recentDecode > 0 && recentDecode + 30 > counter;
    var scanning = !fresh && recentExtract > 0 && recentExtract + 30 > counter;
    el.frame.classList.toggle("hit", fresh);
    el.frame.classList.toggle("scanning", scanning);
  }

  function resetUi() {
    lastStatus = "";
    solved = false;
    mode = 0;
    zoomIdx = 0;
    lockedZoom = 0;
    manualZoom = 0;
    if (el.mode) el.mode.textContent = "自动识别";
    if (el.bars) el.bars.innerHTML = "";
    updateZoomUi();
    setStatus("让动态码刚好填满取景框（离近一点；一直「解不出」就点上面的变焦）");
    updateDiag();
  }

  // ================================================================
  // 6. 文件保存：App 端走系统分享，网页端走浏览器下载
  // ================================================================

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result);
        resolve(s.slice(s.indexOf(",") + 1));
      };
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  }

  function browserDownload(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function saveDecodedFile(name, blob) {
    var Cap = window.Capacitor;
    var Plugins = Cap && Cap.Plugins;
    var Filesystem = Plugins && (Plugins.Filesystem || Plugins.Filessystem);
    var Share = Plugins && Plugins.Share;

    if (!Filesystem || !Share) {
      browserDownload(name, blob);
      setStatus("✅ 已保存 " + name + "（" + fmtSize(blob.size) + "）");
      return;
    }

    setStatus("正在保存 " + name + " …");
    blobToBase64(blob)
      .then(function (b64) {
        return Filesystem.writeFile({ path: name, data: b64, directory: "CACHE", recursive: true });
      })
      .then(function () {
        return Filesystem.getUri({ path: name, directory: "CACHE" });
      })
      .then(function (res) {
        setStatus("✅ 已收到 " + name + "（" + fmtSize(blob.size) + "）");
        return Share.share({ files: [res.uri], title: "扫码取文件", dialogTitle: "保存或分享…" });
      })
      .catch(function () {
        // 分享被取消 / 失败：回退成浏览器下载，别让用户白扫
        browserDownload(name, blob);
        setStatus("✅ 已保存 " + name + "（" + fmtSize(blob.size) + "）");
      });
  }

  function fmtSize(n) {
    if (!n && n !== 0) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(2) + " MB";
  }

  // ================================================================
  // 7. 开关
  // ================================================================

  function collectEls() {
    el = {
      overlay: document.getElementById("cimbarOverlay"),
      video: document.getElementById("cimbarVideo"),
      frame: document.getElementById("cimbarFrame"),
      status: document.getElementById("cimbarStatus"),
      diag: document.getElementById("cimbarDiag"),
      bars: document.getElementById("cimbarBars"),
      mode: document.getElementById("cimbarMode"),
      zoom: document.getElementById("cimbarZoom"),
      close: document.getElementById("cimbarClose"),
    };
    if (el.close) el.close.addEventListener("click", close);
    if (el.zoom) el.zoom.addEventListener("click", cycleZoom);
  }

  function open() {
    if (!el) collectEls();
    if (!el.overlay) return;
    resetUi();
    el.overlay.classList.add("open");

    var boot;
    if (workers.length && window.Module && window.Module.HEAPU8) {
      boot = Promise.resolve(); // 本次会话已经加载过，秒开
    } else {
      if (!workers.length) {
        startWorkers(Math.min(MAX_WORKERS, Math.max(1, (navigator.hardwareConcurrency || 4) - 1)));
      }
      boot = ensureModule().then(function () { installSaver(); });
    }

    boot
      .then(function () { return startCamera(); })
      .catch(function (err) {
        setStatus("⚠️ " + (err && err.message ? err.message : err));
      });
  }

  function close() {
    if (!el) return;
    el.overlay.classList.remove("open");
    stopCamera();
    resetUi();
  }

  /** zstd.js 解压完会调 Zstd.download_blob(name, blob)，这里换成我们的保存逻辑 */
  function installSaver() {
    if (window.Zstd) {
      window.Zstd.download_blob = saveDecodedFile;
      return true;
    }
    return false;
  }

  function utf8Decode(bytes) {
    if (window.TextDecoder) return new TextDecoder("utf-8").decode(bytes);
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
  }

  window.CimbarRecv = {
    open: open,
    close: close,
    /** 供调试/测试用：直接喂一帧 RGBA 像素（不走取景框裁剪） */
    _feed: function (pixels, width, height) {
      if (!el) collectEls();
      if (!workers.length) return;
      if (nextWorker >= workers.length) nextWorker = 0;
      workers[nextWorker].postMessage(
        { type: "proc", pixels: pixels, format: "RGBA", width: width, height: height, mode: mode || 68 },
        [pixels.buffer]
      );
      nextWorker++;
    },
    _ready: function () {
      if (!workers.length) {
        startWorkers(Math.min(MAX_WORKERS, Math.max(1, (navigator.hardwareConcurrency || 4) - 1)));
      }
      return ensureModule().then(function (m) { installSaver(); return m; });
    },
    /** 供测试用：按生产逻辑裁剪并放大一帧像素（与 grabFrame 同一套几何与工作分辨率） */
    _crop: function (pixels, width, height, zoom) {
      var r = cropRect(width, height, zoom);
      var src = pixels instanceof Uint8Array ? pixels : new Uint8Array(pixels);
      var side = r.side;
      var out = Math.round(workSize(side));
      var dst = new Uint8Array(out * out * 4);
      var colMap = new Int32Array(out);
      for (var x = 0; x < out; x++) colMap[x] = Math.floor((x * side) / out) * 4;
      for (var y = 0; y < out; y++) {
        var sRow = ((r.sy + Math.floor((y * side) / out)) * width + r.sx) * 4;
        var dRow = y * out * 4;
        for (var i = 0; i < out; i++) {
          var s = sRow + colMap[i], d = dRow + i * 4;
          dst[d] = src[s]; dst[d + 1] = src[s + 1]; dst[d + 2] = src[s + 2]; dst[d + 3] = src[s + 3];
        }
      }
      return { pixels: dst, width: out, height: out };
    },
    _stats: function () { return stats; },
  };
})();
