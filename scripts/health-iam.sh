#!/usr/bin/env bash
#
# Grants the health checker's service account read-only Monitoring and Logging
# access across the whole Firebase estate.
#
# The scheduled function runs as its own service account, which no project has
# ever heard of — unlike the local Python CLI, which runs as you and is already
# owner everywhere. That difference is the only reason this script exists.
#
# There is no GCP organization (see plan.md §7), so there is no inherited grant
# to replace these: re-running this script IS the onboarding step for a new
# project. Every command below is idempotent, so re-running is always safe.
#
# Runs as whichever account gcloud has active, which must be the one that owns
# the estate (pantelisstanimeros@gmail.com). Override with ACCOUNT= if needed.
# An account that can't see the projects is caught and reported rather than
# quietly doing nothing.
#
#   ./scripts/health-iam.sh            # dry run — prints what it would do
#   DRY_RUN=0 ./scripts/health-iam.sh  # apply
#   ./scripts/health-iam.sh verify     # show what the SA actually holds
#
set -euo pipefail

ACCOUNT=${ACCOUNT:-$(gcloud config get-value account 2>/dev/null)}
HOST=${HOST:-stanimeros-dev}
SA_ID=${SA_ID:-health-checker}
SA="${SA_ID}@${HOST}.iam.gserviceaccount.com"
DRY_RUN=${DRY_RUN:-1}

# Read-only, all four. None grants access to Firestore documents, Storage
# objects, or any project configuration.
#
# The IAM/API-keys pair backs functions/lib/health/iam.js (sa-key/broad-role/
# api-key findings) and is read-only over *metadata* -- it can see that a key
# exists and whether it's restricted, never a key's secret material. Verify
# the exact permission set with `gcloud iam roles describe <role>` before
# applying broadly; these were picked for being narrowly-scoped predefined
# roles, not hand-verified against every project in the estate.
ESTATE_ROLES=(
  roles/monitoring.viewer
  roles/logging.viewer
  roles/iam.securityReviewer
  roles/serviceusage.apiKeysViewer
)

# Only in the host project: write the reports, and run the billing queries.
HOST_ROLES=(roles/datastore.user roles/bigquery.jobUser)

run() {
  if [ "$DRY_RUN" = 1 ]; then
    echo "  would: $*"
  else
    "$@"
  fi
}

# Everything the account can see, minus the host project — which gets a
# different set of roles below.
estate() {
  gcloud projects list --account="$ACCOUNT" --format='value(projectId)' \
    | grep -v "^${HOST}$" || true
}

# An empty estate means the wrong account is active, not that there is no work.
# Without this the script exits silently having done nothing, which reads
# exactly like success.
require_estate() {
  if [ -z "${1:-}" ]; then
    echo "No projects visible to ${ACCOUNT:-<unset>}." >&2
    echo >&2
    echo "Credentialed accounts:" >&2
    gcloud auth list --format='value(account)' 2>/dev/null | sed 's/^/  /' >&2
    echo >&2
    echo "Re-run with the account that owns the estate, e.g.:" >&2
    echo "  ACCOUNT=<owner-account> $0" >&2
    exit 1
  fi
}

verify() {
  echo "Bindings held by ${SA}:"
  for p in $HOST $(estate); do
    roles=$(gcloud projects get-iam-policy "$p" --account="$ACCOUNT" \
      --flatten='bindings[].members' \
      --filter="bindings.members:serviceAccount:${SA}" \
      --format='value(bindings.role)' 2>/dev/null | paste -sd, -)
    printf '  %-28s %s\n' "$p" "${roles:-(none)}"
  done
}

if [ "${1:-}" = verify ]; then
  require_estate "$(estate)"
  verify
  exit 0
fi

projects=$(estate)
require_estate "$projects"
count=$(echo "$projects" | wc -l | tr -d ' ')

