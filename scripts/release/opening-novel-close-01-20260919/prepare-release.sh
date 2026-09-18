#!/bin/bash
# OPENING-NOVEL-CLOSE-01 仅长篇开书开放前后端阻断 · 候选构建（服务器上执行）
set -euo pipefail
ID=wm-v7-20260919-050500-121540bc
SRC=/opt/wenmi-releases/$ID/source
test "$(cat /opt/wenmi/RELEASE_ID)" = wm-v7-20260919-033900-2861da92
printf '%s  %s\n' 3bf008011798e6fb0ba6ac0bd6b12a61cef6f81d8a00efe46b7e498c07b88be2 /tmp/wenmi-source-121540bc.tar.gz | sha256sum -c -
test ! -e "$SRC"
sudo install -d -o admin -g admin "$SRC" "$SRC/.local"
tar -xzf /tmp/wenmi-source-121540bc.tar.gz -C "$SRC"
printf '%s\n' "$ID" > "$SRC/RELEASE_ID"
cd "$SRC"
SRC="$SRC" bash scripts/release/auth-takeover/linux/build-candidate.sh
npm run build:v7:static-release > .local/static-build.log 2>&1
npm run verify:v7:static-release >> .local/static-build.log 2>&1
tail -12 .local/static-build.log
printf 'CANDIDATE-BUILD-OK %s\n' "$ID"
