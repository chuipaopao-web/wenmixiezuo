#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: activate-v7-static.sh <release-id>" >&2
  exit 64
fi

release_id="$1"
case "$release_id" in
  *[!a-f0-9]*|'') echo "invalid release id" >&2; exit 64 ;;
esac

project_root="/opt/wenmi/current"
release_root="/opt/wenmi/releases"
release_dir="$release_root/versions/$release_id"
current_link="$release_root/current"
previous_link="$release_root/previous"
temporary_link="$release_root/.current-$release_id-$$"

test -d "$release_dir"
node "$project_root/scripts/release/verify-v7-static.mjs" "$release_dir"

mkdir -p "$release_root"
if [ -L "$current_link" ]; then
  previous_target="$(readlink "$current_link")"
  previous_temporary="$release_root/.previous-$$"
  ln -s "$previous_target" "$previous_temporary"
  mv -Tf "$previous_temporary" "$previous_link"
fi

ln -s "versions/$release_id" "$temporary_link"
mv -Tf "$temporary_link" "$current_link"

node "$project_root/scripts/release/verify-v7-static.mjs" "$current_link"
echo "activated V7 static release $release_id"
