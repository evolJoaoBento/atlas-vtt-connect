param([switch]$Stop)
$ErrorActionPreference = 'Stop'
$taskServerRoot = $PSScriptRoot
$taskVaultRoot = (Resolve-Path (Join-Path $taskServerRoot '..\..\..')).Path
$taskRuntime = Join-Path $taskServerRoot '.runtime'
$taskConfig = Join-Path $taskRuntime 'server-config.json'
$taskState = Join-Path $taskRuntime 'processes.json'
New-Item -ItemType Directory -Force -Path $taskRuntime | Out-Null

function Stop-AtlasProcesses {
    if (-not (Test-Path -LiteralPath $taskState)) { return }
    $saved = Get-Content -LiteralPath $taskState -Raw | ConvertFrom-Json
    foreach ($item in @($saved.node, $saved.tunnel)) {
        if (-not $item) { continue }
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($item.id)" -ErrorAction SilentlyContinue
        if ($process -and $process.CommandLine -and $process.CommandLine.Contains($item.marker)) {
            Stop-Process -Id $item.id -ErrorAction SilentlyContinue
        }
    }
    Remove-Item -LiteralPath $taskState -Force
}

function Update-AtlasSettings([string]$publicUrl, [string]$privateKey) {
    $taskPluginSettings = Join-Path $taskVaultRoot '.obsidian\plugins\atlas-vtt-connect\data.json'
    if (Test-Path -LiteralPath $taskPluginSettings) {
        $backup = Join-Path $taskRuntime ('settings-before-local-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
        Copy-Item -LiteralPath $taskPluginSettings -Destination $backup
        $data = Get-Content -LiteralPath $taskPluginSettings -Raw | ConvertFrom-Json
        if (-not $data.online) { $data | Add-Member -NotePropertyName online -NotePropertyValue ([pscustomobject]@{}) }
        $data.online | Add-Member -Force -NotePropertyName localRelay -NotePropertyValue ([pscustomobject]@{ url = $publicUrl; adminKey = $privateKey })
        $data.online | Add-Member -Force -NotePropertyName playerPageUrl -NotePropertyValue 'https://joaodlouro.github.io/atlas-vtt-connect/'
        $data | ConvertTo-Json -Depth 50 | Set-Content -LiteralPath $taskPluginSettings -Encoding UTF8
    }
}

if ($Stop) { Stop-AtlasProcesses; Write-Host 'Servidor Atlas e tunel encerrados.'; exit }
if (Test-Path -LiteralPath $taskState) {
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:8787/health' -TimeoutSec 3
        $saved = Get-Content -LiteralPath $taskState -Raw | ConvertFrom-Json
        $tunnel = Get-Process -Id $saved.tunnel.id -ErrorAction SilentlyContinue
        if ($health.ok -and $tunnel) { $taskExisting = Get-Content -LiteralPath $taskConfig -Raw | ConvertFrom-Json; Update-AtlasSettings $saved.publicUrl $taskExisting.adminKey; Write-Host "Servidor ja esta ativo: $($saved.publicUrl)"; exit }
    } catch {}
    Stop-AtlasProcesses
}
$taskNode = (Get-Command node -ErrorAction Stop).Source
$taskCloudflared = Join-Path $taskServerRoot 'bin\cloudflared-windows-amd64.exe'
$taskNodeBundle = Join-Path $taskServerRoot 'relay-server.cjs'
if (-not (Test-Path -LiteralPath $taskCloudflared) -or -not (Test-Path -LiteralPath $taskNodeBundle)) { throw 'Arquivos do servidor incompletos.' }
$taskExpected = Get-Content (Join-Path $taskServerRoot 'bin\cloudflared-source.json') -Raw | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $taskCloudflared -Algorithm SHA256).Hash.ToLower() -ne $taskExpected.sha256) { throw 'O executavel do tunel nao corresponde ao arquivo oficial verificado.' }
if (Test-Path -LiteralPath $taskConfig) { $taskSettings = Get-Content -LiteralPath $taskConfig -Raw | ConvertFrom-Json }
else {
    $taskBytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($taskBytes)
    $taskSettings = [pscustomobject]@{ adminKey = ([BitConverter]::ToString($taskBytes)).Replace('-', '').ToLower(); port = 8787; publicUrl = ''; webDir = (Join-Path $taskServerRoot 'web') }
}
$taskSettings.publicUrl = ''
$taskSettings | ConvertTo-Json | Set-Content -LiteralPath $taskConfig -Encoding UTF8
$env:ATLAS_RELAY_CONFIG = $taskConfig
$taskNodeProcess = Start-Process -FilePath $taskNode -ArgumentList @('"' + $taskNodeBundle + '"') -WorkingDirectory $taskServerRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRuntime 'server.log') -RedirectStandardError (Join-Path $taskRuntime 'server-error.log') -PassThru
try {
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        try { if ((Invoke-RestMethod 'http://127.0.0.1:8787/health' -TimeoutSec 2).ok) { $ready = $true; break } } catch {}
        Start-Sleep -Milliseconds 300
    }
    if (-not $ready) { throw 'O servidor local nao iniciou. Veja .runtime/server-error.log.' }
    $taskEmptyConfig = Join-Path $taskRuntime 'quick-tunnel.yml'
    '# Dedicated Atlas quick tunnel; no account configuration.' | Set-Content -LiteralPath $taskEmptyConfig
    $taskTunnelLog = Join-Path $taskRuntime 'tunnel.log'
    $taskTunnelProcess = Start-Process -FilePath $taskCloudflared -ArgumentList @('tunnel', '--config', ('"' + $taskEmptyConfig + '"'), '--url', 'http://127.0.0.1:8787', '--protocol', 'http2', '--no-autoupdate') -WorkingDirectory $taskServerRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRuntime 'tunnel-out.log') -RedirectStandardError $taskTunnelLog -PassThru
    $publicUrl = $null
    for ($i = 0; $i -lt 90; $i++) {
        if (Test-Path -LiteralPath $taskTunnelLog) {
            $taskUrlMatches = Select-String -LiteralPath $taskTunnelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches
            if ($taskUrlMatches) { $publicUrl = $taskUrlMatches[0].Matches[0].Value + '/'; break }
        }
        if ($taskTunnelProcess.HasExited) { throw 'O tunel nao iniciou. Veja .runtime/tunnel.log.' }
        Start-Sleep -Milliseconds 500
    }
    if (-not $publicUrl) { throw 'Nao foi possivel obter um endereco publico gratuito.' }
    $taskSettings.publicUrl = $publicUrl
    $taskSettings | ConvertTo-Json | Set-Content -LiteralPath $taskConfig -Encoding UTF8
    Update-AtlasSettings $publicUrl $taskSettings.adminKey
    @{ node = @{ id = $taskNodeProcess.Id; marker = $taskNodeBundle }; tunnel = @{ id = $taskTunnelProcess.Id; marker = $taskCloudflared }; publicUrl = $publicUrl } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $taskState -Encoding UTF8
    Write-Host "Servidor pronto: $publicUrl"
    Write-Host 'Entre sessoes, reabra o Obsidian. Inicie a sessao Online e copie o NOVO link completo para seus amigos.'
    Write-Host 'Mantenha este computador ligado. Para encerrar, use PARAR SERVIDOR.cmd.'
} catch {
    Stop-Process -Id $taskNodeProcess.Id -ErrorAction SilentlyContinue
    if ($taskTunnelProcess) { Stop-Process -Id $taskTunnelProcess.Id -ErrorAction SilentlyContinue }
    throw
}
