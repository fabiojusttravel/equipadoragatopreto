#!/bin/sh
set -e

DB_PATH="./db/gatopreto.db"
SEED_PATH="./db_seed/gatopreto.db"

mkdir -p ./db

if [ ! -f "$DB_PATH" ]; then
  echo "DB not found — copying seed..."
  cp "$SEED_PATH" "$DB_PATH"
  echo "Seed copied successfully."
else
  echo "DB already exists — skipping seed."
fi

exec node server.js
