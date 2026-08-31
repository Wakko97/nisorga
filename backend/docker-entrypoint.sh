#!/bin/sh
set -e

echo "Running database migrations (prisma migrate deploy)..."
npx prisma migrate deploy

echo "Starting backend server..."
exec node dist/index.js
