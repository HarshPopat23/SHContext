# Alpha packaging and release

The initial candidate is `0.1.0-alpha.1`. npm registry publication remains disabled
with `private: true`; distribution uses a versioned GitHub tarball and source tag.
No public release is created by this PR or `release:pack`.

1. Run `npm ci`, `npm run check`, the quality/real/agent benchmark checks and the
   pinned Claude plugin installation check. Review results and known limitations.
2. Run `npm run release:pack -- /absolute/new/artifact-directory`. It creates an
   npm tarball containing compiled CLI/library, sources for declaration maps,
   skills/plugin, docs, offline walkthrough and freshness helper. It also writes
   a source/version/hash manifest, release notes and `SHA256SUMS`.
3. A fresh consumer installs that tarball with `--ignore-scripts`, runs the
   walkthrough, changes source, updates and verifies. Tests exercise that flow,
   reject overwrite, and compare two unchanged packs under one toolchain.
4. Merge the reviewed PR. Dispatch **Alpha release candidate** on `main`; the
   workflow runs checks and creates artifacts from a clean checkout. Its default
   only uploads artifacts. Select `create_draft` to create an unpublished GitHub
   prerelease draft with those artifacts after checks pass. Only that job receives
   `contents: write`.
5. Inspect draft notes, source SHA, checksums, installation results, evaluation
   reports and blocked live-quality/token/cost work. Publish the alpha explicitly
   when that remaining risk is accepted. Draft creation is not public publication.

The release workflow refuses a non-main dispatch and `--require-clean` refuses
dirty source. It does not publish to npm, merge code, modify generated context or
silently overwrite an existing release. The fixed tag comes from package metadata,
not interpolated user text. Keep plugin versions separate unless their skill
behavior changes. A future release changes package/lock version, notes, examples
and pinning guidance together.

`source_dirty: true` identifies local development artifacts, whose source revision
alone does not identify all bytes. Their tarball hash still identifies the file;
do not promote them as clean reviewed builds. `SHA256SUMS` checks integrity, not
publisher authenticity. Verify source and release origin through the normal GitHub
review process. Dependencies still need installation; this is not a fully offline
or bundled-dependency distribution.

The draft flow uses [GitHub CLI release creation](https://cli.github.com/manual/gh_release_create)
and attaches all assets before explicit public publication. The fixture benchmarks
and source-review controls are alpha evidence, not a claim of production accuracy,
real billing bounds or a stable API.
