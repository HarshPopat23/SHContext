# Organization freshness checks

Generate and review context locally, then commit the source, selection controls
and `context/` together. Pin the SHContext version used by generation and CI.
The [copyable GitHub Actions example](examples/context-freshness.yml) installs
the alpha tarball after it is publicly released. Before that release, install
the PR's locally packaged tarball or a reviewed source checkout instead; the
example does not pretend the future download URL is already available.
Set the repository variable `SHCONTEXT_ALPHA_SHA256` to the reviewed tarball hash
from `SHA256SUMS`. The job refuses a missing/malformed hash or mismatched download
before installing it. Update the URL and variable together for a new release.

The job checks out the repository, installs the tool under `RUNNER_TEMP`, and
runs the packaged `scripts/ci-freshness.mjs` helper. It does not install or run the
target repository's scripts, call a model, change source/context, or open PRs.
It writes a JSON report outside the repository and a GitHub job summary containing
state, coverage and finding codes. A report-write failure also fails the job.

| Result                                      | Default CI exit | Action                                                                     |
| ------------------------------------------- | --------------: | -------------------------------------------------------------------------- |
| Fresh and complete                          |               0 | Mechanical checks passed; review prose separately                          |
| Fresh and partial                           |               2 | Inspect declared analysis limitations; decide team policy                  |
| Stale                                       |               1 | Refresh affected context locally, review and commit it                     |
| Unknown                                     |               1 | Fix unreadable inputs or unstable selection; rerun                         |
| Invalid/missing output or failed inspection |               1 | Inspect findings and interrupted/ownership state; preserve uncertain files |

If the team explicitly accepts unsupported languages/other declared partial
coverage, add `--allow-partial`. It only changes fresh-partial exit handling;
stale, unknown and invalid still fail. Do not use `continue-on-error` to hide
freshness failures. JSON diagnostics retain affected paths; the summary avoids
rendering repository-controlled paths as Markdown or workflow commands.

Use `pull_request` with read-only permissions, no model keys, and normal checkout.
Do not run PR source under `pull_request_target` with write-capable credentials.
Pin third-party actions and tool artifacts to reviewed versions/commits. For a
source installation, run the same helper with the tool's own prepared dependencies,
outside the analyzed repository. In large organizations, mirror the verified
tarball and dependencies through the approved internal registry/artifact store.

Automatic update PRs are a later opt-in workflow. They need an explicit source
transmission policy, host-managed model key and per-run spending caps; isolate
the generator from untrusted PR scripts, use a dedicated branch and minimal PR
permissions, attach changes/coverage/cost reports, and require human source review.
This release only checks and reports freshness; it does not enable paid scheduled
updates or automatic commits.

The design follows GitHub's [secure workflow guidance](https://docs.github.com/en/actions/reference/security/secure-use)
and its separation of ordinary PR checks from privileged publishing jobs.
