#!/usr/bin/env bash
# Keep the local stack up.
#
#   pnpm serve        start (or report already running)
#   pnpm serve stop   stop everything
#
# The facilitator and the seller are long-lived processes a demo depends on,
# and one that dies quietly the night before judging is worse than one that
# never started. Each runs under a restart loop, detached from the shell that
# launched it, with its output kept in .run/.
#
# Processes are identified by the port they hold, not by their command line:
# both run `tsx src/server.ts` from their own package directory, so the
# command line cannot tell them apart.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="$ROOT/.run"
mkdir -p "$RUN"

alive()   { curl -fsS -m 5 -o /dev/null "http://127.0.0.1:$1/health" 2>/dev/null; }
holders() { lsof -ti "TCP:$1" -sTCP:LISTEN 2>/dev/null; }

stop_one() {
  local name=$1 port=$2
  if [ -f "$RUN/$name.pid" ]; then
    local pid; pid="$(cat "$RUN/$name.pid")"
    kill "$pid" 2>/dev/null            # the supervisor, so it stops restarting
    pkill -P "$pid" 2>/dev/null        # its child
    rm -f "$RUN/$name.pid"
  fi
  local pids; pids="$(holders "$port")"
  [ -n "$pids" ] && echo "$pids" | xargs kill 2>/dev/null
  return 0
}

start_one() {
  local name=$1 port=$2 script=$3
  if alive "$port"; then echo "  $name already up on $port"; return; fi
  stop_one "$name" "$port"
  nohup bash -c "
    while true; do
      pnpm --dir '$ROOT' run $script >> '$RUN/$name.log' 2>&1
      echo \"[\$(date -u +%FT%TZ)] $name exited, restarting in 3s\" >> '$RUN/$name.log'
      sleep 3
    done
  " >/dev/null 2>&1 &
  echo $! > "$RUN/$name.pid"
  disown 2>/dev/null || true
  echo "  $name starting on $port (log: .run/$name.log)"
}

wait_up() {
  local name=$1 port=$2
  for _ in $(seq 1 45); do
    if alive "$port"; then echo "  $name up on $port"; return 0; fi
    sleep 2
  done
  echo "  $name did NOT come up on $port, see .run/$name.log"
  return 1
}

case "${1:-start}" in
  stop)
    echo "stopping"
    stop_one facilitator 8080
    stop_one seller 8787
    sleep 2
    echo "  facilitator $(alive 8080 && echo 'STILL UP' || echo stopped)"
    echo "  seller      $(alive 8787 && echo 'STILL UP' || echo stopped)"
    ;;
  start)
    # Order matters, and a fixed sleep is not ordering. The seller's x402
    # resource server loads supported payment kinds from the facilitator once,
    # at startup. If the facilitator is not answering yet that load fails, the
    # seller keeps its port open, and every paid request answers 500 for the
    # rest of its life. It took a refunded honest deal to notice.
    echo "starting the local stack"
    start_one facilitator 8080 facilitator
    echo
    wait_up facilitator 8080 || { echo "  not starting the seller without it"; exit 1; }

    start_one seller 8787 seller
    if ! wait_up seller 8787; then
      # A seller that came up degraded cannot recover on its own: the kinds are
      # fetched once. Restart it now that the facilitator is definitely there.
      echo "  seller is up but cannot take payments, restarting it against a live facilitator"
      stop_one seller 8787
      sleep 2
      start_one seller 8787 seller
      wait_up seller 8787
    fi
    echo
    echo "  now run  pnpm health"
    ;;
  *) echo "usage: pnpm serve [start|stop]"; exit 2 ;;
esac
