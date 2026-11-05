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
EXIT_TIMEOUT_SECONDS=20
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

assert_logged() { # <container> <text>
  if docker logs "$1" 2>&1 | grep -qF -- "$2"; then
    pass "logs say: $2"
  else
    fail "logs don't say: $2"
    docker logs --tail 5 "$1" 2>&1 | sed 's/^/        /'
  fi
}

assert_contains() { # <what> <text> <actual>
  case "$3" in
    *"$2"*) pass "$1" ;;
    *) fail "$1: expected '$2' in '$3'" ;;
  esac
}

# The container must exit by itself with an error that says why, and uvicorn must
# never have started.
assert_refused() { # <container> <what> <text in its logs>
  local deadline=$((SECONDS + EXIT_TIMEOUT_SECONDS))
  while [ "$(docker inspect -f '{{.State.Running}}' "$1")" = true ] && [ "$SECONDS" -lt "$deadline" ]; do
    sleep 1
  done
  if [ "$(docker inspect -f '{{.State.Running}}' "$1")" = true ]; then
    fail "$2: the container kept running"
    return
  fi
  local code logs
  code=$(docker inspect -f '{{.State.ExitCode}}' "$1")
  logs=$(docker logs "$1" 2>&1)
  if [ "$code" = 0 ]; then fail "$2: exited 0"; else pass "$2: exited $code"; fi
  assert_contains "$2: says why" "$3" "$logs"
  case "$logs" in
    *Uvicorn*) fail "$2: the server started" ;;
  esac
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

check_id_change_on_a_foreign_volume() {
  scenario "an id change re-owns a volume whatever owned it before"
  local v c
  v=$(volume)
  in_volume "$v" 'chown 0:0 /v && touch /v/root-file && mkdir /v/dir && touch /v/dir/x && chown 4242:4242 /v/dir/x'
  c=$(start -e PUID=1100 -e PGID=1200 -v "$v:/data")
  wait_ready "$c" && assert_tree_owned_by "$c" /data 1100 1200
  docker rm -f "$c" >/dev/null
  in_volume "$v" 'touch /v/left-by-root-exec'
  c=$(start -e PUID=1300 -e PGID=1400 -v "$v:/data")
  wait_ready "$c" && {
    assert_app_runs_as "$c" 1300 1400
    assert_tree_owned_by "$c" /data 1300 1400
  }
}

check_symlink_in_data_is_not_followed() {
  scenario "a symlink planted in the data directory doesn't re-own its target"
  local v c
  v=$(volume)
  in_volume "$v" 'ln -s /etc/passwd /v/planted'
  c=$(start -e PUID=1100 -e PGID=1200 -v "$v:/data")
  wait_ready "$c" && {
    assert_eq "/etc/passwd stays root's" "0:0" "$(docker exec "$c" stat -c %u:%g /etc/passwd)"
  }
}

check_restart_keeps_working() {
  scenario "a restarted container comes back with the same ids"
  local c
  c=$(start -e PUID=1100 -e PGID=1200 -v "$(volume):/data")
  wait_ready "$c" && docker restart -t 2 "$c" >/dev/null && wait_ready "$c" && {
    assert_app_runs_as "$c" 1100 1200
    assert_tree_owned_by "$c" /data 1100 1200
  }
}

check_ids_already_taken_in_the_image() {
  scenario "PUID/PGID may collide with ids the image already uses"
  local c
  c=$(start -e PUID=33 -e PGID=100 -v "$(volume):/data")
  wait_ready "$c" && {
    assert_app_runs_as "$c" 33 100
    assert_tree_owned_by "$c" /data 33 100
  }
}

check_downloads_root_with_another_owner() {
  scenario "a downloads root with another owner is re-owned"
  local v c
  v=$(volume)
  in_volume "$v" 'chown 0:0 /v && mkdir -p /v/telegram/tv && touch /v/telegram/tv/old'
  c=$(start -e PUID=1100 -e PGID=1200 -v "$(volume):/data" -v "$v:/downloads")
  wait_ready "$c" && assert_tree_owned_by "$c" /downloads 1100 1200
}

check_downloads_root_already_owned() {
  scenario "a downloads root already owned by PUID:PGID is not walked"
  local v c
  v=$(volume)
  in_volume "$v" 'chown 1100:1200 /v && touch /v/sonarr-file && chown 4242:4242 /v/sonarr-file'
  c=$(start -e PUID=1100 -e PGID=1200 -v "$(volume):/data" -v "$v:/downloads")
  wait_ready "$c" && {
    assert_eq "files below it keep their owner" "4242:4242" \
      "$(docker exec "$c" stat -c %u:%g /downloads/sonarr-file)"
  }
}

