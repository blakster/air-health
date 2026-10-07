#!/usr/bin/env bash
# Start (or restart) the Air Health dashboard in the background.
cd "$(dirname "$0")"
pkill -f "node $(pwd)/server.js" 2>/dev/null; pkill -f "node server.js" 2>/dev/null; sleep 0.6
nohup node "$(pwd)/server.js" >> data/server.log 2>&1 &
echo "started pid $! — http://localhost:${PORT:-4870}  (passcode: data/.passcode)"
