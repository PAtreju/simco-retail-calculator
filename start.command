#!/bin/sh
# macOS: double-click to start the calculator with live price refresh. Close this window to stop.
cd "$(dirname "$0")" || exit 1
(sleep 1; open http://localhost:8765) &
node serve.mjs
