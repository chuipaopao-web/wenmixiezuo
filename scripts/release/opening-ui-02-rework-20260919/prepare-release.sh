#!/bin/bash
# OPENING-UI-02返修 R1类型字数合同+R2非长篇门禁 · 候选构建（服务器上执行）
set -euo pipefail
ID=wm-v7-20260919-033900-2861da92
SRC=/opt/wenmi-releases/$ID/source
test "$(cat /opt/wenmi/RELEASE_ID)" = wm-v7-20260919-003800-05c82c9d
printf '%s  %s\n' 167df2be83ca155098928314c5e7b4f346194e2d74fa76f437034092b93f4412 /tmp/wenmi-source-2861da92.tar.gz | sha256sum -c -
test ! -e "$SRC"
sudo install -d -o admin -g admin "$SRC" "$SRC/.local"
tar -xzf /tmp/wenmi-source-2861da92.tar.gz -C "$SRC"
printf '%s\n' "$ID" > "$SRC/RELEASE_ID"
cd "$SRC"
SRC="$SRC" bash scripts/release/auth-takeover/linux/build-candidate.sh
npm run build:v7:static-release > .local/static-build.log 2>&1
npm run verify:v7:static-release >> .local/static-build.log 2>&1
tail -12 .local/static-build.log
printf 'CANDIDATE-BUILD-OK %s\n' "$ID"
