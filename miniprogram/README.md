# 下班了吗 ⏰ 微信小程序版

由同名的安卓（Capacitor 混合）App 移植而来。核心功能与界面与安卓端保持一致，配置互通。

## 功能

- **下班倒计时**：大号 HH:MM:SS + 厘秒实时跳动；上班前 / 工作中 / 休息中 / 已下班 / 休息日 / 法定节假日 等多种状态
- **进度条**：今日 / 本周 / 本月工作进度，可选显示「已赚工资」
- **月历**：按工时渐变着色，标注 法定假(休) / 调休(班) / 请假(假)
- **排班设置**：固定排班 / 大小周；逐日编辑上班、下班时间与多段休息；大小周可分大周/小周单独配置；一键应用到所有工作日
- **节假日管理**：内置 2026 法定节假日，支持新增/编辑/删除、恢复默认
- **请假管理**：按日期记录请假（年假/事假/病假/调休/婚假/产假/丧假/其他）
- **导入导出**：二维码（生成 + 原生扫码）/ 剪贴板 / 文件，**导出文本与安卓端完全互通**，可互相导入
- **扫码取文件**：扫屏幕上的 [libcimbar](https://github.com/sz3/libcimbar) 动态码，把另一台设备上的文件直接收进手机（离线、不走网络）。入口在主页左下角浮动按钮（🎈）面板里的 📡
- **解压发泄**：全屏 Canvas 粒子引擎（烟花 / 打拳 / 大便 / 捏碎 / 变色 / 庆祝 + 屏幕裂痕与震动）

## 目录结构

```
miniprogram/                      ← 微信开发者工具打开此目录
  project.config.json
  miniprogram/                    (源码根)
    app.js / app.json / app.wxss
    utils/
      holidays.js   2026 法定节假日
      schedule.js   排班/倒计时/进度 纯函数（接收 cfg）
      config.js     默认值/解析/压缩/存储(wx.setStorageSync)
      format.js     格式化工具
      lz-string.js  LZ-String 压缩（与安卓端互通）
      qrcode.js     二维码绘制封装
      qrcode-lib.js QR 编码核心（Kazuhiko Arase, MIT，第三方）
      cimbar/       扫码取文件（libcimbar 解码器，第三方 + 包装）
        cimbar_glue.js    官方 wasm glue（包成 CommonJS 工厂，由工具生成）
        cimbar_js.wasm.br brotli 压缩的解码器 wasm（448 KB）
        decoder.js        小程序侧集成：WXWebAssembly 加载 + 逐帧解码 + 落盘
    components/calendar/          月历组件
    components/vent/              解压发泄（主页覆盖层，非独立页）
    pages/
      index/        主页（倒计时+进度+月历+解压入口）
      settings/     设置（排班/节假日/请假/其他 四 Tab）
      transfer/     导入导出
      cimbar/       扫码取文件（全屏取景）
```

## 扫码取文件（libcimbar）

- 解码跑在**主线程**（`WXWebAssembly` 在 Worker 里也能用，但单帧像素还要跨线程拷贝，收益不大），
  因此按帧节流（约 11 帧/秒）；解码期间界面会有点顿，属正常。
- 编码模式默认自动识别（B → Bu → Bm → 4C 依次试），扫出数据后**锁定模式**：
  上游 `cimbard_configure_decode` 切模式时会重置喷泉码状态，来回切会导致永远攒不满数据。
  右上角胶囊可以手动指定模式。
- 单块 7.5 KB、一帧一个块。200 KB 的文件大约要扫 30 帧，文件越大越需要耐心（约 7.5 KB/帧）。
- **必须让动态码在画面里够大。** libcimbar 的解码器要求码在喂进去的图像里占到约 450px 以上，
  否则一直返回 `-3`（找得到码但解不出）——画面看着清楚也没用，这是分辨率问题不是对焦问题。
  做法是「取景框裁剪 + 放大到 1024」：只取画面中央正方形（边长 = 短边 × 档位），
  档位 `1 / 0.72 / 0.52 / 0.36 / 0.25` 轮流试，裁完再最近邻放大到工作分辨率。
  放大这一步是关键——裁剪不改变码的像素数，只有放大才会（实测同一裁剪区 562px 解不出、1024px 能解出）。
  实测覆盖范围：码占画面短边 **25% ~ 100%+** 都能解（只裁不放大的话要 45% 以上）。
  一直「解不出」就点右上角**变焦**胶囊手动换档位，或把手机拿近/拿远一点。
- 取帧必须在 camera 组件 `bindinitdone` 之后 `start()`，否则监听器收不到帧。
- 底部的调试读数（`帧 N · 找到码 N · 提取 N · 解不出 N · 变焦 ×N`）能区分
  「没取到帧 / 没找到码 / 找到了解不出」，排查时先看它：**提取 0 而解不出很多 = 码太小或太大**。
- 收完的文件写进 `wx.env.USER_DATA_PATH/cimbar/`，随后优先「转发到聊天」，失败则尝试内置查看器打开。
- wasm 用 brotli 压缩（1.85 MB → 448 KB）以避开代码包体积限制；`WXWebAssembly` 需要基础库 ≥ 2.13.0。
- 升级解码器版本：改 `tools/vendor-cimbar.js` 的 `VERSION` / `BUILD`，跑 `node tools/vendor-cimbar.js`。

## 如何运行

1. 打开「微信开发者工具」，导入本项目目录 `miniprogram/`。
2. AppID 默认使用模板自带 `wx6516d70efc9799eb`（仅供本地预览）；正式发布请在工具右上角改为你自己的 AppID。
3. 编译运行即可。无需云开发环境、无需 npm 安装（二维码/压缩库已本地内置）。

## 与安卓端的互通

- 存储键同为 `work-countdown-config-v3`，配置结构一致。
- 导出文本格式：`Z1:` + LZ-String 压缩（`compressToEncodedURIComponent`）。安卓端导出的二维码 / 文本，可在小程序「导入 → 扫描二维码 / 从剪贴板导入」直接读取；反之亦然。
- 小程序导入用原生 `wx.scanCode` 扫码（替代安卓端的相机 + jsQR 实时识别）。

## 主要平台差异

| 安卓端 (Capacitor) | 小程序 |
| --- | --- |
| localStorage + Preferences | wx.setStorageSync |
| 自定义日历/时间/下拉选择器 | 原生 `<picker mode="date/time/selector">` |
| 相机 + jsQR 扫码 | 原生 `wx.scanCode` |
| cimbar 扫码取文件：WebCodecs/canvas 取帧 + Worker 池解码 | `camera` 组件 + `onCameraFrame` 取帧 + 主线程 WXWebAssembly 解码 |
| qrcodejs 生成二维码 | qrcode-lib 画到 Canvas 2D |
| requestAnimationFrame 走秒 | 1s 定时器刷新状态/进度，50ms 定时器刷新厘秒 |
| 解压 vent.js（Canvas + SVG 裂痕） | vent 覆盖层 Canvas 2D（主页内，不跳页），裂痕改用 Canvas 线段绘制 |
