#!/bin/sh
set -eu
# Postgres runs this only when its data volume is empty. App and bootstrap
# passwords are separate secrets; the app is never a database superuser.
psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 <<'SQL'
\getenv bookit_password BOOKIT_INIT_DB_PASSWORD
CREATE ROLE bookit LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'bookit_password';
CREATE DATABASE bookit OWNER bookit;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;
REVOKE CONNECT ON DATABASE bookit FROM PUBLIC;
GRANT CONNECT ON DATABASE bookit TO bookit;
SQL
unset BOOKIT_INIT_DB_PASSWORD
