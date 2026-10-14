# SAM Live: put the production settings into Vercel (project sam-accops). Run it yourself from the repo root:
#   powershell -ExecutionPolicy Bypass -File ops\set-live-env.ps1 [-DownloadUrl <installer link>]
# Secrets are read from where they already live and piped straight to the Vercel CLI - nothing is printed.
#   LIVE_OPENAI_API_KEY  <- OneDrive Desktop\Open_API_key.txt (the sk-... in it)
#   LIVE_FLOW_URL        <- secrets\live-flow.env (Power Automate flow 9 trigger URL, gitignored)
# Re-running replaces the values. Vercel only applies env changes to the NEXT deployment.
param([string]$DownloadUrl = "")

$ErrorActionPreference = "Stop"
$scope = "siddharthg25pgdm-1294s-projects"
$repo = Split-Path $PSScriptRoot -Parent

function Set-VercelEnv([string]$name, [string]$value, [switch]$Sensitive) {
  if (-not $value) { Write-Host "skip $name (no value)"; return }
  # remove first so a re-run replaces the value; ignore "not found"
  & vercel env rm $name production --yes --scope $scope 2>$null | Out-Null
  $extra = @(); if ($Sensitive) { $extra += "--sensitive" }
  $value | & vercel env add $name production @extra --scope $scope 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "vercel env add $name failed (exit $LASTEXITCODE)" }
  Write-Host "set $name"
}

Push-Location $repo
try {
  $keyFile = Join-Path $env:USERPROFILE "OneDrive - Accops Systems Private Limited\Desktop\Open_API_key.txt"
  $key = [regex]::Match((Get-Content $keyFile -Raw), "sk-[A-Za-z0-9_\-]{20,}").Value
  $flow = ((Get-Content (Join-Path $repo "secrets\live-flow.env") -Raw).Trim() -replace "^LIVE_FLOW_URL=", "")

  Set-VercelEnv "LIVE_OPENAI_API_KEY" $key -Sensitive
  Set-VercelEnv "LIVE_FLOW_URL" $flow -Sensitive
  # who gets each rep's post-call email: "<SAM login id>:<email>,..." - add reps here as they get SAM logins
  Set-VercelEnv "LIVE_REP_EMAILS" "siddharth:siddharth.gupta@accops.com"
  # reps not in LIVE_REP_EMAILS: their summary comes here instead of being dropped
  Set-VercelEnv "LIVE_FALLBACK_EMAIL" "siddharth.gupta@accops.com"
  Set-VercelEnv "LIVE_DOWNLOAD_URL" $DownloadUrl

  # CLI deploys from Windows are unreliable for this project (rootDirectory=web, symlink EPERM); a push redeploys
  Write-Host "done - push any commit to main (an empty one is fine) so Vercel redeploys with these values"
} finally { Pop-Location }
