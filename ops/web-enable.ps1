# Switch on the website chatbot's server side (stage 1). Run it yourself:
#   powershell -ExecutionPolicy Bypass -File ops\web-enable.ps1
# It asks for two values from the Supabase dashboard (never shown on screen, never written to disk except
# Vercel's encrypted env), mints the sam_web_reader key, PROVES it can read only public data, generates the
# other secrets, and saves everything to Vercel (production + preview). Then tell Claude "redeploy".
# Visitors still see nothing: the chat only appears on a page that loads embed.js (the Citrix LP change,
# not deployed until you OK it), and only approved Q&A pairs can answer.
# Undo: Vercel > sam-accops > Settings > Environment Variables > delete WEB_CHAT_ENABLED, then redeploy.

$ErrorActionPreference = "Stop"
$Supabase = "https://iwqhayuoxnrhqzozznes.supabase.co"
$Project  = "prj_2ZQ8w1taUumsx6qvN6xtYUwkyCRH"
$Team     = "team_yhhGqbl6aKYO5n08RJDlwiPn"

function Read-Secret($prompt) {
  $s = Read-Host -AsSecureString $prompt
  [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)).Trim()
}
function B64Url([byte[]]$b) { [Convert]::ToBase64String($b).TrimEnd('=').Replace('+','-').Replace('/','_') }
function RandomSecret { $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); B64Url $b }

Write-Host "Supabase dashboard > Project Settings > JWT Keys (or API) > 'Legacy JWT secret'." -ForegroundColor Cyan
$jwtSecret = Read-Secret "Paste the JWT secret"
Write-Host "Supabase dashboard > Project Settings > API Keys > 'Publishable key' (sb_publishable_...) or the legacy anon key." -ForegroundColor Cyan
$apikey = Read-Secret "Paste the publishable key"

# 1. Mint an HS256 JWT for role sam_web_reader, valid one year.
$now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$enc = [Text.Encoding]::UTF8
$head = B64Url $enc.GetBytes('{"alg":"HS256","typ":"JWT"}')
$body = B64Url $enc.GetBytes("{""role"":""sam_web_reader"",""iss"":""supabase"",""iat"":$now,""exp"":$($now + 31536000)}")
$hmac = New-Object Security.Cryptography.HMACSHA256 (,$enc.GetBytes($jwtSecret))
$jwt = "$head.$body." + (B64Url $hmac.ComputeHash($enc.GetBytes("$head.$body")))
$jwtSecret = $null

# 2. Prove the key: public view readable, an internal table refused.
$h = @{ apikey = $apikey; Authorization = "Bearer $jwt" }
try { Invoke-RestMethod "$Supabase/rest/v1/sam_web_assets_public?select=title&limit=1" -Headers $h | Out-Null; Write-Host "OK  reader can read the public view" -ForegroundColor Green }
catch { Write-Host "STOP: the key can't read the public view. Wrong secret, or the project uses new signing keys only (tell Claude)." -ForegroundColor Red; exit 1 }
$denied = $false
try { Invoke-RestMethod "$Supabase/rest/v1/sam_asset_cards?select=title&limit=1" -Headers $h | Out-Null } catch { $denied = $true }
if (-not $denied) { Write-Host "STOP: the key can read internal cards. Do not continue; tell Claude." -ForegroundColor Red; exit 1 }
Write-Host "OK  reader is refused on internal cards" -ForegroundColor Green

# 3. Save to Vercel (encrypted), using the Vercel CLI's own login.
$tok = (Get-Content "$env:APPDATA\com.vercel.cli\Data\auth.json" -Raw | ConvertFrom-Json).token
$evalToken = RandomSecret
$vars = [ordered]@{
  SAM_WEB_READER_JWT      = $jwt
  SAM_WEB_SUPABASE_APIKEY = $apikey
  WEB_IP_SALT             = (RandomSecret)
  WEB_HS_SECRET           = (RandomSecret)
  WEB_EVAL_TOKEN          = $evalToken
  WEB_EMBED_ORIGINS       = "https://accops-citrix-lp.vercel.app"
  SUPABASE_URL            = $Supabase
  WEB_CHAT_ENABLED        = "1"
}
foreach ($k in $vars.Keys) {
  $payload = @{ key = $k; value = $vars[$k]; type = "encrypted"; target = @("production", "preview") } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Post "https://api.vercel.com/v10/projects/$Project/env?upsert=true&teamId=$Team" `
    -Headers @{ Authorization = "Bearer $tok" } -ContentType "application/json; charset=utf-8" `
    -Body ([Text.Encoding]::UTF8.GetBytes($payload)) | Out-Null
  Write-Host "OK  $k saved"
}

# 4. Keep the eval token locally (gitignored) so Claude can run the visitor eval against production.
Add-Content -Path "$PSScriptRoot\..\web\.env.local" -Value "`nWEB_EVAL_TOKEN=$evalToken" -Encoding ascii
Write-Host ""
Write-Host "Done. Tell Claude: redeploy and run the website eval." -ForegroundColor Green
