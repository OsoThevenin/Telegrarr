#!/bin/sh
# Started as root: align the app user with PUID/PGID, fix ownership of the data
# directories, then exec the command as that user. Started as anyone else
# (compose `user:`): exec the command untouched.
set -eu

APP_USER=telegrarr

if [ "$(id -u)" -ne 0 ]; then
    exec "$@"
fi

PUID=${PUID:-$(id -u "$APP_USER")}
PGID=${PGID:-$(id -g "$APP_USER")}
DATA_DIR=${TELEARR_DATA_DIR:-/data}
LOG_DIR=${TELEARR_LOG_DIR:-/data/logs}

# -o: the id may already belong to a system user or group (Unraid's 99:100).
if [ "$(id -g "$APP_USER")" != "$PGID" ]; then
    groupmod -o -g "$PGID" "$APP_USER"
fi
if [ "$(id -u "$APP_USER")" != "$PUID" ]; then
    usermod -o -u "$PUID" "$APP_USER"
fi

mkdir -p "$DATA_DIR" "$LOG_DIR"
chown --preserve-root -hR "$PUID:$PGID" "$DATA_DIR" "$LOG_DIR"

exec gosu "$APP_USER" "$@"
