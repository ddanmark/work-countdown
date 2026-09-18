// cimbar.js — 扫码取文件：扫屏幕上的 libcimbar 动态码，把文件收到手机上
//
// 链路：camera 组件取 RGBA 帧 → utils/cimbar/decoder.js（WXWebAssembly 跑官方 wasm）
//       扫图取块 → 喷泉码重组 → zstd 解压 → 写进 USER_DATA_PATH → 转发/打开
//
// 注意：cimbard_configure_decode 切换模式时会重置喷泉码状态（上游 C++ 里 _sink.reset()），
// 所以识别出模式后必须锁定，不能在多模式间来回切。
const decoder = require("../../utils/cimbar/decoder.js");

const MODE_ORDER = [68, 66, 67, 4]; // 先试 B（cimbar.org 发送端默认），再 Bu / Bm / 4C
const MODE_NAMES = { 4: "4C", 8: "8C", 66: "Bu", 67: "Bm", 68: "B" };
const PROBE_PER_MODE = 4; // 每个模式最多试几帧，没扫出东西就换下一个
const MIN_FRAME_GAP = 90; // 主线程解码，节流到最多约 11 帧/秒
const MAX_FILE_BYTES = 64 * 1024 * 1024;

const DOC_TYPES = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "csv", "md"];