check_downloads_root_that_refuses_chown() {
  scenario "a downloads root that can't be re-owned warns and still starts"
  local c
  c=$(start -e PUID=1100 -e PGID=1200 -v "$(volume):/data" -v "$(volume):/downloads:ro")
  wait_ready "$c" && {
    assert_app_runs_as "$c" 1100 1200
    assert_logged "$c" "could not take ownership of /downloads"
  }
}

check_overridden_directories() {
  scenario "the TELEARR_*_DIR overrides are the directories that get owned"
  local c
  c=$(start -e PUID=1100 -e PGID=1200 \
    -e TELEARR_DATA_DIR=/srv/state -e TELEARR_LOG_DIR=/srv/logs -e TELEARR_DOWNLOADS_DIR=/srv/grabs \
    -v "$(volume):/srv/state" -v "$(volume):/srv/grabs")
  wait_ready "$c" && {
    assert_tree_owned_by "$c" /srv/state 1100 1200
    assert_tree_owned_by "$c" /srv/logs 1100 1200
    assert_tree_owned_by "$c" /srv/grabs 1100 1200
  }
}

check_blank_ids_mean_the_defaults() {
  scenario "blank PUID/PGID mean the defaults"
  local c
  c=$(start -e PUID= -e PGID= -v "$(volume):/data")
  wait_ready "$c" && assert_app_runs_as "$c" 1000 1000
}

check_refused_ids() {
  scenario "PUID/PGID that aren't plain non-zero ids stop the container, changing nothing"
  local v c setting
  v=$(volume)
  # Non-empty, or Docker itself copies the image's owner onto the volume on first mount.
  in_volume "$v" 'touch /v/existing && chown -R 4242:4242 /v'
  for setting in PUID=0 PGID=0 PUID=00 PGID=0000 PUID=0100 PUID=root PGID=abc PUID=1000x \
    PUID=-1 PGID=+5 PUID=1.5 "PUID= 1000" PUID=2147483648 PUID=4294967295 PGID=99999999999999999999; do
    c=$(start -e "$setting" -v "$v:/data")
    assert_refused "$c" "$setting" "${setting%%=*} must be a whole number"
  done
  assert_eq "the volume is untouched" "/v 4242:4242
/v/existing 4242:4242" "$(in_volume "$v" 'find /v -printf "%p %U:%G\n" | sort')"
}

check_failed_setup_never_reaches_the_app() {
  scenario "a setup that can't finish ends the container, it doesn't carry on as root"
  local c
  c=$(start --cap-drop SETUID --cap-drop SETGID -v "$(volume):/data")
  assert_refused "$c" "no capability to drop privileges" "failed switching to"
  c=$(start -v "$(volume):/data:ro")
  assert_refused "$c" "read-only data directory" "could not take ownership of /data"
  c=$(start -e TELEARR_DATA_DIR=/)
  assert_refused "$c" "data directory set to /" "could not take ownership of /"
}

check_login_through_the_entrypoint() {
  scenario "compose run ... authorize.py goes through the entrypoint and writes as PUID:PGID"
  local v c
  v=$(volume)
  c=$(start -e PUID=1100 -e PGID=1200 -e TG_API_ID=0 -v "$v:/data" -- python authorize.py)
  assert_refused "$c" "login without credentials" "credentials are missing"
  assert_eq "authorize.py created the database" "1100:1200" "$(in_volume "$v" 'stat -c %u:%g /v/telearr.db')"
  assert_eq "nothing else belongs to anyone else" "" "$(in_volume "$v" 'find /v ! -uid 1100')"
}

check_login_in_a_running_container() {
  scenario "docker exec authorize.py: refused as root, works as the app user"
  local c output
  c=$(start -e PUID=1100 -e PGID=1200 -v "$(volume):/data")
  wait_ready "$c" || return
  if output=$(docker exec "$c" python authorize.py 2>&1); then
    fail "authorize.py ran as root"
  else
    assert_contains "root is told what to run instead" "docker compose run --rm telegrarr" "$output"
  fi
  assert_tree_owned_by "$c" /data 1100 1200
  output=$(docker exec -u telegrarr -e TG_API_ID=0 "$c" python authorize.py 2>&1)
  assert_contains "-u telegrarr gets past the check" "credentials are missing" "$output"
  assert_tree_owned_by "$c" /data 1100 1200
}

if [ -z "${SKIP_BUILD:-}" ]; then
  docker build -q -t "$IMAGE" . >/dev/null || exit 2
fi

check_defaults
check_puid_pgid
check_compose_user
check_id_change_on_a_foreign_volume
check_symlink_in_data_is_not_followed
check_restart_keeps_working
check_ids_already_taken_in_the_image
check_downloads_root_with_another_owner
check_downloads_root_already_owned
check_downloads_root_that_refuses_chown
check_overridden_directories
check_blank_ids_mean_the_defaults
check_refused_ids
check_failed_setup_never_reaches_the_app
check_login_through_the_entrypoint
check_login_in_a_running_container

printf '\n%s failure(s)\n' "$failures"
[ "$failures" -eq 0 ]
