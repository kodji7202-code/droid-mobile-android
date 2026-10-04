# Generates the placeholder launcher/adaptive icons and splash screens for Droid Mobile
# (unofficial branding: a neutral robot glyph, no Factory trademarks). Pure System.Drawing,
# idempotent, safe to re-run after re-branding or adding densities.
#
# Usage (from repo root): powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev\generate-android-icons.ps1
param(
    # Res folder of the Capacitor android app.
    [string]$ResRoot = "$PSScriptRoot\..\..\apps\mobile\android\app\src\main\res"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$ResRoot = (Resolve-Path $ResRoot).Path

# Brand palette: slate background, teal robot.
$bgColor    = [System.Drawing.Color]::FromArgb(255, 0x0F, 0x17, 0x2A)
$glyphColor = [System.Drawing.Color]::FromArgb(255, 0x2D, 0xD4, 0xBF)

# Launcher icon PNG sizes per density (mdpi..xxxhdpi).
$launcherSizes = 48, 72, 96, 144, 192
# Adaptive icon foreground canvas is 108dp: 108/162/216/324/432 px.
$foregroundSizes = 108, 162, 216, 324, 432
$densityDirs = 'mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'
# Splash PNG dimensions as shipped by the Capacitor template (replaced in place).
$splashFiles = [ordered]@{
    'drawable'             = @{ W = 480;  H = 320 }
    'drawable-land-mdpi'   = @{ W = 480;  H = 320 }
    'drawable-land-hdpi'   = @{ W = 800;  H = 480 }
    'drawable-land-xhdpi'  = @{ W = 1280; H = 720 }
    'drawable-land-xxhdpi' = @{ W = 1600; H = 960 }
    'drawable-land-xxxhdpi'= @{ W = 1920; H = 1280 }
    'drawable-port-mdpi'   = @{ W = 320;  H = 480 }
    'drawable-port-hdpi'   = @{ W = 480;  H = 800 }
    'drawable-port-xhdpi'  = @{ W = 720;  H = 1280 }
    'drawable-port-xxhdpi' = @{ W = 960;  H = 1600 }
    'drawable-port-xxxhdpi'= @{ W = 1280; H = 1920 }
}

function New-GraphicsPath([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = 2 * $r
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

# Draws the robot glyph inside the box (x0, y0, size). Eyes and mouth are punched out as
# transparent holes (SourceCopy) so the adaptive monochrome layer keeps the silhouette.
function Draw-Glyph($g, [single]$x0, [single]$y0, [single]$s) {
    $brush = New-Object System.Drawing.SolidBrush($glyphColor)

    $head = New-GraphicsPath ($x0 + 0.06 * $s) ($y0 + 0.24 * $s) (0.88 * $s) (0.62 * $s) (0.14 * $s)
    $g.FillPath($brush, $head)
    $head.Dispose()

    $earL = New-GraphicsPath ($x0 - 0.01 * $s) ($y0 + 0.42 * $s) (0.09 * $s) (0.16 * $s) (0.04 * $s)
    $g.FillPath($brush, $earL)
    $earL.Dispose()
    $earR = New-GraphicsPath ($x0 + 0.92 * $s) ($y0 + 0.42 * $s) (0.09 * $s) (0.16 * $s) (0.04 * $s)
    $g.FillPath($brush, $earR)
    $earR.Dispose()

    $stem = New-GraphicsPath ($x0 + 0.47 * $s) ($y0 + 0.10 * $s) (0.06 * $s) (0.18 * $s) (0.03 * $s)
    $g.FillPath($brush, $stem)
    $stem.Dispose()

    $ballRect = [System.Drawing.RectangleF]::new(($x0 + 0.44 * $s), $y0, (0.12 * $s), (0.12 * $s))
    $g.FillEllipse($brush, $ballRect)

    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $holeBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Transparent)
    foreach ($ex in 0.30, 0.70) {
        $eyeRect = [System.Drawing.RectangleF]::new((($x0 + $ex * $s) - 0.085 * $s), (($y0 + 0.50 * $s) - 0.085 * $s), (0.17 * $s), (0.17 * $s))
        $g.FillEllipse($holeBrush, $eyeRect)
    }
    $mouth = New-GraphicsPath ($x0 + 0.36 * $s) ($y0 + 0.655 * $s) (0.28 * $s) (0.055 * $s) (0.027 * $s)
    $g.FillPath($holeBrush, $mouth)
    $mouth.Dispose()
    $holeBrush.Dispose()
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    $brush.Dispose()
}

function New-Canvas([int]$w, [int]$h) {
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    @{ Bitmap = $bmp; Graphics = $g }
}

function Save-Downscaled($masterBmp, [int]$targetSize, [string]$path) {
    $scaled = New-Canvas $targetSize $targetSize
    $scaled.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $scaled.Graphics.DrawImage($masterBmp, 0, 0, $targetSize, $targetSize)
    $scaled.Bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $scaled.Graphics.Dispose()
    $scaled.Bitmap.Dispose()
    Write-Host "wrote $path ($targetSize x $targetSize)"
}

function Save-Splash([int]$w, [int]$h, [string]$path) {
    $c = New-Canvas $w $h
    $bgBrush = New-Object System.Drawing.SolidBrush($bgColor)
    $c.Graphics.FillRectangle($bgBrush, 0, 0, $w, $h)
    $bgBrush.Dispose()
    $glyphSize = 0.30 * [Math]::Min($w, $h)
    Draw-Glyph $c.Graphics (($w / 2) - ($glyphSize / 2)) (($h / 2) - ($glyphSize / 2)) $glyphSize
    $c.Bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $c.Graphics.Dispose()
    $c.Bitmap.Dispose()
    Write-Host "wrote $path ($w x $h)"
}

# --- Launcher icons (square + round), one master render each, downscaled per density ---
$launcherMaster = New-Canvas 512 512
$bgBrush = New-Object System.Drawing.SolidBrush($bgColor)
$launcherMaster.Graphics.FillRectangle($bgBrush, 0, 0, 512, 512)
Draw-Glyph $launcherMaster.Graphics 64 64 384
for ($i = 0; $i -lt $densityDirs.Count; $i++) {
    $dir = Join-Path $ResRoot ("mipmap-" + $densityDirs[$i])
    Save-Downscaled $launcherMaster.Bitmap $launcherSizes[$i] (Join-Path $dir 'ic_launcher.png')
}
$launcherMaster.Graphics.Dispose()
$launcherMaster.Bitmap.Dispose()

$roundMaster = New-Canvas 512 512
$clip = New-Object System.Drawing.Drawing2D.GraphicsPath
$clip.AddEllipse(0, 0, 512, 512)
$roundMaster.Graphics.Clip = New-Object System.Drawing.Region($clip)
$roundMaster.Graphics.FillRectangle($bgBrush, 0, 0, 512, 512)
Draw-Glyph $roundMaster.Graphics 64 64 384
for ($i = 0; $i -lt $densityDirs.Count; $i++) {
    $dir = Join-Path $ResRoot ("mipmap-" + $densityDirs[$i])
    Save-Downscaled $roundMaster.Bitmap $launcherSizes[$i] (Join-Path $dir 'ic_launcher_round.png')
}
$clip.Dispose()
$roundMaster.Graphics.Dispose()
$roundMaster.Bitmap.Dispose()
$bgBrush.Dispose()

# --- Adaptive foregrounds: glyph in the 66dp safe zone of the 108dp canvas ---
$fgMaster = New-Canvas 432 432
$fgGlyph = 0.56 * 432
Draw-Glyph $fgMaster.Graphics ((432 - $fgGlyph) / 2) ((432 - $fgGlyph) / 2) $fgGlyph
for ($i = 0; $i -lt $densityDirs.Count; $i++) {
    $dir = Join-Path $ResRoot ("mipmap-" + $densityDirs[$i])
    Save-Downscaled $fgMaster.Bitmap $foregroundSizes[$i] (Join-Path $dir 'ic_launcher_foreground.png')
}
$fgMaster.Graphics.Dispose()
$fgMaster.Bitmap.Dispose()

# --- Splash screens ---
foreach ($entry in $splashFiles.GetEnumerator()) {
    $dir = Join-Path $ResRoot $entry.Key
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    Save-Splash $entry.Value.W $entry.Value.H (Join-Path $dir 'splash.png')
}

Write-Host 'icon generation complete'
