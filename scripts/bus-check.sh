#!/usr/bin/env bash
# Is the RS-485 bus actually carrying data?
#
# The only honest health check for the bridge. It answers ping and accepts TCP
# even when its serial side is stone dead (that is the 2026-09-14 failure), so
# the question is never "is it up" but "is it relaying bytes".
#
# Run this at the pad while reseating connectors. It samples for SAMPLE_S and
# prints one line per attempt; it exits 0 the moment real bytes arrive.
#
#   ./scripts/bus-check.sh            # watch until the bus comes back
#   ./scripts/bus-check.sh once       # single sample, for scripts

BRIDGE_HOST="${BRIDGE_HOST:-192.168.4.60}"
BRIDGE_PORT="${BRIDGE_PORT:-8899}"
SAMPLE_S="${SAMPLE_S:-8}"

sample() {
  # nc exits on timeout; count whatever it relayed in the window.
  nc -w "$SAMPLE_S" "$BRIDGE_HOST" "$BRIDGE_PORT" 2>/dev/null | head -c 4096 | wc -c | tr -d ' '
}

if ! nc -z -w 3 "$BRIDGE_HOST" "$BRIDGE_PORT" 2>/dev/null; then
  echo "$(date +%T)  ✗  can't even open TCP to $BRIDGE_HOST:$BRIDGE_PORT — bridge off, off-WiFi, or sockets exhausted"
  [ "$1" = "once" ] && exit 2
fi

while :; do
  n=$(sample)
  if [ "${n:-0}" -gt 0 ]; then
    echo "$(date +%T)  ✓  BUS ALIVE — $n bytes in ${SAMPLE_S}s. The pump is talking again."
    exit 0
  fi
  echo "$(date +%T)  ✗  0 bytes in ${SAMPLE_S}s — TCP fine, serial side still dead"
  [ "$1" = "once" ] && exit 1
done
