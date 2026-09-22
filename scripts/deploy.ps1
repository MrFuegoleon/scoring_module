#Requires -Version 5.1
<#
.SYNOPSIS
    Orchestrateur Docker pour sc_mod (Windows PowerShell).

.DESCRIPTION
    Fournit une interface unique pour builder, démarrer, arrêter et inspecter
    la stack Docker Compose (frontend + backend + python).

.EXAMPLE
    .\scripts\deploy.ps1 up          # build + démarrage détaché
    .\scripts\deploy.ps1 down        # arrêt (garde les volumes)
    .\scripts\deploy.ps1 logs        # logs live de tous les services
    .\scripts\deploy.ps1 logs backend
    .\scripts\deploy.ps1 status      # état et healthchecks
    .\scripts\deploy.ps1 rebuild     # rebuild sans cache puis up
    .\scripts\deploy.ps1 clean       # down + suppression volumes
    .\scripts\deploy.ps1 shell backend
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('up', 'down', 'restart', 'rebuild', 'logs', 'status', 'ps', 'clean', 'shell', 'check', 'help')]
    [string]$Command = 'help',

    [Parameter(Position = 1)]
    [string]$Service
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

function Write-Section($msg) {
    Write-Host ""
    Write-Host "==> $msg" -ForegroundColor Cyan
}

function Test-Prerequisites {
    Write-Section "Vérification des prérequis"

    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $docker) {
        Write-Host "[X] Docker introuvable." -ForegroundColor Red
        Write-Host "    Installe Docker Desktop : https://www.docker.com/products/docker-desktop/"
        exit 1
    }
    Write-Host "[OK] docker : $((docker --version))" -ForegroundColor Green

    try {
        $composeVersion = docker compose version 2>$null
        if (-not $composeVersion) { throw "compose plugin manquant" }
        Write-Host "[OK] compose : $composeVersion" -ForegroundColor Green
    } catch {
        Write-Host "[X] Plugin 'docker compose' introuvable." -ForegroundColor Red
        exit 1
    }

    try {
        docker info --format '{{.ServerVersion}}' | Out-Null
        Write-Host "[OK] Docker daemon en cours d'exécution" -ForegroundColor Green
    } catch {
        Write-Host "[X] Docker daemon inaccessible. Démarre Docker Desktop." -ForegroundColor Red
        exit 1
    }
}

function Invoke-Up {
    Test-Prerequisites
    Write-Section "Build et démarrage des conteneurs"
    docker compose up -d --build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Write-Section "État des services"
    docker compose ps
    Write-Host ""
    Write-Host "Frontend : http://localhost:8080" -ForegroundColor Green
    Write-Host "Astuce   : .\scripts\deploy.ps1 logs  pour suivre les logs" -ForegroundColor DarkGray
}

function Invoke-Down {
    Write-Section "Arrêt des conteneurs (volumes conservés)"
    docker compose down
}

function Invoke-Restart {
    Write-Section "Redémarrage des conteneurs"
    docker compose restart $Service
}

function Invoke-Rebuild {
    Test-Prerequisites
    Write-Section "Rebuild sans cache"
    docker compose build --no-cache
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Invoke-Up
}

function Invoke-Logs {
    if ($Service) {
        docker compose logs -f --tail=200 $Service
    } else {
        docker compose logs -f --tail=100
    }
}

function Invoke-Status {
    Write-Section "État des conteneurs"
    docker compose ps
    Write-Section "Utilisation ressources"
    docker stats --no-stream $(docker compose ps -q)
}

function Invoke-Clean {
    Write-Section "Nettoyage complet (arrêt + suppression volumes)"
    $confirm = Read-Host "Supprimer TOUS les volumes (uploads, reports) ? [o/N]"
    if ($confirm -eq 'o' -or $confirm -eq 'O') {
        docker compose down -v --remove-orphans
        Write-Host "[OK] Nettoyage terminé" -ForegroundColor Green
    } else {
        Write-Host "Annulé." -ForegroundColor Yellow
    }
}

function Invoke-Shell {
    if (-not $Service) {
        Write-Host "Précise un service : backend, python, frontend" -ForegroundColor Red
        exit 1
    }
    $shell = if ($Service -eq 'python') { 'bash' } else { 'sh' }
    docker compose exec $Service $shell
}

function Show-Help {
    Get-Help $PSCommandPath -Detailed
}

switch ($Command) {
    'up'      { Invoke-Up }
    'down'    { Invoke-Down }
    'restart' { Invoke-Restart }
    'rebuild' { Invoke-Rebuild }
    'logs'    { Invoke-Logs }
    'status'  { Invoke-Status }
    'ps'      { docker compose ps }
    'clean'   { Invoke-Clean }
    'shell'   { Invoke-Shell }
    'check'   { Test-Prerequisites }
    'help'    { Show-Help }
}
