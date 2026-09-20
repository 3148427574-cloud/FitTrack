#!/usr/bin/env bash
# 把 FitTrack 打成可分发的 DMG：通用二进制（Apple Silicon + Intel）+ ad-hoc 签名。
# 没有 Apple Developer 账号，所以不做公证，接收方首次打开需要手动放行一次（脚本会打印步骤）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APP_NAME="FitTrack"
BUILD_DIR="$ROOT/build/release"
DIST_DIR="$ROOT/dist"
STAGE="$BUILD_DIR/stage"
APP="$BUILD_DIR/dd/Build/Products/Release/$APP_NAME.app"
DMG="$DIST_DIR/$APP_NAME.dmg"

echo "==> 生成 Xcode 工程"
xcodegen generate

echo "==> 构建 Release 通用二进制（arm64 + x86_64）"
rm -rf "$BUILD_DIR"
xcodebuild -project "$APP_NAME.xcodeproj" -scheme "$APP_NAME" -configuration Release \
    -destination 'generic/platform=macOS' \
    -derivedDataPath "$BUILD_DIR/dd" \
    ARCHS="arm64 x86_64" ONLY_ACTIVE_ARCH=NO \
    build

[ -d "$APP" ] || { echo "构建产物不存在：$APP"; exit 1; }

echo "==> 校验产物"
lipo -archs "$APP/Contents/MacOS/$APP_NAME"
codesign --verify --verbose=1 "$APP" 2>&1 | sed 's/^/    /' || true

echo "==> 组装 DMG"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/应用程序"
cat > "$STAGE/使用说明.txt" <<'TXT'
FitTrack 安装说明

1. 把 FitTrack 拖进左边的「应用程序」文件夹。

2. 首次打开会被 macOS 拦下（这个 App 没有花钱买苹果的开发者签名）。
   二选一：
   a) 右键点 FitTrack →「打开」→ 在弹窗里再点一次「打开」。之后就能正常双击了。
   b) 打开「终端」，粘贴并回车：
        xattr -dr com.apple.quarantine /Applications/FitTrack.app
      如果提示「已损坏，无法打开」，用这条命令。

3. 打开后进「设置」页，填自己的 DeepSeek API Key（sk- 开头）。
   不填也能用，训练计划会退化成固定模板，AI 助手不可用。

4. 第一次点「同步到提醒事项」时，系统会弹窗要权限，允许即可。

数据都存在本机 ~/Library/Application Support/FitTrack/，
卸载直接删掉 App 就行，不会留后台进程。
TXT

mkdir -p "$DIST_DIR"
rm -f "$DMG"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null

echo
echo "==> 完成：${DMG}（$(du -h "$DMG" | cut -f1)）"
echo
echo "把这个 DMG 发给朋友，对方按里面「使用说明.txt」操作即可。"
echo "对方若遇到「无法验证开发者」，右键 →「打开」；若提示「已损坏」，跑："
echo "    xattr -dr com.apple.quarantine /Applications/FitTrack.app"
