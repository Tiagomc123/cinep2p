Set-Location -LiteralPath (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not (Test-Path -LiteralPath '.env') -and (Test-Path -LiteralPath '.env.example')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
    Write-Host 'Crie o .env e cole sua TMDB_API_KEY.' -ForegroundColor Yellow
}
if (-not (Test-Path -LiteralPath 'node_modules')) { npm install }
npm start