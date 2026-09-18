#!/bin/bash
# NEWBOOK-E2E-01 归档书永久删除修复 · 候选构建（服务器上执行）
set -euo pipefail
ID=wm-v7-20260918-195500-758265c5
SRC=/opt/wenmi-releases/$ID/source
test "$(cat /opt/wenmi/RELEASE_ID)" = wm-v7-20260918-173000-dc543268
printf '%s  %s\n' 2377bb3935a35c422cd4f850598219075af7c55731be856fa39995d765ea5f42 /tmp/wenmi-source-758265c5.tar.gz | sha256sum -c -
test ! -e "$SRC"
sudo install -d -o admin -g admin "$SRC" "$SRC/.local"
tar -xzf /tmp/wenmi-source-758265c5.tar.gz -C "$SRC"
printf '%s\n' "$ID" > "$SRC/RELEASE_ID"
cd "$SRC"
SRC="$SRC" bash scripts/release/auth-takeover/linux/build-candidate.sh
npm run build:v7:static-release > .local/static-build.log 2>&1
npm run verify:v7:static-release >> .local/static-build.log 2>&1
tail -12 .local/static-build.log
printf 'CANDIDATE-BUILD-OK %s\n' "$ID"
