#!/usr/bin/env bash
set -euo pipefail

app_dir=/opt/e-clinic-system
source_dir=/opt/e-clinic-source
backup_dir=/opt/e-clinic-deploy-backups
state_dir=/var/lib/eclinic-deploy
state_file="$state_dir/last-successful-sha"
deploy_key=/home/admin/.ssh/eclinic_repo_deploy
known_hosts=/home/admin/.ssh/known_hosts

exec 9>/run/eclinic-auto-deploy.lock
flock -n 9 || exit 0

export GIT_SSH_COMMAND="ssh -i $deploy_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$known_hosts"

git -C "$source_dir" fetch --quiet origin main
target_sha=$(git -C "$source_dir" rev-parse origin/main)
current_sha=$(cat "$state_file" 2>/dev/null || true)

if [[ "$target_sha" == "$current_sha" ]]; then
  exit 0
fi

staging_dir=$(mktemp -d /opt/eclinic-staging.XXXXXX)
case "$staging_dir" in
  /opt/eclinic-staging.*) ;;
  *) echo "Unsafe staging path: $staging_dir" >&2; exit 1 ;;
esac

cleanup() {
  case "$staging_dir" in
    /opt/eclinic-staging.*) rm -rf -- "$staging_dir" ;;
  esac
}
trap cleanup EXIT

git -C "$source_dir" archive "$target_sha" | tar -x -C "$staging_dir"
node --check "$staging_dir/server.js"
node --check "$staging_dir/public/app.js"
npm --prefix "$staging_dir" ci --omit=dev
npm --prefix "$staging_dir" run test:product
npm --prefix "$staging_dir" run test:ui

install -d -m 700 "$backup_dir" "$state_dir"
stamp=$(date -u +%Y%m%d-%H%M%S)
backup="$backup_dir/$stamp.tgz"
tar --exclude='node_modules' --exclude='*.bak-*' -czf "$backup" -C "$app_dir" .

restore_previous_release() {
  tar -xzf "$backup" -C "$app_dir"
  npm --prefix "$app_dir" ci --omit=dev
  systemctl restart e-clinic
}

tar \
  --exclude='./data/db.json' \
  --exclude='./.github' \
  -cf - -C "$staging_dir" . | tar -xf - -C "$app_dir"
chown -R root:root "$app_dir"
chmod 755 "$app_dir"
install -d -o eclinic -g eclinic -m 750 "$app_dir/data" "$app_dir/data/backups"
chown -R eclinic:eclinic "$app_dir/data"
systemctl restart e-clinic

healthy=false
for attempt in 1 2 3 4 5 6; do
  if curl --fail --silent --show-error http://127.0.0.1:3000/api/health >/dev/null; then
    healthy=true
    break
  fi
  sleep 5
done

if [[ "$healthy" != true ]]; then
  restore_previous_release
  exit 1
fi

printf '%s\n' "$target_sha" > "$state_file"

mapfile -t old_backups < <(
  find "$backup_dir" -maxdepth 1 -type f -name '*.tgz' \
    -printf '%T@ %p\n' | sort -nr | tail -n +6 | cut -d' ' -f2-
)
for old_backup in "${old_backups[@]}"; do
  case "$old_backup" in
    "$backup_dir"/*.tgz) rm -- "$old_backup" ;;
    *) echo "Unsafe backup path: $old_backup" >&2; exit 1 ;;
  esac
done

curl --fail --silent --show-error \
  --retry 5 --retry-delay 5 \
  https://doctor.e-clinic-control.ru/api/health >/dev/null

echo "Deployed E-Clinic commit $target_sha"
