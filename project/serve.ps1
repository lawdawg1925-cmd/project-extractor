# Minimal static file server for Project Extractor (no Python needed). Serves ./app only.
param([int]$Port = 8765, [switch]$Lan)
$root = Join-Path $PSScriptRoot 'app'
$prefix = if ($Lan) { "http://+:$Port/" } else { "http://localhost:$Port/" }
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.mjs'='text/javascript'; '.css'='text/css';
  '.png'='image/png'; '.json'='application/json'; '.webmanifest'='application/manifest+json'; '.wasm'='application/wasm'; '.gz'='application/octet-stream' }
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add($prefix)
try { $l.Start() } catch { Write-Host "Could not start server on port $Port. For phone (LAN) mode run this window as Administrator once, or install Python."; Read-Host 'Press Enter'; exit 1 }
Write-Host "Project Extractor running at http://localhost:$Port/  (close this window to stop)"
if (-not $Lan) { Start-Process "http://localhost:$Port/index.html" }
while ($l.IsListening) {
  $ctx = $l.GetContext()
  $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
  if ($path -eq '') { $path = 'index.html' }
  $file = [IO.Path]::GetFullPath((Join-Path $root $path))
  if ($file.StartsWith($root) -and (Test-Path $file -PathType Leaf)) {
    $ext = [IO.Path]::GetExtension($file).ToLower()
    $ctx.Response.ContentType = if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' }
    $bytes = [IO.File]::ReadAllBytes($file)
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else { $ctx.Response.StatusCode = 404 }
  $ctx.Response.Close()
}
