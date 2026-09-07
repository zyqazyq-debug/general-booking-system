[CmdletBinding()]
param(
  [switch]$SkipBuild,
  [switch]$BackendOnly,
  [switch]$FrontendOnly
)

$ErrorActionPreference = 'Stop'

[Console]::Error.WriteLine(@'
LEGACY_PRODUCTION_DEPLOYMENT_DISABLED

This compatibility entrypoint previously used a duplicate mutable-file
deployment flow. It is disabled because mutable container files cannot prove artifact
identity, support atomic blue/green cutover, or provide a safe rollback.

Do not use this script for production. The only future production path is the
versioned booking.release/v1 contract plus its approved R2/R3 executor.
This repository currently contains read-only contract validation only.
'@)

exit 80
