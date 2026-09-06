#!/bin/sh
set -e

mkdir -p /home/node/.n8n
chown -R node:node /home/node/.n8n

exec busybox su node -c "n8n"
