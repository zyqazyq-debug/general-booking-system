$ErrorActionPreference = "Stop"

param(
  [switch]$SkipBuild,
  [switch]$BackendOnly,
  [switch]$FrontendOnly
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$nasHost = "realzyq@192.168.3.5"
$docker = "sudo /var/packages/ContainerManager/target/usr/bin/docker"

$backendContainer = "booking-prod-backend"
$frontendContainer = "booking-prod-gateway-frontend"

$remoteFrontendDir = "/volume1/homes/realzyq/booking-prod/frontend/dist/build/h5"
$remoteBackendStagingDir = "/volume1/homes/realzyq/booking-prod/backend/dist_staging"

function Invoke-Ssh([string]$command) {
  & ssh $nasHost $command
  if ($LASTEXITCODE -ne 0) {
    throw "SSH command failed: $command"
  }
}

function Require-LocalPath([string]$path, [string]$label) {
  if (-not (Test-Path $path)) {
    throw "$label not found: $path"
  }
}

Write-Host "Preflight: checking prod containers on NAS..."
Invoke-Ssh "$docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | egrep 'booking-prod-(backend|gateway-frontend)' || true"

if (-not $SkipBuild) {
  if (-not $FrontendOnly) {
    Write-Host "Building backend..."
    Push-Location (Join-Path $repoRoot "backend")
    try {
      & npm run build
      if ($LASTEXITCODE -ne 0) { throw "backend build failed" }
    } finally {
      Pop-Location
    }
  }

  if (-not $BackendOnly) {
    Write-Host "Building frontend (H5)..."
    Push-Location (Join-Path $repoRoot "frontend")
    try {
      & npm run build:h5
      if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }
    } finally {
      Pop-Location
    }
  }
}

if (-not $BackendOnly) {
  $localFrontendDir = Join-Path $repoRoot "frontend/dist/build/h5"
  Require-LocalPath $localFrontendDir "Frontend build output"

  $remoteUploadDir = "${remoteFrontendDir}.__upload"

  Write-Host "Deploying frontend files to NAS..."
  Invoke-Ssh "rm -rf '$remoteUploadDir' && mkdir -p '$remoteUploadDir'"

  & tar -czf - -C (Join-Path $repoRoot "frontend/dist/build") "h5" | ssh $nasHost "tar -xzf - -C '$remoteUploadDir'"
  if ($LASTEXITCODE -ne 0) { throw "frontend upload failed" }

  Invoke-Ssh "rm -rf '${remoteFrontendDir}.__prev' && if [ -d '$remoteFrontendDir' ]; then mv '$remoteFrontendDir' '${remoteFrontendDir}.__prev'; fi && mv '$remoteUploadDir/h5' '$remoteFrontendDir' && rmdir '$remoteUploadDir'"
  Invoke-Ssh "$docker restart $frontendContainer"
}

if (-not $FrontendOnly) {
  $localBackendDistDir = Join-Path $repoRoot "backend/dist"
  Require-LocalPath $localBackendDistDir "Backend build output"

  Write-Host "Uploading backend dist to NAS staging..."
  Invoke-Ssh "rm -rf '$remoteBackendStagingDir' && mkdir -p '$remoteBackendStagingDir'"
  & tar -czf - -C (Join-Path $repoRoot "backend") "dist" | ssh $nasHost "tar -xzf - -C '$remoteBackendStagingDir'"
  if ($LASTEXITCODE -ne 0) { throw "backend upload failed" }

  Write-Host "Updating backend container filesystem (docker cp) and restarting..."
  Invoke-Ssh "$docker cp '$remoteBackendStagingDir/dist' $backendContainer:/app/dist_new"
  Invoke-Ssh "$docker exec $backendContainer sh -lc 'rm -rf /app/dist && mv /app/dist_new /app/dist'"
  Invoke-Ssh "$docker restart $backendContainer"
  Invoke-Ssh "$docker inspect $backendContainer --format '{{.State.Health.Status}}'"
}

Write-Host "Done."
