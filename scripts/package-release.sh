#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 ]]; then
    echo "Usage: $0 <40-character-commit-sha> <output-archive>" >&2
    exit 2
fi

commit_sha=$1
output_archive=$2
if [[ ! "$commit_sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Invalid commit SHA." >&2
    exit 2
fi

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
output_directory=$(dirname -- "$output_archive")
mkdir -p "$output_directory"
output_archive=$(cd -- "$output_directory" && pwd -P)/$(basename -- "$output_archive")
package_root=$(mktemp -d)
trap 'rm -rf -- "$package_root"' EXIT

mkdir -p "$package_root/frontend" "$package_root/ops"
cp -a "$repo_root/frontend/dist" "$package_root/frontend/"
cp "$repo_root/server.js" "$repo_root/database.js" "$repo_root/barcode-registry.js" \
    "$repo_root/session-store.js" "$repo_root/package.json" "$repo_root/package-lock.json" "$package_root/"
cp -a "$repo_root/migrations" "$package_root/"
cp "$repo_root/ops/deploy-release.sh" "$package_root/ops/"
printf '%s\n' "$commit_sha" > "$package_root/RELEASE_SHA"

test -s "$package_root/frontend/dist/index.html"
test -s "$package_root/frontend/dist/sw.js"
test -s "$package_root/frontend/dist/manifest.webmanifest"
test -d "$package_root/frontend/dist/assets"
find "$package_root/frontend/dist/assets" -maxdepth 1 -type f \( -name '*.js' -o -name '*.css' \) -print -quit | grep -q .
test -d "$package_root/frontend/dist/icons"

(
    cd "$package_root"
    npm ci --omit=dev --no-audit --no-fund
    node <<'NODE'
for (const dependency of [
    'bcryptjs', 'better-sqlite3', 'bwip-js', 'dotenv', 'express',
    'express-rate-limit', 'express-session', 'qrcode',
]) {
    require.resolve(dependency);
}
try {
    require.resolve('vite');
    throw new Error('Vite was installed in the production dependency set.');
} catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
}
NODE
)

rm -rf -- "$package_root/node_modules"
if find "$package_root" \( -name node_modules -o -name .env -o -name '.env.*' \
    -o -name '*.sqlite' -o -name '*.sqlite-*' -o -name '*.db' -o -name .git \) \
    -print -quit | grep -q .; then
    echo "Deployment package contains a forbidden environment, database, or dependency directory." >&2
    exit 1
fi

tar -C "$package_root" -czf "$output_archive" .
(
    cd "$output_directory"
    sha256sum "$(basename -- "$output_archive")" > "$(basename -- "$output_archive").sha256"
)

echo "Verified deployment package created."