#!/usr/bin/env bash
# Firewall rules for dedicated DB host (172.28.92.60).
# Allows Postgres (5432) from backend (.57) and optional admin IP for pgAdmin.
#
# Usage (on .60 as root):
#   ADMIN_IP=203.0.113.10 bash deploy/setup-db-firewall.sh
#
# Also mirror these rules in Alibaba Cloud security group for the .60 instance.

set -euo pipefail

BACKEND_HOST="${BACKEND_HOST:-172.28.92.57}"
ADMIN_IP="${ADMIN_IP:-}"

if ! command -v firewall-cmd >/dev/null 2>&1; then
  echo "firewalld not found; configure security group manually:"
  echo "  Allow TCP 5432 from ${BACKEND_HOST}/32"
  [[ -n "$ADMIN_IP" ]] && echo "  Allow TCP 5432 from ${ADMIN_IP}/32"
  exit 0
fi

sudo firewall-cmd --permanent --add-rich-rule="rule family=ipv4 source address=${BACKEND_HOST}/32 port protocol=tcp port=5432 accept"

if [[ -n "$ADMIN_IP" ]]; then
  sudo firewall-cmd --permanent --add-rich-rule="rule family=ipv4 source address=${ADMIN_IP}/32 port protocol=tcp port=5432 accept"
fi

sudo firewall-cmd --reload
echo "Firewall updated on $(hostname). Verify: sudo firewall-cmd --list-rich-rules"
