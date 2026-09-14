#!/bin/bash
# 假占用验证：用本批隔离假服务占住端口，演练必须拒绝启动、零业务请求、不停无关服务
set -u
export SRC=/opt/wenmi-releases/wm-auth-takeover01-preflight/source
export RB=/opt/wenmi-releases/wm-auth-takeover01-preflight/source/.local/rollback-target-linux
PORT=43230
LOG=/tmp/fake-occupant-requests.log
DRILL_LOG=/tmp/fake-occupy-drill.log
rm -f "$LOG" "$DRILL_LOG"

python3 /tmp/fake-occupant.py $PORT "$LOG" &
FPID=$!
sleep 1
if ! kill -0 "$FPID" 2>/dev/null; then
  echo "FAKE-START-FAIL (端口可能被占)"
  exit 1
fi

bash /tmp/drill-rollback.sh $PORT >"$DRILL_LOG" 2>&1
DEXIT=$?

if kill -0 "$FPID" 2>/dev/null; then FAKE_ALIVE=yes; else FAKE_ALIVE=no; fi
REQ_COUNT=0
[ -f "$LOG" ] && REQ_COUNT=$(wc -l < "$LOG")
echo "DRILL_EXIT=$DEXIT (期望非0：端口被占时fail-closed)"
echo "FAKE_ALIVE=$FAKE_ALIVE (期望yes：未停无关服务)"
echo "FAKE_REQUESTS=$REQ_COUNT (期望0：拒绝前不发任何请求)"
echo "--- 演练日志关键行 ---"
grep -E 'ERROR|Phase A|CLEANUP-DONE|RESULT' "$DRILL_LOG" | head -8

kill "$FPID" 2>/dev/null; wait "$FPID" 2>/dev/null
rm -f "$LOG" "$DRILL_LOG"
echo "FAKE-OCCUPY-TEST-END"
