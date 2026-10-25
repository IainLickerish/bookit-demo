#!/usr/bin/env bash
# Owner-only demo reset (plan 2.5). Closes the SupportAgents App's open sa/* pull requests, deletes the App's sa/*
# branches, and restores the default branch's files to the tag demo-baseline with a new merged commit; history is never
# rewritten. It needs the owner's own GitHub sign-in (an admin of the repository) and must never run on the build
# server (F-42). Afterwards, deploy the printed SHA to staging and production with the deploy workflow.
#
# Usage: scripts/reset-remote.sh --app-login <app>[bot] [--repo owner/name] [--dry-run] [--yes]
set -euo pipefail

repo=IainLickerish/bookit-demo
app_login=""
dry_run=false
assume_yes=false

refuse() {
  echo "Refused: $*" >&2
  exit 1
}

[ "${BASH_VERSINFO[0]}" -ge 5 ] || refuse "this script needs bash 5 or later (for example in WSL or Git Bash)."

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo) repo="${2:-}"; shift 2 ;;
    --app-login) app_login="${2:-}"; shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    --yes) assume_yes=true; shift ;;
    *) refuse "unknown argument $1. Usage: scripts/reset-remote.sh --app-login <app>[bot] [--repo owner/name] [--dry-run] [--yes]" ;;
  esac
done

if [ "${SA_HOST_ROLE:-}" = build ]; then
  refuse "this is the SupportAgents build server (SA_HOST_ROLE=build). Run the reset from your own computer."
fi
[[ "$repo" =~ ^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$ ]] || refuse "--repo must be owner/name."
[[ "$app_login" =~ ^[A-Za-z0-9-]+\[bot\]$ ]] ||
  refuse "--app-login must be the App's bot login, for example supportagents-demo-iainlickerish[bot]."
for tool in gh git jq; do
  command -v "$tool" > /dev/null || refuse "$tool is not installed."
done

details="$(gh api "repos/$repo")" || refuse "cannot read $repo with your GitHub sign-in."
[ "$(jq -r '.permissions.admin // false' <<< "$details")" = true ] ||
  refuse "your GitHub sign-in is not an admin of $repo. Sign in with the owner's own account (gh auth login)."
default_branch="$(jq -r .default_branch <<< "$details")"

# The App's open pull requests from sa/* branches of this repository. Anything else is left alone and listed.
pulls="$(gh api --paginate "repos/$repo/pulls?state=open&per_page=100")"
mapfile -t close_prs < <(jq -r --arg repo "$repo" --arg app "$app_login" \
  '.[] | select(.head.repo.full_name == $repo and (.head.ref | startswith("sa/")) and .user.login == $app) | "\(.number) \(.head.ref)"' <<< "$pulls")
mapfile -t other_prs < <(jq -r --arg repo "$repo" --arg app "$app_login" \
  '.[] | select((.head.ref | startswith("sa/")) and (.head.repo.full_name != $repo or .user.login != $app)) | "\(.number) \(.head.ref) by \(.user.login)"' <<< "$pulls")

# sa/* branches whose tip commit the App authored or committed.
delete_branches=()
other_branches=()
refs="$(gh api --paginate "repos/$repo/git/matching-refs/heads/sa/")"
while read -r ref sha; do
  [ -n "$ref" ] || continue
  branch="${ref#refs/heads/}"
  owners="$(gh api "repos/$repo/commits/$sha" --jq '[.author.login // "", .committer.login // ""] | join(" ")')"
  if [[ " $owners " == *" $app_login "* ]]; then
    delete_branches+=("$branch")
  else
    other_branches+=("$branch (tip $sha by ${owners:-unknown})")
  fi
done < <(jq -r '.[] | "\(.ref) \(.object.sha)"' <<< "$refs")

echo "Demo reset for $repo (default branch $default_branch, App $app_login):"
echo "  Pull requests to close: ${#close_prs[@]}"
for pr in "${close_prs[@]}"; do echo "    #$pr"; done
echo "  Branches to delete: ${#delete_branches[@]}"
for branch in "${delete_branches[@]}"; do echo "    $branch"; done
for pr in "${other_prs[@]}"; do echo "  Left open (not the App's): #$pr"; done
for branch in "${other_branches[@]}"; do echo "  Left in place (not the App's): $branch"; done
echo "  Then restore $default_branch's files to demo-baseline with a new merged commit."

if [ "$dry_run" = true ]; then
  echo "Dry run: nothing was changed."
  exit 0
fi
if [ "$assume_yes" != true ]; then
  read -r -p "Type reset to continue: " answer
  [ "$answer" = reset ] || refuse "not confirmed; nothing was changed."
fi

for pr in "${close_prs[@]}"; do
  gh pr close "${pr%% *}" --repo "$repo" --comment "Closed by the demo reset (scripts/reset-remote.sh)." > /dev/null
  echo "Closed pull request #${pr%% *}."
done
for branch in "${delete_branches[@]}"; do
  gh api -X DELETE "repos/$repo/git/refs/heads/$branch" > /dev/null
  echo "Deleted branch $branch."
done

clone="$(mktemp -d "${TMPDIR:-/tmp}/bookit-reset.XXXXXX")"
gh repo clone "$repo" "$clone" -- --quiet --branch "$default_branch"
git -C "$clone" fetch --quiet origin "refs/tags/demo-baseline:refs/tags/demo-baseline" ||
  refuse "$repo has no tag demo-baseline."
baseline_tree="$(git -C "$clone" rev-parse "demo-baseline^{tree}")"

if [ "$(git -C "$clone" rev-parse "HEAD^{tree}")" = "$baseline_tree" ]; then
  sha="$(git -C "$clone" rev-parse HEAD)"
  echo "$default_branch already has the demo-baseline files."
else
  branch="reset/demo-baseline-$(date -u +%Y%m%dT%H%M%SZ)"
  git -C "$clone" switch --quiet -c "$branch"
  git -C "$clone" read-tree -u --reset demo-baseline
  git -C "$clone" commit --quiet -m "Reset the demo to demo-baseline"
  git -C "$clone" push --quiet origin "$branch"
  url="$(gh pr create --repo "$repo" --base "$default_branch" --head "$branch" \
    --title "Reset the demo to demo-baseline" --body "Restores the files at tag demo-baseline (scripts/reset-remote.sh).")"
  number="${url##*/}"
  gh pr merge "$number" --repo "$repo" --merge --admin
  gh api -X DELETE "repos/$repo/git/refs/heads/$branch" > /dev/null
  sha="$(gh pr view "$number" --repo "$repo" --json mergeCommit --jq .mergeCommit.oid)"
  git -C "$clone" fetch --quiet origin "$default_branch"
  [ "$(git -C "$clone" rev-parse "$sha^{tree}")" = "$baseline_tree" ] ||
    refuse "merge commit $sha does not have the demo-baseline files; check pull request #$number."
  echo "Merged pull request #$number as $sha."
fi

echo "Temporary clone: $clone (delete it when you no longer need it)."
echo "Deploy this SHA once ci on $default_branch has published its image:"
echo "$sha"
echo "Run the deploy workflow with that sha for each product (acme, beacon) to staging, then production."
