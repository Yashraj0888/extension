<#
  Builds a clean Chrome Web Store upload zip and runs pre-flight checks.

  Usage (from the repo root):   powershell -ExecutionPolicy Bypass -File scripts\package.ps1
  Output:                       dist\aftermeet-<version>.zip
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$errors = New-Object System.Collections.Generic.List[string]
function Fail($msg) { $script:errors.Add($msg); Write-Host "  [FAIL] $msg" -ForegroundColor Red }
function Ok($msg)   { Write-Host "  [ OK ] $msg" -ForegroundColor Green }

Write-Host "Pre-flight checks" -ForegroundColor Cyan
$manifest = Get-Content manifest.json -Raw | ConvertFrom-Json

# --- Manifest basics -------------------------------------------------------
if ($manifest.manifest_version -ne 3) { Fail "manifest_version must be 3" } else { Ok "Manifest V3" }
if ($manifest.name.Length -gt 75) { Fail "name is $($manifest.name.Length) chars (max 75)" } else { Ok "name length $($manifest.name.Length)/75" }
if ($manifest.description.Length -gt 132) { Fail "description is $($manifest.description.Length) chars (max 132)" } else { Ok "description length $($manifest.description.Length)/132" }
if ($manifest.version -notmatch '^\d+(\.\d+){0,3}$') { Fail "version '$($manifest.version)' is not a valid Chrome version" } else { Ok "version $($manifest.version)" }

# --- Referenced files exist ------------------------------------------------
$refs = @()
$refs += $manifest.icons.PSObject.Properties.Value
$refs += $manifest.action.default_icon.PSObject.Properties.Value
$refs += $manifest.action.default_popup, $manifest.options_ui.page, $manifest.background.service_worker
foreach ($cs in $manifest.content_scripts) { $refs += $cs.js; $refs += $cs.css }
$missing = $refs | Where-Object { $_ -and -not (Test-Path $_) }
if ($missing) { $missing | ForEach-Object { Fail "manifest references missing file: $_" } } else { Ok "all manifest-referenced files exist" }

# --- MV3 / policy hygiene ---------------------------------------------------
$pages = Get-ChildItem -Recurse -Include *.html -File | Where-Object { $_.FullName -notmatch '\\(\.git|dist|node_modules)\\' }
foreach ($p in $pages) {
  $text = Get-Content $p.FullName -Raw
  if ($text -match '<script(?![^>]*\bsrc=)[^>]*>') { Fail "inline <script> in $($p.Name) (blocked by MV3 CSP)" }
  if ($text -match '<script[^>]+src=["'']https?:') { Fail "remote <script> in $($p.Name) (remote hosted code is prohibited)" }
  if ($text -match '\son[a-z]+\s*=\s*["'']') { Fail "inline event handler attribute in $($p.Name) (blocked by MV3 CSP)" }
}
if (-not ($errors | Where-Object { $_ -match 'inline|remote' })) { Ok "no inline/remote scripts in HTML pages" }

$jsFiles = Get-ChildItem -Recurse -Include *.js -File | Where-Object { $_.FullName -notmatch '\\(\.git|dist|node_modules|scripts)\\' }
$remoteCode = $jsFiles | Select-String -Pattern '\beval\s*\(|new Function\s*\(|importScripts\s*\(\s*["'']https?:|import\s*\(\s*["'']https?:' 
if ($remoteCode) { $remoteCode | ForEach-Object { Fail "possible remote/dynamic code: $($_.Path):$($_.LineNumber)" } } else { Ok "no eval / remote code loading" }

$secrets = $jsFiles | Select-String -Pattern 'AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9]{32,}|sk-ant-[A-Za-z0-9_-]{20,}|GOCSPX-[A-Za-z0-9_-]+'
if ($secrets) { $secrets | ForEach-Object { Fail "possible hardcoded secret: $($_.Path):$($_.LineNumber)" } } else { Ok "no hardcoded API keys/secrets" }

$remoteCss = Get-ChildItem -Recurse -Include *.css,*.html -File | Where-Object { $_.FullName -notmatch '\\(\.git|dist)\\' } |
  Select-String -Pattern 'fonts\.googleapis\.com|@import\s+url\(\s*["'']?https?:'
if ($remoteCss) { $remoteCss | ForEach-Object { Fail "remote stylesheet/font reference: $($_.Path):$($_.LineNumber)" } } else { Ok "no remote fonts/stylesheets" }

if ($errors.Count -gt 0) { Write-Host "`n$($errors.Count) problem(s) found. Fix them before uploading." -ForegroundColor Red; exit 1 }

# --- Build zip --------------------------------------------------------------
Write-Host "`nBuilding package" -ForegroundColor Cyan
$excludeDirs  = @('.git', '.github', 'dist', 'scripts', 'node_modules')
$excludeNames = @('.gitignore', '.env', '.env.example', 'LICENSE')
$excludeExt   = @('.md', '.bak', '.log', '.map', '.pem', '.crx', '.zip', '.ps1')

$files = Get-ChildItem -Recurse -File -Force | Where-Object {
  $rel = $_.FullName.Substring($root.Length + 1)
  $top = ($rel -split '\\')[0]
  ($excludeDirs -notcontains $top) -and
  ($excludeNames -notcontains $_.Name) -and
  ($excludeExt -notcontains $_.Extension.ToLower()) -and
  (-not $_.Name.StartsWith('.'))
}

New-Item -ItemType Directory -Force dist | Out-Null
$zipPath = Join-Path $root "dist\aftermeet-$($manifest.version).zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($f in $files) {
    $entry = $f.FullName.Substring($root.Length + 1).Replace('\', '/')   # forward slashes required
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $entry, [System.IO.Compression.CompressionLevel]::Optimal)
  }
} finally { $zip.Dispose() }

$sizeKb = [math]::Round((Get-Item $zipPath).Length / 1KB)
Write-Host "  $($files.Count) files, $sizeKb KB -> $zipPath" -ForegroundColor Green
