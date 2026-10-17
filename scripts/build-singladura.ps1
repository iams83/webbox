[CmdletBinding()]
param(
    [string]$SingladuraPath,
    [string]$OutputPath,
    [switch]$InstallDependencies
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

try {
    $webboxPath = Split-Path -Parent $PSScriptRoot
    if (-not $SingladuraPath) { $SingladuraPath = Join-Path $webboxPath '..\singladura' }
    if (-not $OutputPath) { $OutputPath = Join-Path $webboxPath 'dist' }
    $sourcePath = [IO.Path]::GetFullPath($SingladuraPath)
    $destinationPath = [IO.Path]::GetFullPath($OutputPath)
    $npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
    $null = Get-Command node -ErrorAction Stop

    if (-not (Test-Path -LiteralPath (Join-Path $sourcePath 'scripts\build-offline.cjs') -PathType Leaf)) {
        throw "No se encuentra el proyecto Singladura en: $sourcePath. Usa -SingladuraPath para indicar su carpeta."
    }

    function Invoke-ProjectNpm {
        param([string]$ProjectPath, [string[]]$NpmArguments)
        & $npmCommand --prefix $ProjectPath @NpmArguments
        if ($LASTEXITCODE -ne 0) {
            throw "npm $($NpmArguments -join ' ') ha fallado en $ProjectPath (codigo $LASTEXITCODE)."
        }
    }

    $webboxDependencies = @(
        (Join-Path $webboxPath 'node_modules\electron\dist\electron.exe'),
        (Join-Path $webboxPath 'node_modules\electron-builder\package.json'),
        (Join-Path $webboxPath 'node_modules\ajv\package.json')
    )
    $missingWebboxDependencies = @($webboxDependencies | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) })
    if ($InstallDependencies -or $missingWebboxDependencies.Count -gt 0) {
        Write-Host 'Instalando dependencias de WebBox...'
        Invoke-ProjectNpm -ProjectPath $webboxPath -NpmArguments @('ci')
    }
    if ($InstallDependencies -or -not (Test-Path -LiteralPath (Join-Path $sourcePath 'node_modules\esbuild\package.json') -PathType Leaf)) {
        Write-Host 'Instalando dependencias de Singladura...'
        Invoke-ProjectNpm -ProjectPath $sourcePath -NpmArguments @('ci')
    }

    Write-Host 'Generando el HTML estatico de Singladura...'
    Invoke-ProjectNpm -ProjectPath $sourcePath -NpmArguments @('run', 'build')

    Write-Host 'Generando el ejecutable portable Windows x64...'
    Invoke-ProjectNpm -ProjectPath $webboxPath -NpmArguments @(
        'run', 'package:static', '--', (Join-Path $sourcePath 'singladura.html'),
        '--name', 'Singladura', '--output', $destinationPath
    )

    $version = (Get-Content -LiteralPath (Join-Path $webboxPath 'package.json') -Raw | ConvertFrom-Json).version
    $executable = Join-Path $destinationPath "singladura-$version-win-x64.exe"
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
        throw "No se ha generado el ejecutable esperado: $executable"
    }
    Write-Host "Ejecutable listo: $executable"
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
