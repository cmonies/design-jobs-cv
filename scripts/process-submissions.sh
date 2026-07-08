#!/usr/bin/env bash
# process-submissions.sh — Process job-submission GitHub issues nightly
# Checks for open issues with "job-submission" label, scrapes the job URL,
# extracts accurate data, adds to jobs.json, commits, and closes the issue.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
JOBS_FILE="$REPO_DIR/src/data/jobs.json"
REPO="cmonies/healthcare-jobs"

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

# Helper: extract a field from issue body using Python (macOS-compatible, no grep -P)
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

echo "$ISSUES" | while read -r ISSUE_B64; do
  NUMBER=$(echo "$ISSUE_B64" | base64 -d | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['number'])")
  TITLE=$(echo "$ISSUE_B64" | base64 -d | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['title'])")
  BODY=$(echo "$ISSUE_B64" | base64 -d | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['body'])")

  echo "Processing issue #$NUMBER: $TITLE"

  # Extract fields using Python (macOS-compatible)
  JOB_URL=$(extract_field "$BODY" "Job URL")
  COMPANY=$(extract_field "$BODY" "Company")
  COMPANY_URL=$(extract_field "$BODY" "Company URL")
  LEVEL=$(extract_field "$BODY" "Level")
  LOCATION_TYPE=$(extract_field "$BODY" "Location Type")
  EMPLOYMENT_TYPE=$(extract_field "$BODY" "Employment Type")
  VERTICAL=$(extract_field "$BODY" "Vertical")
  LOCATION=$(extract_field "$BODY" "Location")
  TAGS=$(extract_field "$BODY" "Tags")
  JOB_TITLE_FROM_ISSUE=$(extract_field "$BODY" "Job Title")
  # Defaults for older submissions that predate these fields
  [ -z "$EMPLOYMENT_TYPE" ] && EMPLOYMENT_TYPE="Full-time"
  [ -z "$VERTICAL" ] && VERTICAL="Other"

  if [ -z "$JOB_URL" ]; then
    echo "  No job URL found in issue #$NUMBER — skipping"
    gh issue comment "$NUMBER" --repo "$REPO" --body "⚠️ Could not find a valid Job URL in this submission. Please make sure the **Job URL** field contains a direct link to the job posting."
    continue
  fi

  echo "  Job URL: $JOB_URL"

  # Check if URL is already in jobs.json
  if python3 -c "import json; data=json.load(open('$JOBS_FILE')); exit(0 if any(j['url']=='$JOB_URL' for j in data) else 1)" 2>/dev/null; then
    echo "  URL already exists in jobs.json — closing as duplicate"
    gh issue comment "$NUMBER" --repo "$REPO" --body "This job is already listed on the site! Closing as duplicate. Thanks for submitting though! 🙏"
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

  # Generate ID from title and company
  JOB_ID=$(echo "${COMPANY}-${JOB_TITLE_FROM_ISSUE}" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')

  # Check for ID collision and make unique
  if python3 -c "import json; data=json.load(open('$JOBS_FILE')); exit(0 if any(j['id']=='$JOB_ID' for j in data) else 1)" 2>/dev/null; then
    JOB_ID="${JOB_ID}-$(date +%s | tail -c 5)"
  fi

  TODAY=$(date +%Y-%m-%d)

  # Format tags as JSON array
  if [ -z "$TAGS" ] || [ "$TAGS" = "N/A" ]; then
    TAGS_JSON="[]"
  else
    TAGS_JSON=$(echo "$TAGS" | python3 -c "import sys,json; print(json.dumps([t.strip() for t in sys.stdin.read().strip().split(',') if t.strip()]))")
  fi

  # Add to jobs.json
  JOBS_FILE="$JOBS_FILE" JOB_ID="$JOB_ID" JOB_TITLE="$JOB_TITLE_FROM_ISSUE" \
  COMPANY="$COMPANY" COMPANY_URL="$COMPANY_URL" LEVEL="$LEVEL" \
  LOCATION_TYPE="$LOCATION_TYPE" LOCATION="$LOCATION" JOB_URL="$JOB_URL" \
  EMPLOYMENT_TYPE="$EMPLOYMENT_TYPE" VERTICAL="$VERTICAL" \
  TODAY="$TODAY" TAGS_JSON="$TAGS_JSON" python3 - <<'PYEOF'
import json, os

jobs_file = os.environ["JOBS_FILE"]
with open(jobs_file, "r") as f:
    jobs = json.load(f)

new_job = {
    "id": os.environ["JOB_ID"],
    "title": os.environ["JOB_TITLE"],
    "company": os.environ["COMPANY"],
    "companyUrl": os.environ["COMPANY_URL"],
    "level": os.environ["LEVEL"],
    "locationType": os.environ["LOCATION_TYPE"],
    "location": os.environ["LOCATION"],
    "url": os.environ["JOB_URL"],
    "postedAt": os.environ["TODAY"],
    "employmentType": os.environ["EMPLOYMENT_TYPE"],
    "vertical": os.environ["VERTICAL"],
    "tags": json.loads(os.environ["TAGS_JSON"]),
}

# Add at the beginning (newest first)
jobs.insert(0, new_job)

with open(jobs_file, "w") as f:
    json.dump(jobs, f, indent=2)
    f.write("\n")

print(f"  Added: {new_job['title']} at {new_job['company']}")
PYEOF

  # Commit and push
  git add "$JOBS_FILE"
  git commit -m "Add: ${JOB_TITLE_FROM_ISSUE} at ${COMPANY} (issue #${NUMBER})"

  # Close the issue with confirmation
  gh issue comment "$NUMBER" --repo "$REPO" --body "✅ Added to the site! Thanks for the submission 🎉

**Listed as:**
- **Title:** $JOB_TITLE_FROM_ISSUE
- **Company:** $COMPANY
- **Level:** $LEVEL
- **Location:** $LOCATION ($LOCATION_TYPE)

The job should appear on [health.designjobs.cv](https://health.designjobs.cv) after the next deploy."
  gh issue close "$NUMBER" --repo "$REPO"

  echo "  Done processing issue #$NUMBER"
done

# Push all commits at once
git push origin main 2>/dev/null && echo "Pushed to main." || echo "Nothing to push."
