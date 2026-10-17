#!/usr/bin/env bash
# Recompile CFJudge.java to Java 8 bytecode and print the base64 blobs to paste
# into ../../src/judge/runners/java.js (HELPER_CLASSES).
#
# CheerpJ's bundled tools.jar is Java 8, so target 8. Needs a local JDK.
set -euo pipefail
cd "$(dirname "$0")"

rm -f ./*.class
javac -source 8 -target 8 CFJudge.java

echo "// paste into HELPER_CLASSES in src/judge/runners/java.js"
for f in CFJudge.class 'CFJudge$1.class' 'CFJudge$2.class'; do
  [ -f "$f" ] || continue
  printf "  '%s':\n    '%s',\n" "$f" "$(base64 -w0 "$f")"
done
rm -f ./*.class
