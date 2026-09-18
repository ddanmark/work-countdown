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
- 🔄 **配置互通** —— Z1 压缩文本 / 二维码，安卓 ↔ 小程序 ↔ 网页互相导入导出

## 目录结构

```
holidays.json              # 法定节假日单一数据源（每年更新这里）
app/
  www/                     # 核心代码（HTML/CSS/JS，三端共享）
  android/                 # Android 工程（Gradle，www 打包进 assets）
  icon.png
miniprogram/               # 微信小程序工程
tools/
  gen-holidays.js          # 节假日生成器：holidays.json → 三端代码
  build-web.js             # 生成 web/（PWA 变体：manifest + Service Worker）
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
```

### CI / 部署

- push / PR 自动跑全套测试（`.github/workflows/ci.yml`），Java 测试用 `tools/vendor/android-stub.jar` 编译期 stub，不依赖 Android SDK
- `app/www/**` 有改动并 push 到 main 后，自动构建并部署 GitHub Pages（`.github/workflows/pages.yml`）

### 数据镜像

本仓库同步镜像到 [Gitee](https://gitee.com/Nasblance/work-countdown)（直连，供小程序正式版在线拉取节假日数据）；网页版在线更新走 GitHub raw。

## License

[MIT](LICENSE) © Nasblance
