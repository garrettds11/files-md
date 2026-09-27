#!/usr/bin/env bash
# Run a command; on failure, publish Rust compiler/test errors as workflow
# annotations (visible on the run page without opening the full log).
set -o pipefail
log=$(mktemp)
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  awk '
    function flush() { if (buf != "") { gsub(/%/, "%25", buf); print "::error title=build::" buf; n++ } buf="" }
    /^(error|failures:|---- .* stdout ----|thread .* panicked)/ { flush(); take=14 }
    take > 0 { line=$0; gsub(/\r/, "", line); buf = buf (buf=="" ? "" : "%0A") line; take-- ; if (take==0) flush() }
    END { flush(); if (n==0) print "::error title=build::command failed; see log" }
  ' "$log" | head -40
fi
exit "$status"
