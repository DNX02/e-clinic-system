#!/usr/bin/env bash
set -euo pipefail

source_dir=/opt/e-clinic-source
deploy_key=/home/admin/.ssh/eclinic_repo_deploy
known_hosts=/home/admin/.ssh/known_hosts
lock_file=/run/eclinic-security-audit.lock

exec 9>"$lock_file"
flock -n 9 || exit 0

export GIT_SSH_COMMAND="ssh -i $deploy_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$known_hosts"

git -C "$source_dir" fetch --quiet origin main
target_sha=$(git -C "$source_dir" rev-parse origin/main)
audit_dir=$(mktemp -d /var/tmp/eclinic-security-audit.XXXXXX)
rmdir "$audit_dir"

cleanup() {
  git -C "$source_dir" worktree remove --force "$audit_dir" >/dev/null 2>&1 || true
}
trap cleanup EXIT

git -C "$source_dir" worktree add --quiet --detach "$audit_dir" "$target_sha"

npm --prefix "$audit_dir" ci --omit=dev --ignore-scripts
npm --prefix "$audit_dir" audit --omit=dev --audit-level=high

node --check "$audit_dir/server.js"
node --check "$audit_dir/public/app.js"
node --check "$audit_dir/weekly-monitor-report.js"
npm --prefix "$audit_dir" run test:product
npm --prefix "$audit_dir" run test:ui

for script in "$audit_dir"/scripts/*.sh; do
  bash -n "$script"
done

(
  cd "$audit_dir"
  node scripts/check-secrets.mjs
)

echo "E-Clinic security audit passed for commit $target_sha"
