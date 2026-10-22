# Repository fixtures

`simple-repository/` is a tiny JS/TS analysis input for the scanner/parser
milestones. It is data, not part of the SHContext build or test discovery.
Fixtures are excluded from formatting so later malformed-input examples can
retain their exact bytes. Add expected inventory and reference assertions when
those features are implemented; this foundation does not claim to analyze it.

`scanner/repository/` is copied to temporary ordinary directories; the adjacent
`scanner/expected.json` defines every expected path/reason. Some intentionally
ignored files are committed to test pruning. Tests create Git indexes, binary
bytes, symlinks, permission failures and special files in temporary directories
so these platform-specific cases do not depend on Git checkout permissions.
