#!/bin/bash
#
# Flatten this repo's bucketed skills into a harness that only scans one level.
#
# pi recurses until it finds a SKILL.md, so `pi.skills: ["./skills"]` picks up
# skills/<bucket>/<skill>/ unaided. Claude Code does not: every immediate child
# of ~/.claude/skills must itself hold a SKILL.md, and a grouping directory is
# simply not descended into — the skills inside it go missing with no error.
# This links each skill in at the depth that harness expects.
#
# Usage:
#   scripts/link-skills.sh [target-dir]        # default: ~/.claude/skills
#   scripts/link-skills.sh --dry-run [target]  # print, change nothing
#   scripts/link-skills.sh --prune [target]    # also drop stale links into this repo

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_DIR="$REPO_ROOT/skills"
BUCKETS=(reference practice workflow meta)

DRY_RUN=0
PRUNE=0
TARGET=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --prune) PRUNE=1 ;;
    -h|--help) sed -n '3,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) TARGET="$arg" ;;
  esac
done

TARGET="${TARGET:-$HOME/.claude/skills}"

if [ ! -d "$SKILLS_DIR" ]; then
  echo "no skills/ directory at $SKILLS_DIR" >&2
  exit 1
fi

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "would: $*"
  else
    "$@"
  fi
}

[ "$DRY_RUN" -eq 1 ] || mkdir -p "$TARGET"

# A bucket linked in whole is the mistake this script exists to undo: it looks
# right, resolves fine, and hides every skill underneath it.
for bucket in "${BUCKETS[@]}"; do
  link="$TARGET/$bucket"
  if [ -L "$link" ] && [ "$(readlink "$link")" = "$SKILLS_DIR/$bucket" ]; then
    run rm "$link"
    echo "unlinked bucket: $bucket"
  fi
done

linked=0
for skill_md in "$SKILLS_DIR"/*/*/SKILL.md; do
  [ -e "$skill_md" ] || continue
  skill_dir="$(dirname "$skill_md")"
  run ln -sfn "$skill_dir" "$TARGET/$(basename "$skill_dir")"
  linked=$((linked + 1))
done

if [ "$linked" -eq 0 ]; then
  echo "found no skills under $SKILLS_DIR/<bucket>/<skill>/SKILL.md" >&2
  exit 1
fi

# A skill that was renamed, re-filed, or retired leaves a link pointing at a
# path that no longer exists. Opt-in, and only ever touches links into this repo.
if [ "$PRUNE" -eq 1 ]; then
  for link in "$TARGET"/*; do
    [ -L "$link" ] || continue
    case "$(readlink "$link")" in
      "$SKILLS_DIR"/*) [ -e "$link" ] || { run rm "$link"; echo "pruned stale link: $(basename "$link")"; } ;;
    esac
  done
fi

echo "linked $linked skills into $TARGET"
