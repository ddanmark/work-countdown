# 下班了吗 ⏰

打工人自用的下班倒计时 + 工时工资统计。一套核心代码跑三个端，配置互通：

- **Android App** —— WebView 壳 + 桌面小组件（每秒刷新，AlarmManager tick 链）
- **PWA 网页版** —— 部署在 GitHub Pages：https://ddanmark.github.io/work-countdown/
- **微信小程序**

## 功能特性

- ⏰ **下班倒计时** —— 秒级倒计时与进度条，最后两分钟转入高精度模式，不为负数
- 📅 **灵活排班** —— 自定义上下班时间与午休时段、单双休 / 大小周；日历长按某天可设单日调班（调休休息或加班时段）
- 🏖️ **请假统计** —— 全天假 / 时段假、同日多段请假、带薪假按原因折算；工时与工资双口径
- 💰 **已赚工资** —— 今日 / 本周 / 本月按秒累计的"确定到手"金额（未来带薪假立即视为已赚）
- 📊 **统计页** —— 周 / 月 / 年汇总：应上与已过工作日、完成工时、请假分类明细、调班天数、月度金额
- 🇨🇳 **法定节假日** —— `holidays.json` 单一数据源生成三端代码，支持在线更新（优先级：自定义 > 已删 > 在线 > 内置）
- 🗓️ **月历视图** —— 今日格子按剩余工时渐变填充，请假 / 调班 / 节假日一目了然
- 🔔 **下班前提醒** —— Android 系统通知，可设置提前分钟数
- 📡 **扫码取文件** —— 用摄像头扫屏幕上的 [libcimbar](https://github.com/sz3/libcimbar) 动态码，把文件直接收进手机（离线、不过网；入口在左下角浮动按钮的面板里）
- 🔄 **配置互通** —— Z1 压缩文本 / 二维码，安卓 ↔ 小程序 ↔ 网页互相导入导出

## 扫码取文件（libcimbar）

左下角浮动按钮（解压发泄）的面板里多了一个 📡，点开是全屏取景页：

```
发送端（另一台设备）  cimbar.org 或 cimbar_send  →  屏幕上的彩色动态码
接收端（本 App/网页/小程序）  摄像头逐帧扫  →  喷泉码重组  →  zstd 解压  →  保存/分享
```

- 解码器是 libcimbar 官方 wasm（`cimbard_*` 接口），与 [re.cimbar.org](http://re.cimbar.org/) 同源同版本，三端共用一份二进制
- 网页版 / App 端：`app/www/cimbar/`，多 Worker 并行解码，WebCodecs 取帧（不支持时自动退回 canvas）
- 小程序端：`miniprogram/.../utils/cimbar/`，`WXWebAssembly` 加载 brotli 压缩的 wasm（1.85 MB → 448 KB），`camera` 组件逐帧解码
- 单块 7.5 KB，一帧一个块；文件越大需要扫的帧数越多（例如 200 KB 约 30 帧）
- 想升级解码器版本：改 `tools/vendor-cimbar.js` 顶部的 `VERSION` / `BUILD`，再跑 `node tools/vendor-cimbar.js`

**必须让动态码填满取景框。** libcimbar 的解码器要求码在**喂进去的图像**里占到宽度约 45% 以上，
否则会一直返回 `-3`（找得到码但解不出）——画面看着挺清楚也没用，这是分辨率问题不是对焦问题。
所以三端都只喂「取景框那一块」（画面中央的正方形），并按 `1.0 / 0.7 / 0.5` 三档变焦轮流试，
命中后锁定档位；长时间没有新数据会自动重新找档位（用户挪动了手机时）。

## 目录结构

```
holidays.json              # 法定节假日单一数据源（每年更新这里）
app/
  www/                     # 核心代码（HTML/CSS/JS，三端共享）
    cimbar/                # 扫码取文件：libcimbar wasm 解码器 + 集成层（vendored）
  android/                 # Android 工程（Gradle，www 打包进 assets）
  icon.png
miniprogram/               # 微信小程序工程
  miniprogram/utils/cimbar/  # 小程序端解码器（包装后的 glue + brotli wasm）
tools/
  gen-holidays.js          # 节假日生成器：holidays.json → 三端代码
  build-web.js             # 生成 web/（PWA 变体：manifest + Service Worker）
  vendor-cimbar.js         # 加工 libcimbar 官方发布包 → 三端可用的解码器资源
  cimbar-e2e.html          # 扫码取文件端到端验证页（编码 → 取像素 → 解码 → 逐字节比对）
  test-cimbar-e2e.js       # 跑上面那个页面的脚本（需 playwright）
  golden-cases.json        # 黄金向量用例
  test-java.sh             # WidgetConfig Java 测试（桌面 JVM + android-stub.jar）
extract-harness.js         # 从 app.js 按代码标记抽取纯计算函数（测试基建）
test-golden.js             # 黄金向量回归（www + 小程序）
test-holiday-online.js     # 在线节假日回归
test-week-range.js         # 周进度回归
test-week-range-mp.js      # 小程序周进度回归
.github/workflows/         # CI + Pages 部署
```

## 网页版

在线地址：**https://ddanmark.github.io/work-countdown/**

本地预览：

```bash
node tools/build-web.js    # 生成 web/（产物不入库）
# 任选静态服务器指向 web/（Service Worker 需要 http 环境）
```

## 开发

### 更新节假日数据

每年国务院办公厅发布次年放假安排后（通常在 11 月前后）：编辑 `holidays.json` 添加对应年份分组（`holidays` = 放假日期，`workdays` = 调休补班日期），然后运行：

```bash
node tools/gen-holidays.js
```

生成器是幂等的，会重新生成三端内嵌代码；CI 会校验仓库里的生成物与 `holidays.json` 一致，改了数据别忘了提交生成结果。

### 跑测试

```bash
node test-golden.js           # 黄金向量（www + 小程序）
node test-holiday-online.js   # 在线节假日
node test-week-range.js       # 周/月进度回归
node test-week-range-mp.js    # 小程序周/月进度回归
bash tools/test-java.sh       # WidgetConfig 黄金向量（需 JDK 21）

# 扫码取文件：端到端验证（需 playwright，属可选开发依赖）
npm i -D playwright && npx playwright install chromium
node tools/test-cimbar-e2e.js --bytes=40000 --random          # 网页/App 端
node tools/test-cimbar-e2e.js --engine=mp --bytes=40000 --random  # 小程序端解码器

# 模拟真机「拿摄像头拍另一块屏幕」：把动态码缩到画面中央再解码
# --scale 是码占画面短边的比例，--zooms 走生产代码的取景框裁剪路径
node tools/test-cimbar-e2e.js --bytes=40000 --random --scene --scale=0.4 --zooms=1,0.7,0.5
```

`tools/cimbar-e2e.html` 会用同一个 wasm 模块既当发送端又当接收端：把一段字节渲染成
cimbar 动态码、读回像素、按真实路径喂给解码器，最后逐字节比对。不需要摄像头，
顺带还会篡改一个字节做自检，确认「比对」这一步不是走过场。

### CI / 部署

- push / PR 自动跑全套测试（`.github/workflows/ci.yml`），Java 测试用 `tools/vendor/android-stub.jar` 编译期 stub，不依赖 Android SDK
- `app/www/**` 有改动并 push 到 main 后，自动构建并部署 GitHub Pages（`.github/workflows/pages.yml`）
- 运行环境固定为 `ubuntu-24.04` + Node 22 + JDK 21（Temurin），不用 `ubuntu-latest`，避免 runner 镜像自动升级带来的意外
- action 主版本：`checkout@v7`、`setup-node@v7`、`setup-java@v6`、`upload-pages-artifact@v5`、`deploy-pages@v5`（都是 Node 24 运行时）
- `tools/test-java.sh` 需要 JDK 21+：`android-stub.jar` 是 Java 21 字节码，用 JDK 17 编译会报「类文件具有错误的版本 65.0」

### 数据镜像

本仓库同步镜像到 [Gitee](https://gitee.com/Nasblance/work-countdown)（直连，供小程序正式版在线拉取节假日数据）；网页版在线更新走 GitHub raw。

## License

[MIT](LICENSE) © Nasblance

扫码取文件功能内置的 libcimbar 解码器为第三方组件，按 [Mozilla Public License 2.0](https://github.com/sz3/libcimbar/blob/master/LICENSE) 授权，
许可证全文见 `app/www/cimbar/LICENSE-libcimbar.txt` 与 `miniprogram/miniprogram/utils/cimbar/LICENSE-libcimbar.txt`。
