# 下班了吗 · Android App

## 快速构建

### 一键脚本（推荐）
```bash
cd D:\runtime\ZCodeProject\work-countdown\app
bash build.sh
```
脚本会自动：同步网页 → 构建 APK → 显示版本号和路径。

### 手动构建（三步）
```bash
# 1. 同步网页到 Android
cd D:\runtime\ZCodeProject\work-countdown\app
npx cap copy android

# 2. 设置环境变量并构建
cd android
export JAVA_HOME="D:/runtime/Java/jdk17/openjdk/jdk-21"
export ANDROID_HOME="D:/runtime/android-sdk"
export ANDROID_SDK_ROOT="D:/runtime/android-sdk"
./gradlew assembleDebug

# 3. APK 在这里：
# android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 环境（本机已配好）

| 工具 | 路径/版本 |
|------|-----------|
| JDK 21 | `D:\runtime\Java\jdk17\openjdk\jdk-21` |
| Android SDK | `D:\runtime\android-sdk`（API 36 / build-tools 36.0.0） |
| Gradle 8.14.3 | wrapper 已指向本地 zip `D:\runtime\gradle-8.14.3-all.zip` |
| Maven 镜像 | 阿里云（build.gradle 已配置） |

---

## 改了网页后重新构建

1. 修改 `app/www/` 下的文件（App 版网页，同时也是网页版的源码）
2. 运行 `bash build.sh`
3. 把 APK 传到手机安装

> 如果 `www/` 下新增了文件（如 `cimbar/` 里的解码器资源），也要 `npx cap copy android` 同步过去 —— `build.sh` 里已经包含这一步。
> 网页版（PWA）由 `node tools/build-web.js` 从同一份 `app/www` 生成到 `web/`，不需要单独维护。

---

## 改版本号

编辑 `app/android/app/build.gradle`：
```groovy
versionCode 2        // 整数递增（系统用）
versionName "0.0.2"  // 版本号递增（用户可见）
```

---

## 安装到手机

1. 把 `app-debug.apk` 传到手机（微信/USB/ADB）
2. 手机上点击安装（需开启「允许未知来源应用」）
3. 或用 ADB：`adb install app-debug.apk`

---

## 目录结构

```
work-countdown/
└── app/                    # Capacitor 工程根目录
    ├── build.sh            # 一键构建脚本 ★
    ├── www/                # 网页源（打包进 App，网页版也从这里生成）
    │   ├── index.html
    │   ├── app.js / styles.css / vent.js / custom-select.js
    │   ├── jsQR.js / qrcode.min.js / lz-string.min.js
    │   └── cimbar/         # 扫码取文件：libcimbar wasm 解码器 + 集成层（vendored，勿手改）
    ├── capacitor.config.json
    ├── resources/          # 图标/启动屏源图
    └── android/            # Android 原生工程
        ├── app/
        │   ├── build.gradle        # ← 版本号在这里改
        │   └── src/main/
        │       ├── AndroidManifest.xml
        │       ├── java/com/workcountdown/app/
        │       │   ├── MainActivity.java       # 全屏沉浸式
        │       │   ├── WidgetConfig.java       # 小部件配置读取+计算
        │       │   ├── WorkCountdownWidgetProvider.java    # 小部件(小)
        │       │   └── WorkCountdownWidgetProviderMedium.java # 小部件(大)
        │       └── res/             # 布局/图标/动画/样式
        └── build.gradle        # 根配置（阿里云镜像）
```

## 扫码取文件

左下角浮动按钮面板里的 📡 会打开全屏取景页，扫屏幕上的 libcimbar 动态码收文件。
解码器是 libcimbar 官方 wasm（MPL-2.0，见 `www/cimbar/LICENSE-libcimbar.txt`），
`www/cimbar/` 下的文件由 `node tools/vendor-cimbar.js` 从上游发布包生成，不要手改。

- App 端相机权限已在 `AndroidManifest.xml` 声明（`android.permission.CAMERA`），Capacitor 会自动处理运行时授权
- 收到文件后写入缓存目录并唤起系统分享（`@capacitor/filesystem` + `@capacitor/share`），失败则退回浏览器下载