echo "Account:       $ACCOUNT"
echo "Host project:  $HOST"
echo "Service acct:  $SA"
echo "Other projects: $count"
echo "$projects" | sed 's/^/  - /'
echo
# The list comes from whatever the account can see, so a stray project would
# silently get bindings too. Eyeball the count before applying.
if [ "$DRY_RUN" = 1 ]; then
  echo "DRY RUN — nothing will change. Confirm the list above, then re-run with DRY_RUN=0."
  echo
fi

echo "== $HOST (host)"
if ! gcloud iam service-accounts describe "$SA" --account="$ACCOUNT" --project "$HOST" >/dev/null 2>&1; then
  run gcloud iam service-accounts create "$SA_ID" \
      --account="$ACCOUNT" --project "$HOST" \
      --display-name="Firebase health checker" \
      --description="Read-only Monitoring/Logging sweep across the estate" \
      --quiet
else
  echo "  service account already exists"
fi
for role in "${HOST_ROLES[@]}"; do
  run gcloud projects add-iam-policy-binding "$HOST" \
      --account="$ACCOUNT" --member="serviceAccount:${SA}" --role="$role" \
      --condition=None --quiet --format=none
done
# The host project is also one of the 15 swept projects — it needs the same
# read-only Monitoring/Logging access on itself that every other project gets
# below. Without this the sweep 403s on $HOST specifically, which is easy to
# miss because HOST_ROLES above look sufficient at a glance.
for role in "${ESTATE_ROLES[@]}"; do
  run gcloud projects add-iam-policy-binding "$HOST" \
      --account="$ACCOUNT" --member="serviceAccount:${SA}" --role="$role" \
      --condition=None --quiet --format=none
done

# Per-project IAM writes don't contend with each other, so the estate loop
# fans out with xargs. Each worker runs in its own bash -c, which does not
# inherit shell state, so everything the worker needs — the run() helper,
# the roles list, ACCOUNT/SA/DRY_RUN — has to be exported explicitly. Arrays
# can't be exported in bash, hence ESTATE_ROLES flattened to a string.
process_project() {
  local p="$1"
  echo "== $p"
  # Monitoring/Logging reads are per-target-project: with the API off, the API
  # returns 403 rather than zeros, which would read as "healthy" on the
  # dashboard. Almost every project already has both on, and `services enable`
  # is the slow call, so check first and only pay for it when something's
  # actually missing.
  local enabled
  enabled=$(gcloud services list --enabled --project "$p" --account="$ACCOUNT" \
    --filter='config.name:(monitoring.googleapis.com OR logging.googleapis.com)' \
    --format='value(config.name)')
  local n
  n=$(printf '%s\n' "$enabled" | grep -c . || true)
  if [ "$n" -ge 2 ]; then
    echo "  APIs already enabled"
  else
    run gcloud services enable monitoring.googleapis.com logging.googleapis.com \
        --account="$ACCOUNT" --project "$p" --quiet
  fi
  for role in $ESTATE_ROLES_STR; do
    run gcloud projects add-iam-policy-binding "$p" \
        --account="$ACCOUNT" --member="serviceAccount:${SA}" --role="$role" \
        --condition=None --quiet --format=none
  done
}
export ACCOUNT SA DRY_RUN
export ESTATE_ROLES_STR="${ESTATE_ROLES[*]}"
export -f run process_project

# Each worker prints its whole block via one command substitution, so
# parallel output never interleaves mid-project. A worker's own set -e
# stops it at the failing command; xargs then exits nonzero (123) once any
# worker fails, which the pipefail check below turns into a script failure
# that still names the project (the worker echoes FAILED: <p> to stderr).
if ! printf '%s\n' "$projects" | xargs -P 8 -I{} bash -c '
  set -euo pipefail
  if ! out=$(process_project "$1" 2>&1); then
    printf "%s\n" "$out"
    echo "FAILED: $1" >&2
    exit 1
  fi
  printf "%s\n" "$out"
' _ {}; then
  echo "One or more projects failed — see FAILED lines above." >&2
  exit 1
fi

echo
if [ "$DRY_RUN" = 1 ]; then
  echo "Dry run complete. Apply with: DRY_RUN=0 $0"
else
  echo "Done. Check the result with: $0 verify"
fi
