#!/bin/bash
# OPENING-UI-02 开书页顺序/三人名单/四类型 · 候选构建（服务器上执行）
set -euo pipefail
ID=wm-v7-20260919-003800-05c82c9d
SRC=/opt/wenmi-releases/$ID/source
test "$(cat /opt/wenmi/RELEASE_ID)" = wm-v7-20260918-195500-758265c5
printf '%s  %s\n' a0cc5cb063cb1b83284ad7991529a9a787e2ac8e532fa7434c34ff93fb891ddd /tmp/wenmi-source-05c82c9d.tar.gz | sha256sum -c -
test ! -e "$SRC"
sudo install -d -o admin -g admin "$SRC" "$SRC/.local"
tar -xzf /tmp/wenmi-source-05c82c9d.tar.gz -C "$SRC"
printf '%s\n' "$ID" > "$SRC/RELEASE_ID"
cd "$SRC"
SRC="$SRC" bash scripts/release/auth-takeover/linux/build-candidate.sh
npm run build:v7:static-release > .local/static-build.log 2>&1
npm run verify:v7:static-release >> .local/static-build.log 2>&1
tail -12 .local/static-build.log
printf 'CANDIDATE-BUILD-OK %s\n' "$ID"
