#!/bin/sh
# Started as root: align the app user with PUID/PGID, fix ownership of the data
# directories, then exec the command as that user. Started as anyone else
# (compose `user:`): exec the command untouched.
#
# Nothing below may fall back to running the command as root: every failure
# before the final exec ends the container, except a downloads root it can't re-own.
set -eu

APP_USER=telegrarr
MAX_ID=2147483647

log() { echo "telegrarr-entrypoint: $*" >&2; }

die() {
    log "$*"
    exit 1
}

if [ "$(id -u)" -ne 0 ]; then
    exec "$@"
fi

# Leading zeros are refused too, so that 00 can't pass for a non-zero id.
require_unprivileged_id() { # <name> <value>
    case "$2" in
        '' | *[!0-9]* | 0*) die "$1 must be a whole number from 1 to $MAX_ID, got '$2'. Root is refused." ;;
    esac
    if [ "${#2}" -gt "${#MAX_ID}" ] || [ "$2" -gt "$MAX_ID" ]; then
        die "$1 must be a whole number from 1 to $MAX_ID, got '$2'."
    fi
}

# -h and the default -P: a symlink in there is re-owned itself, never its target.
take_ownership() { # <directory>
    mkdir -p "$1" && chown --preserve-root -hR "$PUID:$PGID" "$1"
}

PUID=${PUID:-$(id -u "$APP_USER")}
PGID=${PGID:-$(id -g "$APP_USER")}
DATA_DIR=${TELEARR_DATA_DIR:-/data}
LOG_DIR=${TELEARR_LOG_DIR:-/data/logs}
DOWNLOADS_DIR=${TELEARR_DOWNLOADS_DIR:-/downloads}

require_unprivileged_id PUID "$PUID"
require_unprivileged_id PGID "$PGID"

# -o: the id may already belong to a system user or group (Unraid's 99:100).
if [ "$(id -g "$APP_USER")" != "$PGID" ]; then
    groupmod -o -g "$PGID" "$APP_USER" || die "could not set the app group to $PGID."
fi
if [ "$(id -u "$APP_USER")" != "$PUID" ]; then
    usermod -o -u "$PUID" "$APP_USER" || die "could not set the app user to $PUID."
fi

for dir in "$DATA_DIR" "$LOG_DIR"; do
    take_ownership "$dir" ||
        die "could not take ownership of $dir. Mount it writable, or set compose user: to its owner."
done

# Often shared and huge, so it is only walked when the root itself says it must be.
if [ "$(stat -c %u:%g "$DOWNLOADS_DIR" 2>/dev/null)" != "$PUID:$PGID" ]; then
    take_ownership "$DOWNLOADS_DIR" ||
        log "warning: could not take ownership of $DOWNLOADS_DIR. Transfers fail unless $PUID:$PGID can write there."
fi

exec gosu "$APP_USER" "$@"
