@{
  RootModule            = 'DroidMobileHelper.psm1'
  ModuleVersion         = '0.1.0'
  GUID                  = '4b0f3c1e-6a52-4c0e-9a3b-2d5f7e8c1a90'
  Author                = 'Droid Mobile'
  Description           = 'PC-side helper for the Droid Mobile app: supervised droid daemon, Tailscale Serve, pairing codes, Droid hooks, doctor.'
  PowerShellVersion     = '5.1'
  FunctionsToExport     = @(
    'Start-DroidDaemon',
    'Stop-DroidDaemon',
    'Enable-TailscaleServe',
    'Disable-TailscaleServe',
    'New-PairingCode',
    'Install-DroidHooks',
    'Uninstall-DroidHooks',
    'Get-DroidDoctor'
  )
  CmdletsToExport       = @()
  VariablesToExport     = @()
  AliasesToExport       = @('Doctor')
}
