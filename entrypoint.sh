#!/bin/sh
set -e

# No migrations: the only database is the ERP, which MIS never changes.
echo "Starting server..."
exec "$@"
