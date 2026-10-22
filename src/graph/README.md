# Graph

`buildDependencies` maps every extracted reference to a resolved, external or
unresolved `DependencyEdge`, using only the selected inventory and declared alias
uncertainty. `matchEntryPoints` matches package declarations to exact included
files. No loader, package installation, network, or outside-root access is used.

Only unique included relative candidates resolve. Missing, ambiguous, excluded,
computed, alias and unsupported references retain explicit reasons with null
targets. See [resolution policy](../../docs/code-structure.md#file-resolution-policy).
