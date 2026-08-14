$ErrorActionPreference = "Stop"

$nasHost = "realzyq@192.168.3.5"
$docker = "sudo /var/packages/ContainerManager/target/usr/bin/docker"

$containers = @(
  "booking-prod-gateway-frontend",
  "booking-prod-backend",
  "booking-prod-redis",
  "booking-prod-postgres"
)

& ssh $nasHost "$docker stop $($containers -join ' ')"
if ($LASTEXITCODE -ne 0) {
  throw "Failed to stop prod containers"
}
