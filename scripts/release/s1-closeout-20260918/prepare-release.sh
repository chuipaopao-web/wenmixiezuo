#!/bin/bash
set -euo pipefail
ID=wm-v7-20260918-161500-e1310473
SRC=/opt/wenmi-releases/$ID/source
test "$(sudo cat /opt/wenmi/RELEASE_ID)" = wm-v7-20260914-151504-a7614958
printf '%s  %s\n' ff73db81807034852d7f13ca0c65522ecd96fe43205e30445fbd2cf0eb816778 /tmp/wenmi-source-e1310473.tar.gz | sha256sum -c -
test ! -e "$SRC"
sudo install -d -o admin -g admin "$SRC" "$SRC/.local"
tar -xzf /tmp/wenmi-source-e1310473.tar.gz -C "$SRC"
printf '%s\n' "$ID" > "$SRC/RELEASE_ID"
cd "$SRC"
SRC="$SRC" bash scripts/release/auth-takeover/linux/build-candidate.sh
npm run build:v7:static-release > .local/static-build.log 2>&1
npm run verify:v7:static-release >> .local/static-build.log 2>&1
tail -12 .local/static-build.log
printf 'CANDIDATE-BUILD-OK %s\n' "$ID"
