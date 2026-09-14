#!/usr/bin/env bash
# process-submissions.sh — Process job-submission GitHub issues nightly
# Submissions are minimal (URL + title + insider info); this script verifies
# the link, dedupes, and stages the job in jobs-staging.json with
# _needsEnrichment for the validation pipeline to scrape (company, level,
# location, comp, description) and promote into jobs.json.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
JOBS_FILE="$REPO_DIR/src/data/jobs.json"
STAGING_FILE="$REPO_DIR/src/data/jobs-staging.json"
REPO="cmonies/design-jobs-cv"

cd "$REPO_DIR"

# Ensure we're on main and up to date
git checkout main 2>/dev/null
git pull --rebase origin main 2>/dev/null || true

# Get open job-submission issues
ISSUES=$(gh issue list --repo "$REPO" --label "job-submission" --state open --json number,title,body --jq '.[] | @base64')

if [ -z "$ISSUES" ]; then
  echo "No open job-submission issues found."
  exit 0
fi

# Helper: extract a **Field:** value from issue body (macOS-compatible, no grep -P)
extract_field() {
  local body="$1"
  local field="$2"
  echo "$body" | python3 -c "
import sys, re
body = sys.stdin.read()
pattern = r'\*\*${field}:\*\*\s*(.+)'
m = re.search(pattern, body)
print(m.group(1).strip() if m else '')
"
}

STAGED_ANY=0

echo "$ISSUES" | while read -r ISSUE_B64; do
  NUMBER=$(echo "$ISSUE_B64" | base64 -d | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['number'])")
  TITLE=$(echo "$ISSUE_B64" | base64 -d | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['title'])")
  BODY=$(echo "$ISSUE_B64" | base64 -d | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['body'])")

  echo "Processing issue #$NUMBER: $TITLE"

  JOB_URL=$(extract_field "$BODY" "Job URL")
  JOB_TITLE_FROM_ISSUE=$(extract_field "$BODY" "Job Title")

  if [ -z "$JOB_URL" ]; then
    echo "  No job URL found in issue #$NUMBER — skipping"
    gh issue comment "$NUMBER" --repo "$REPO" --body "⚠️ Could not find a valid Job URL in this submission. Please make sure the **Job URL** field contains a direct link to the job posting."
    continue
  fi

  echo "  Job URL: $JOB_URL"

  # Duplicate check against live jobs and the staging queue
  if JOBS_FILE="$JOBS_FILE" STAGING_FILE="$STAGING_FILE" JOB_URL="$JOB_URL" python3 - <<'PYEOF'
import json, os, sys
url = os.environ["JOB_URL"]
live = json.load(open(os.environ["JOBS_FILE"]))
try:
    staged = json.load(open(os.environ["STAGING_FILE"]))
except (FileNotFoundError, json.JSONDecodeError):
    staged = []
sys.exit(0 if any(j.get("url") == url for j in live + staged) else 1)
PYEOF
  then
    echo "  URL already listed or staged — closing as duplicate"
    gh issue comment "$NUMBER" --repo "$REPO" --body "This job is already listed (or queued for review)! Closing as duplicate. Thanks for submitting though! 🙏"
    gh issue close "$NUMBER" --repo "$REPO" --reason "not planned"
    continue
  fi

  # Validate that the URL is reachable
  HTTP_STATUS=$(curl -sL -o /dev/null -w "%{http_code}" --max-time 15 "$JOB_URL" 2>/dev/null || echo "000")

  if [ "$HTTP_STATUS" = "000" ] || [ "$HTTP_STATUS" -ge 400 ]; then
    echo "  Job URL returned HTTP $HTTP_STATUS — flagging"
    gh issue comment "$NUMBER" --repo "$REPO" --body "⚠️ The job URL returned HTTP $HTTP_STATUS and may no longer be active. Could you verify the link is correct? If the posting has been taken down, we'll close this issue."
    gh issue label add "needs-review" "$NUMBER" --repo "$REPO" 2>/dev/null || true
    continue
  fi

  # Stage the submission: prefer the machine-readable JSON block, fall back to fields
  STAGING_FILE="$STAGING_FILE" ISSUE_BODY="$BODY" ISSUE_NUMBER="$NUMBER" \
  JOB_URL="$JOB_URL" JOB_TITLE="$JOB_TITLE_FROM_ISSUE" python3 - <<'PYEOF'
import json, os, re
from datetime import date

staging_file = os.environ["STAGING_FILE"]
body = os.environ["ISSUE_BODY"]

entry = None
m = re.search(r"```json\s*(\{.*?\})\s*```", body, re.S)
if m:
    try:
        entry = json.loads(m.group(1))
    except json.JSONDecodeError:
        entry = None

if entry is None:
    # Legacy / hand-written issue: minimal entry from fields
    entry = {
        "title": os.environ["JOB_TITLE"] or "Unknown role",
        "url": os.environ["JOB_URL"],
        "tags": [],
        "_needsEnrichment": True,
    }

entry["_needsEnrichment"] = True
entry["_issueNumber"] = int(os.environ["ISSUE_NUMBER"])
entry["_submittedAt"] = date.today().isoformat()

try:
    staged = json.load(open(staging_file))
except (FileNotFoundError, json.JSONDecodeError):
    staged = []

staged.append(entry)
with open(staging_file, "w") as f:
    json.dump(staged, f, indent=2)
    f.write("\n")

print(f"  Staged: {entry.get('title')} ({entry.get('url')})")
PYEOF

  git add "$STAGING_FILE"
  git commit -m "Stage submission: ${JOB_TITLE_FROM_ISSUE:-$TITLE} (issue #${NUMBER})"

  gh issue comment "$NUMBER" --repo "$REPO" --body "✅ Verified the link and queued this for review! We'll pull the full details from the posting and publish after validation — usually within a day.

The job will appear on [designjobs.cv](https://designjobs.cv/jobs) once it clears the validator."
  gh issue close "$NUMBER" --repo "$REPO"

  echo "  Done processing issue #$NUMBER"
done

# Push all commits at once
git push origin main 2>/dev/null && echo "Pushed to main." || echo "Nothing to push."
