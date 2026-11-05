#!/usr/bin/env bash
# Container check for PUID/PGID: builds the image, runs it the way compose does
# (no-new-privileges set) and judges it from outside, by process user, file
# ownership and /healthz. Named volumes rather than bind mounts, so ownership
# reads the same on Linux CI and on Docker Desktop.
#
#   tests/container/puid_pgid.sh            build, then run every scenario
#   IMAGE=name:tag SKIP_BUILD=1 ...         check an image that is already built
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2

IMAGE=${IMAGE:-telegrarr:puid-pgid-check}
RUN_LABEL="telegrarr-puid-check=$$"
READY_TIMEOUT_SECONDS=60
failures=0

cleanup() {
  docker ps -aq --filter "label=$RUN_LABEL" | xargs -r docker rm -f >/dev/null 2>&1
  docker volume ls -q --filter "label=$RUN_LABEL" | xargs -r docker volume rm -f >/dev/null 2>&1
}
trap cleanup EXIT

scenario() { printf '\n== %s\n' "$1"; }
pass() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n' "$1"
  failures=$((failures + 1))
}

assert_eq() { # <what> <expected> <actual>
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1: expected '$2', got '$3'"; fi
}

# Prints the name of a new labelled volume.
volume() { docker volume create --label "$RUN_LABEL"; }

# Runs a shell snippet as root with a volume at /v, bypassing the entrypoint: the
# test's own hands, for seeding and inspecting a volume no container is using.
in_volume() { # <volume> <snippet>
  docker run --rm --label "$RUN_LABEL" --user 0:0 --entrypoint sh -v "$1:/v" "$IMAGE" -c "$2"
}

# Starts a detached container as compose would, with a command if one follows
# "--". Prints its id. The app won't boot without Telegram credentials, so these
# are dummies, and the dead proxy keeps the check from ever reaching Telegram.
start() { # <docker run args...> [-- <command...>]
  local args=()
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
    args+=("$1")
    shift
  done
  [ "$#" -gt 0 ] && shift
  docker run -d --label "$RUN_LABEL" --security-opt no-new-privileges:true \
    --health-interval=1s --publish 127.0.0.1::8790 \
    -e TG_API_ID=1 -e TG_API_HASH=container-check -e TELEARR_PROXY=socks5://127.0.0.1:9 \
    -e TELEARR_SECRET_KEY=container-check "${args[@]}" "$IMAGE" "$@"
}

# Waits for Docker's own HEALTHCHECK and for /healthz through the published port.
wait_ready() { # <container>
  local deadline=$((SECONDS + READY_TIMEOUT_SECONDS)) port status
  while [ "$SECONDS" -lt "$deadline" ]; do
    [ "$(docker inspect -f '{{.State.Running}}' "$1")" = true ] || break
    status=$(docker inspect -f '{{.State.Health.Status}}' "$1" 2>/dev/null)
    if [ "$status" = healthy ]; then
      port=$(docker port "$1" 8790/tcp | head -n 1 | sed 's/.*://')
      if curl -fsS -m 3 "http://127.0.0.1:$port/healthz" >/dev/null; then
        pass "serves /healthz and passes its HEALTHCHECK"
        return 0
      fi
    fi
    sleep 1
  done
  fail "never became healthy ($(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$1"))"
  docker logs --tail 20 "$1" 2>&1 | sed 's/^/        /'
  return 1
}

# "real effective saved fs" for the app's Uid: or Gid: line.
pid1_ids() { # <container> <Uid|Gid>
  docker exec "$1" sed -n "s/^$2:[[:space:]]*//p" /proc/1/status | tr -s '[:space:]' ' ' | sed 's/ $//'
}

# The app is PID 1 after exec; it must hold these ids in all four slots, keep no
# supplementary root group and carry the no-new-privileges flag compose sets.
assert_app_runs_as() { # <container> <uid> <gid>
  assert_eq "app uid" "$2 $2 $2 $2" "$(pid1_ids "$1" Uid)"
  assert_eq "app gid" "$3 $3 $3 $3" "$(pid1_ids "$1" Gid)"
  assert_eq "no-new-privileges is in force" "1" \
    "$(docker exec "$1" sed -n 's/^NoNewPrivs:[[:space:]]*//p' /proc/1/status)"
  local groups processes
  groups=$(docker exec "$1" sed -n 's/^Groups:[[:space:]]*//p' /proc/1/status)
  case " $groups " in
    *" 0 "*) fail "app holds the root group (Groups: $groups)" ;;
    *) pass "app holds no root group" ;;
  esac
  if processes=$(docker top "$1" -eo pid,uid,comm); then
    assert_eq "no process in the container runs as root" "" \
      "$(echo "$processes" | awk 'NR > 1 && ($2 == 0 || $2 == "root")')"
  else
    fail "could not list the container's processes"
  fi
}

# Everything under <path> must belong to <uid>:<gid>; prints what doesn't.
assert_tree_owned_by() { # <container> <path> <uid> <gid>
  assert_eq "everything under $2 is $3:$4" "" \
    "$(docker exec "$1" find "$2" \( ! -uid "$3" -o ! -gid "$4" \) -print | head -n 5)"
}

check_defaults() {
  scenario "defaults run as 1000:1000"
  local c
  c=$(start -v "$(volume):/data" -v "$(volume):/downloads")
  wait_ready "$c" && {
    assert_app_runs_as "$c" 1000 1000
    assert_tree_owned_by "$c" /data 1000 1000
  }
}

check_puid_pgid() {
  scenario "PUID/PGID set the app user and own the data directory"
  local c
  c=$(start -e PUID=1100 -e PGID=1200 -v "$(volume):/data" -v "$(volume):/downloads")
  wait_ready "$c" && {
    assert_app_runs_as "$c" 1100 1200
    assert_tree_owned_by "$c" /data 1100 1200
    assert_eq "the app wrote its database as that user" "1100:1200" \
      "$(docker exec "$c" stat -c %u:%g /data/telearr.db)"
  }
}

check_compose_user() {
  scenario "compose-style user: starts and is left alone"
  local v c
  v=$(volume)
  in_volume "$v" 'chown 1500:1500 /v && touch /v/foreign && chown 4242:4242 /v/foreign'
  c=$(start --user 1500:1500 -e PUID=1100 -e PGID=1200 -v "$v:/data")
  wait_ready "$c" && {
    assert_app_runs_as "$c" 1500 1500
    assert_eq "nothing was re-owned" "4242:4242" "$(docker exec "$c" stat -c %u:%g /data/foreign)"
  }
}

if [ -z "${SKIP_BUILD:-}" ]; then
  docker build -q -t "$IMAGE" . >/dev/null || exit 2
fi

check_defaults
check_puid_pgid
check_compose_user

printf '\n%s failure(s)\n' "$failures"
[ "$failures" -eq 0 ]
