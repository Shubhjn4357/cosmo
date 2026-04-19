# Bulk rename Nova to Cosmo in all source files
# This script will rename all "Nova" references to "Cosmo" in TypeScript/TSX files

$files = Get-ChildItem -Path "." -Include *.ts,*.tsx,*.json -Recurse -File | 
    Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.FullName -notmatch '\\.git\\' }

$replacements = @(
    @{Old = "Nova AI"; New = "Cosmo AI"}
    @{Old = "Nova App"; New = "Cosmo App"}
    @{Old = "nova-app"; New = "cosmo-app"}
    @{Old = "nova-ai"; New = "cosmo-ai"}
    @{Old = "Nova"; New = "Cosmo"}
    @{Old = "nova"; New = "cosmo"}
    @{Old = "'Nova'"; New = "'Cosmo'"}
    @{Old = '"Nova"'; New = '"Cosmo"'}
    @{Old = "Nova,"; New = "Cosmo,"}
    @{Old = "Nova's"; New = "Cosmo's"}
    @{Old = "Nova:"; New = "Cosmo:"}
)

$totalFiles = 0
$totalReplacements = 0

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $originalContent = $content
    $fileModified = $false
    
    foreach ($replacement in $replacements) {
        if ($content -match [regex]::Escape($replacement.Old)) {
            $content = $content -replace [regex]::Escape($replacement.Old), $replacement.New
            $fileModified = $true
        }
    }
    
    if ($fileModified) {
        Set-Content -Path $file.FullName -Value $content -NoNewline
        $totalFiles++
        Write-Host "Updated: $($file.FullName)" -ForegroundColor Green
    }
}

Write-Host "`n✅ Renaming complete!" -ForegroundColor Cyan
Write-Host "Modified $totalFiles files" -ForegroundColor Yellow
