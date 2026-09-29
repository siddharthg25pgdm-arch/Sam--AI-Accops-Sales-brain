# SAM nightly carding - run by Task Scheduler (task "SamNightlyCarding", daily 07:00 IST).
# PowerShell, not .cmd: a cmd wrapper kills claude.exe with 0xC000013A under Task Scheduler.
# No MCP servers (--strict-mcp-config): the skill talks to Supabase through python, and loading the
# MCP fleet on this 7.7 GB laptop starves a headless run.
$ErrorActionPreference = "Continue"
$repo   = Join-Path $env:USERPROFILE "sam-accops"
$claude = Join-Path $env:USERPROFILE ".local\bin\claude.exe"
$mcp    = Join-Path $env:USERPROFILE ".claude\scripts\sam-nightly-carding.mcp.json"
$logDir = Join-Path $env:USERPROFILE ".claude\logs"
$stamp  = Get-Date -Format "yyyy-MM-dd_HHmm"
$out    = Join-Path $logDir "sam-nightly-carding-$stamp.out"
$err    = Join-Path $logDir "sam-nightly-carding-$stamp.err"
$args = @("-p", "/sam-nightly-carding",
          "--allowedTools", "Bash,Read,Write,Edit,Glob,Grep",
          "--strict-mcp-config", "--mcp-config", "`"$mcp`"")
$p = Start-Process -FilePath $claude -ArgumentList $args -WorkingDirectory $repo -NoNewWindow -Wait -PassThru `
       -RedirectStandardOutput $out -RedirectStandardError $err
Add-Content -Path (Join-Path $logDir "sam-nightly-carding.log") -Value "$(Get-Date -Format o) wrapper exit $($p.ExitCode) (output: $out)"
# Keep two weeks of per-run output.
Get-ChildItem $logDir -Filter "sam-nightly-carding-*.*" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } | Remove-Item -Force
exit $p.ExitCode
