#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=/opt/wenmi-releases/wm-v7-20260913-190000-a2090001
TARGET=$ROOT/content-r209-c1
[[ $(cat /opt/wenmi/RELEASE_ID) == wm-v7-20260913-190000-a2090001 ]]
[[ -f "$TARGET/synthetic-apply.json" ]]
HASH=ef065f3dab1b196cac7b1cff0e473de9024cc443fc928963a60c1b5a910148a9
for REPORT in production-apply production-repeat; do
 sudo -u wenmi node "$TARGET/import-seed.mjs" "$ROOT/source" /opt/wenmi/data/database/wenmi.sqlite "$TARGET/seed.json" "$HASH" apply >"$TARGET/$REPORT.json"
 head -n 6 "$TARGET/$REPORT.json"
done
sudo -u wenmi node "$TARGET/verify-installed.mjs" "$ROOT/source" /opt/wenmi/data/database/wenmi.sqlite >"$TARGET/production-verified.json"
cat "$TARGET/production-verified.json"
curl -fsS http://127.0.0.1:43111/health
systemctl is-active wenmi-api wenmi-worker
