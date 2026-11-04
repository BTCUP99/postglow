#!/bin/bash
# Cut a release from main:  scripts/release.sh 0.1.6
#
# Checks the tree, runs the tests, sets the version everywhere, turns CHANGELOG's
# "未发布" section into this version, commits, tags, pushes, and creates the GitHub
# release with that section as its notes. CI then builds the DMG and the update feed.
# macOS only (BSD sed); needs git, gh, node, cargo.

set -euo pipefail
cd "$(dirname "$0")/.."

die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
say() { printf '\033[1m%s\033[0m\n' "$*"; }

version="${1:-}"
[[ "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "用法：scripts/release.sh X.Y.Z"
[ "$(git branch --show-current)" = "main" ] || die "请在 main 分支上发布。"
[ -z "$(git status --porcelain)" ] || die "还有未提交的改动，先提交或清理。"
git fetch -q origin
git merge-base --is-ancestor origin/main HEAD || die "本地 main 落后于 origin/main，先 git pull。"
! git rev-parse -q --verify "refs/tags/v${version}" >/dev/null || die "v${version} 已经存在。"

notes="$(awk '/^## 未发布/{on=1; next} /^## /{on=0} on' CHANGELOG.md | sed -e '/./,$!d' | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}')"
[ -n "${notes}" ] || die "CHANGELOG.md 的「未发布」是空的，先写这次改了什么。"

say "这次发布 v${version}，说明："
printf '%s\n\n' "${notes}"
read -r -p "确认发布？[y/N] " answer
[ "${answer}" = "y" ] || die "已取消。"

say "运行测试…"
npm test --silent

say "更新版本号…"
npm version "${version}" --no-git-tag-version --allow-same-version >/dev/null
node -e 'const fs = require("fs"), f = "src-tauri/tauri.conf.json", c = JSON.parse(fs.readFileSync(f)); c.version = process.argv[1]; fs.writeFileSync(f, JSON.stringify(c, null, 2) + "\n");' "${version}"
sed -i '' "1,/^version = /s/^version = \".*\"/version = \"${version}\"/" src-tauri/Cargo.toml
(cd src-tauri && cargo update -p postglow --offline -q)
sed -i '' "s/^## 未发布\$/## 未发布\\
\\
## ${version} — $(date +%F)/" CHANGELOG.md

git add -A
git commit -q -m "Postglow ${version}"
git tag "v${version}"

say "推送并创建 Release…"
git push -q origin main "v${version}"
gh release create "v${version}" --verify-tag --title "Postglow ${version}" --notes "${notes}"

say "完成。接下来："
echo "  1. 等 CI 跑完：gh run watch \$(gh run list -b v${version} -L1 --json databaseId -q '.[0].databaseId')"
echo "  2. 确认更新源：curl -fsSL https://github.com/BTCUP99/postglow/releases/latest/download/latest.json"
echo "  3. 在本机旧版本里点「检查更新」，确认能更新过去。"
