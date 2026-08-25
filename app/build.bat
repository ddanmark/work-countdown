@echo off
chcp 65001 >nul 2>&1
title Build APK - Work Countdown

set APP_DIR=%~dp0
echo ============================================
echo   Work Countdown - APK Build
echo ============================================
echo.

REM 1. Sync web assets to Android
echo [1/3] Syncing web assets...
cd /d "%APP_DIR%"
call npx cap copy android
if errorlevel 1 (
    echo [ERROR] Sync failed!
    pause
    exit /b 1
)

REM 2. Build APK
echo.
echo [2/3] Building APK...
cd /d "%APP_DIR%android"
set JAVA_HOME=D:\runtime\Java\jdk17\openjdk\jdk-21
set ANDROID_HOME=D:\runtime\android-sdk
set ANDROID_SDK_ROOT=D:\runtime\android-sdk
call gradlew.bat assembleDebug --no-daemon
if errorlevel 1 (
    echo [ERROR] Build failed!
    pause
    exit /b 1
)

REM 3. Result
echo.
echo [3/3] Build complete!
set APK=%APP_DIR%android\app\build\outputs\apk\debug\app-debug.apk
echo APK path: %APK%
for %%I in ("%APK%") do echo File size: %%~zI bytes
echo.

REM Show version
set AAPT=D:\runtime\android-sdk\build-tools\36.0.0\aapt2.exe
"%AAPT%" dump badging "%APK%" 2>nul | findstr /C:"versionCode" /C:"application-label"

echo.
echo ============================================
echo   Build OK! Transfer APK to phone to install
echo ============================================
pause
