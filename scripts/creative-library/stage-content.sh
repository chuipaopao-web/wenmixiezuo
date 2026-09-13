#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=/opt/wenmi-releases/wm-v7-20260913-190000-a2090001
SRC=$ROOT/source
TARGET=$ROOT/content-r209-c1
[[ $(cat /opt/wenmi/RELEASE_ID) == wm-v7-20260913-190000-a2090001 ]]
[[ ! -e "$TARGET" ]]
install -d -m 700 -o wenmi -g wenmi "$TARGET"
install -m 600 -o wenmi -g wenmi /tmp/r209-c1-seed.json "$TARGET/seed.json"
install -m 600 -o wenmi -g wenmi /tmp/r209-c1-import.mjs "$TARGET/import-seed.mjs"
install -m 600 -o wenmi -g wenmi /tmp/r209-c1-verify.mjs "$TARGET/verify-installed.mjs"
python3 - "$TARGET/synthetic.sqlite" "$SRC" <<'PY'
import sqlite3,sys,pathlib
d=sqlite3.connect(sys.argv[1]); d.execute('CREATE TABLE schema_migrations(name TEXT PRIMARY KEY)')
for name in ['0122_creative_reference.sql','0123_creative_reference_admin_audit.sql']:
 d.executescript((pathlib.Path(sys.argv[2])/'apps/api/src/infrastructure/db/migrations'/name).read_text())
 d.execute('INSERT INTO schema_migrations VALUES(?)',(name,)); d.commit()
d.close()
PY
chown wenmi:wenmi "$TARGET/synthetic.sqlite"
HASH=ef065f3dab1b196cac7b1cff0e473de9024cc443fc928963a60c1b5a910148a9
for MODE in preview apply apply; do
 sudo -u wenmi node "$TARGET/import-seed.mjs" "$SRC" "$TARGET/synthetic.sqlite" "$TARGET/seed.json" "$HASH" "$MODE" >"$TARGET/synthetic-$MODE.json"
done
sudo -u wenmi node "$TARGET/verify-installed.mjs" "$SRC" "$TARGET/synthetic.sqlite"
echo CONTENT_STAGED
