[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

[Console]::Error.WriteLine(@'
LEGACY_PRODUCTION_STOP_DISABLED

Stopping the gateway, backend, Redis, and PostgreSQL together is neither a
production release nor a rollback. This unversioned remote control entrypoint
is disabled to prevent accidental outage or data-layer interruption.

Use an explicitly approved incident runbook or the future versioned release
executor. No NAS or container action is performed by this script.
'@)

exit 80
