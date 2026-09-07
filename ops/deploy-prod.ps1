[CmdletBinding()]
param(
  [switch]$SkipBuild,
  [switch]$BackendOnly,
  [switch]$FrontendOnly
)

$ErrorActionPreference = 'Stop'

[Console]::Error.WriteLine(@'
LEGACY_PRODUCTION_DEPLOYMENT_DISABLED

This entrypoint previously copied frontend assets and rewrote application files
inside a running backend container. That flow has no immutable release identity,
atomic cutover, migration gate, or verified rollback, so it is permanently disabled.

Do not use this script for production. The only future production path is the
versioned booking.release/v1 contract plus its approved R2/R3 executor.
This repository currently contains read-only contract validation only.
'@)

exit 80
