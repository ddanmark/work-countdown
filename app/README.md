# 下班了吗 · Android App

## 快速构建

### 一键脚本（推荐）
```bash
cd C:\Users\labao\ZCodeProject\work-countdown\app
bash build.sh
```
脚本会自动：同步网页 → 构建 APK → 显示版本号和路径。

### 手动构建（三步）
```bash
# 1. 同步网页到 Android
cd C:\Users\labao\ZCodeProject\work-countdown\app
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

1. 修改 `app/www/index.html`（App 版网页）
2. 同步到根目录：`cp app/www/index.html ../index.html`（保持浏览器版一致）
3. 运行 `bash build.sh`
4. 把 APK 传到手机安装

> 如果改了 `www/` 下新增了文件（如 jsQR.js），也要 `npx cap copy android` 同步过去。

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
├── index.html              # 浏览器版（直接双击打开）
├── jsQR.js                 # QR 扫描库（浏览器版）
├── qrcode.min.js           # QR 生成库（浏览器版）
└── app/                    # Capacitor 工程根目录
    ├── build.sh            # 一键构建脚本 ★
    ├── www/                # 网页源（打包进 App）
    │   ├── index.html
    │   ├── jsQR.js
    │   └── qrcode.min.js
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
