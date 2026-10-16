#!/bin/zsh
# Открывает Dopa Room в Chrome и входит кодом студии из ~/.dopa_studio (код не показывается).
URL=${1:-http://localhost:8790/}
open -a "Google Chrome" "${URL}#k=$(cat ~/.dopa_studio/publora.code)"
