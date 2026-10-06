# DroidMobileHelper: PC-side helper for the Droid Mobile app (Windows PowerShell 5.1+).
# Import with: Import-Module <repo>\tools\pc-helper\DroidMobileHelper.psd1

$script:DhModuleRoot = $PSScriptRoot

# Loaded eagerly: an implicit import triggered under -WhatIf would print "Set Alias" noise.
Import-Module CimCmdlets -ErrorAction Stop

. (Join-Path $PSScriptRoot 'lib\Common.ps1')
. (Join-Path $PSScriptRoot 'lib\Daemon.ps1')
. (Join-Path $PSScriptRoot 'lib\Tailscale.ps1')
. (Join-Path $PSScriptRoot 'lib\Pairing.ps1')
. (Join-Path $PSScriptRoot 'lib\Hooks.ps1')
. (Join-Path $PSScriptRoot 'lib\Doctor.ps1')

Export-ModuleMember -Function @(
  'Start-DroidDaemon',
  'Stop-DroidDaemon',
  'Enable-TailscaleServe',
  'Disable-TailscaleServe',
  'New-PairingCode',
  'Install-DroidHooks',
  'Uninstall-DroidHooks',
  'Get-DroidDoctor'
) -Alias 'Doctor'