Page({
  data: {
    cameraOk: true,
    camError: "",
    frameSize: "large",
    flash: "off",
    modeText: "自动识别",
    status: "正在准备解码器…",
    bars: [],
    frameState: "",
  },

  onLoad() {
    this.frames = 0;
    this.lastFrameAt = 0;
    this.probeIdx = 0;
    this.probeCount = 0;
    this.lockedMode = 0; // 0 = 自动识别中
    this.solved = false;
    this.listener = null;

    decoder
      .init()
      .then(() => {
        this.setData({ status: "把镜头对准屏幕上的动态码" });
        this.startFrames();
      })
      .catch((e) => {
        this.setData({ status: "⚠️ " + (e && e.message ? e.message : e) });
      });
  },

  onShow() {
    if (decoder.isReady()) this.startFrames();
  },
  onHide() {
    this.stopFrames();
  },
  onUnload() {
    this.stopFrames();
  },

  // ---------- 摄像头 ----------
  onCameraInit() {
    this.setData({ cameraOk: true });
  },
  onCameraError(e) {
    const msg = (e && e.detail && e.detail.errMsg) || "";
    this.setData({
      cameraOk: false,
      camError: "摄像头不可用（" + msg + "）\n请在「设置」里允许小程序使用摄像头后重进本页",
    });
  },

  startFrames() {
    if (this.listener || this.solved) return;
    try {
      const ctx = wx.createCameraContext();
      this.listener = ctx.onCameraFrame((frame) => this.onFrame(frame));
      this.listener.start();
    } catch (e) {
      this.setData({ status: "⚠️ 取帧失败：" + (e && e.message ? e.message : e) });
    }
  },

  stopFrames() {
    if (!this.listener) return;
    try {
      this.listener.stop();
    } catch (e) {
      /* 忽略 */
    }
    this.listener = null;
  },

  // ---------- 逐帧解码 ----------
  onFrame(frame) {
    if (this.solved || !frame || !frame.data) return;
    const now = Date.now();
    if (now - this.lastFrameAt < MIN_FRAME_GAP) return;
    this.lastFrameAt = now;

    const mode = this.lockedMode || MODE_ORDER[this.probeIdx % MODE_ORDER.length];

    let r;
    try {
      r = decoder.feed(frame.data, frame.width, frame.height, mode);
    } catch (e) {
      this.setData({ status: "⚠️ 解码异常：" + (e && e.message ? e.message : e) });
      return;
    }
    this.frames++;

    if (!r.extracted) {
      // 这个模式下扫不出东西：自动识别时换下一个模式
      if (!this.lockedMode) {
        this.probeCount++;
        if (this.probeCount >= PROBE_PER_MODE) {
          this.probeCount = 0;
          this.probeIdx++;
        }
      }
      return;
    }

    // 扫出东西了：锁定模式（切模式会重置喷泉码状态，不能来回切）
    if (!this.lockedMode) {
      this.lockedMode = mode;
      this.probeCount = 0;
      this.setData({ modeText: "已识别：" + (MODE_NAMES[mode] || mode) });
    }

    if (r.file) {
      this.onSolved(r.file);
      return;
    }
    if (r.progress) {
      this.renderProgress(r.progress);
    } else if (r.message) {
      this.setData({ status: String(r.message) });
    }
  },

  renderProgress(report) {
    const bars = [];
    let done = 0;
    for (let i = 0; i < report.length; i++) {
      const v = Math.max(0, Math.min(1, Number(report[i]) || 0));
      bars.push((v * 100).toFixed(1));
      if (v >= 1) done++;
    }
    const total = report.length;
    const status =
      total === 1
        ? "已收到 " + Math.round((report[0] || 0) * 100) + "%"
        : "已收到 " + done + "/" + total + " 个文件";
    this.setData({ bars: bars, status: status, frameState: "hit" });
  },

  // ---------- 收完：落盘并交给系统 ----------
  onSolved(file) {
    this.solved = true;
    this.stopFrames();
    this.setData({ status: "✅ 收完了，正在保存 " + file.name + " …", frameState: "hit" });

    if (file.size > MAX_FILE_BYTES) {
      this.setData({ status: "⚠️ 文件过大（" + fmtSize(file.size) + "），已放弃保存" });
      return;
    }

    let filePath;
    try {
      const dir = wx.env.USER_DATA_PATH + "/cimbar";
      const fs = wx.getFileSystemManager();
      try {
        fs.mkdirSync(dir, true);
      } catch (e) {
        /* 目录已存在 */
      }
      filePath = dir + "/" + safeName(file.name);
      fs.writeFileSync(filePath, file.buffer);
    } catch (e) {
      this.setData({ status: "⚠️ 写入失败：" + (e && e.message ? e.message : e) });
      return;
    }

    this.setData({ status: "✅ 已收到 " + file.name + "（" + fmtSize(file.size) + "）" });
    wx.vibrateShort({ type: "medium" });
    this.deliver(filePath, file.name);
  },

  /** 把文件交给系统：优先「转发到聊天」，其次用内置查看器打开，最后退化为展示路径 */
  deliver(filePath, name) {
    const ext = (name.split(".").pop() || "").toLowerCase();
    const share = () => {
      wx.shareFileMessage({
        filePath: filePath,
        fileName: name,
        fail: () => open(),
      });
    };
    const open = () => {
      if (DOC_TYPES.indexOf(ext) < 0) return fallback();
      wx.openDocument({
        filePath: filePath,
        fileType: ext,
        showMenu: true,
        fail: () => fallback(),
      });
    };
    const fallback = () => {
      wx.setClipboardData({ data: filePath });
      wx.showModal({
        title: "文件已保存",
        content: name + "\n\n路径已复制：" + filePath + "\n（可到「微信 → 我 → 设置 → 通用 → 存储空间」里找到小程序文件）",
        showCancel: false,
        confirmText: "知道了",
      });
    };

    if (wx.shareFileMessage) share();
    else open();
  },

  // ---------- 工具条 ----------
  toggleFlash() {
    this.setData({ flash: this.data.flash === "torch" ? "off" : "torch" });
  },

  toggleFrameSize() {
    this.setData({ frameSize: this.data.frameSize === "large" ? "medium" : "large" });
    // frame-size 是组件属性，改完由小程序自己重启取帧
  },

  showModePicker() {
    const labels = MODE_ORDER.map((m) => (m === 68 ? "B（默认）" : MODE_NAMES[m]));
    wx.showActionSheet({
      itemList: ["自动识别"].concat(labels),
      success: (res) => {
        if (res.tapIndex === 0) {
          this.lockedMode = 0;
          this.probeIdx = 0;
          this.probeCount = 0;
          this.setData({ modeText: "自动识别" });
        } else {
          const m = MODE_ORDER[res.tapIndex - 1];
          this.lockedMode = m;
          this.setData({ modeText: "已识别：" + (MODE_NAMES[m] || m) });
        }
        this.setData({ bars: [], frameState: "" });
      },
      fail: () => {},
    });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/index/index" }) });
  },
});

function fmtSize(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
}

/** 文件名里可能有 / 之类不能落盘的字符，换掉 */
function safeName(name) {
  const cleaned = String(name || "cimbar-file.bin").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
  return cleaned.slice(0, 120) || "cimbar-file.bin";
}
