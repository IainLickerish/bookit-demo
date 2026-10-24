#!/bin/sh
set -eu
# Read the mounted secret while the image entrypoint still runs as
# root. The official entrypoint then drops privileges to postgres; its init
# script consumes and unsets this variable before the final server starts.
BOOKIT_INIT_DB_PASSWORD="$(cat /run/secrets/database_password)"
export BOOKIT_INIT_DB_PASSWORD
exec /usr/local/bin/docker-entrypoint.sh postgres
