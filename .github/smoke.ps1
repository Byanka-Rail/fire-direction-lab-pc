# 앱을 한 번 켜서 시험 결과(JSON)를 받는다 — 결과는 Actions 주석(notice/error)으로 남긴다
# 사용: smoke.ps1 -Name 이름 -Exe 실행파일 [-UserData 저장폴더]   (UserData 를 비우면 기본 %APPDATA%\FIRE DIRECTION LAB)
param([string]$Name, [string]$Exe, [string]$UserData = '')
$out = Join-Path $env:RUNNER_TEMP "smoke-$Name.json"
Remove-Item $out -ErrorAction SilentlyContinue
$env:FDL_SMOKE = $out
if ($UserData) { $env:FDL_USERDATA = $UserData } else { Remove-Item Env:FDL_USERDATA -ErrorAction SilentlyContinue }
if (-not (Test-Path $Exe)) { Write-Output "::error title=smoke $Name::exe not found: $Exe"; exit 1 }
$p = Start-Process -FilePath $Exe -PassThru
$t = 0
while (-not (Test-Path $out) -and $t -lt 150) { Start-Sleep -Seconds 1; $t++ }
Start-Sleep -Seconds 2
Get-Process | Where-Object { $_.Path -like '*FIRE DIRECTION LAB*' } | Stop-Process -Force -ErrorAction SilentlyContinue
if (-not (Test-Path $out)) { Write-Output "::error title=smoke $Name::no result after ${t}s"; exit 1 }
$j = Get-Content $out -Raw -Encoding utf8 | ConvertFrom-Json
$c = ($j | Select-Object ok, labVersion, eof, storage, origin, startBtn, paint, failLoads, gone, errors, blocked, manifest, manifestError, userData | ConvertTo-Json -Compress -Depth 6)
if ($j.ok) { Write-Output "::notice title=smoke $Name::$c"; exit 0 } else { Write-Output "::error title=smoke $Name::$c"; exit 1 }
