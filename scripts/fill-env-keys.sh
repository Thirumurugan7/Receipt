#!/usr/bin/env bash
# Fill the private-key fields in .env from the captured .secrets/ files.
# Both .env and .secrets/ are gitignored. Nothing is printed to the terminal.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "no .env found"; exit 1; }

put() { # put VAR FILE
  local var="$1" file="$2"
  [ -f "$file" ] || { echo "missing $file"; exit 1; }
  local val; val=$(tr -d '\r\n' < "$file")
  # rewrite the line in place, value never echoed
  VAL="$val" VAR="$var" python3 - <<'PY'
import os, re, pathlib
p = pathlib.Path('.env'); s = p.read_text()
var, val = os.environ['VAR'], os.environ['VAL']
s, n = re.subn(rf'(?m)^{re.escape(var)}=.*$', f'{var}={val}', s)
assert n == 1, f'expected exactly one {var} line, found {n}'
p.write_text(s)
PY
}

put HEDERA_OPERATOR_KEY     .secrets/acct1_key
put DEPLOYER_PRIVATE_KEY    .secrets/acct1_key
put ADJUDICATOR_PRIVATE_KEY .secrets/acct1_key
put BUYER_PRIVATE_KEY       .secrets/cardA_key
put SELLER_PRIVATE_KEY      .secrets/cardB_key
put STRANGER_PRIVATE_KEY    .secrets/cardC_key

chmod 600 .env
filled=$(grep -cE '^[A-Z_]*(PRIVATE_KEY|OPERATOR_KEY)=0x[0-9a-fA-F]{64}$' .env)
echo "filled $filled/6 key fields in .env (values not shown)"
