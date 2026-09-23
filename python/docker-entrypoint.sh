#!/bin/sh
set -e

# Volumes montés par Docker sont root-owned par défaut.
# On corrige la propriété avant de dropper vers l'utilisateur applicatif.
mkdir -p /app/models
chown -R app:app /app/models

exec gosu app "$@"
