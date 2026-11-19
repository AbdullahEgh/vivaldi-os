#!/bin/bash
# Vivaldi OS — QA: checks that everything is installed, and puts it back if not
# (for example after a Vivaldi update). Double-click this file.
bash "$(cd "$(dirname "$0")" && pwd)/mod/installer/check-mac.sh" "$(cd "$(dirname "$0")" && pwd)/mod" "$@"
