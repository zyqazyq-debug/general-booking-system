param(
  [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
  [string[]]$Paths
)

$ErrorActionPreference = 'Stop'
$failed = $false

foreach ($pathValue in $Paths) {
  $resolved = Resolve-Path -LiteralPath $pathValue
  $tokens = $null
  $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile(
    $resolved.Path,
    [ref]$tokens,
    [ref]$errors
  )

  foreach ($parseError in $errors) {
    $failed = $true
    Write-Error (
      '{0}:{1}:{2}: {3}' -f
      $resolved.Path,
      $parseError.Extent.StartLineNumber,
      $parseError.Extent.StartColumnNumber,
      $parseError.Message
    ) -ErrorAction Continue
  }
}

if ($failed) {
  exit 1
}

Write-Output ('PowerShell syntax PASS ({0} files)' -f $Paths.Count)
