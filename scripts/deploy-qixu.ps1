param([ValidateSet('Install','Upgrade','Cleanup')][string]$Stage='Install')
$ErrorActionPreference='Stop'
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workspace=[IO.Path]::GetFullPath((Join-Path $project '..\..'))
$backupRoot=Join-Path $project '..\upgrade-backup-1.2'
$metaFile=Join-Path $backupRoot 'latest.json'
$installDir='F:\栖序'
$legacyDir='F:\待办'
$exe=Join-Path $installDir '栖序.exe'
$package=Get-Content -LiteralPath (Join-Path $project 'package.json') -Raw | ConvertFrom-Json
$installer=Join-Path $project ('release\Qixu-Setup-'+$package.version+'-x64.exe')
$userData=Join-Path $env:APPDATA 'Moyu'
function Save-Meta { $script:meta | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $metaFile -Encoding utf8 }
function Installed-Processes { @(Get-Process -Name '栖序','TodoHost' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($installDir+'\',[StringComparison]::OrdinalIgnoreCase) }) }
function Stop-Qixu {
 if(@(Installed-Processes).Count) {
  Start-Process -FilePath $exe -ArgumentList '--quit' -WindowStyle Hidden -Wait
  $deadline=[DateTime]::UtcNow.AddSeconds(12)
  while(@(Installed-Processes).Count -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 150}
  if(@(Installed-Processes).Count){throw '栖序尚未退出，停止更新以保护数据。'}
 }
}
function Run-Installer {
 $process=Start-Process -FilePath $installer -ArgumentList '/S' -WindowStyle Hidden -PassThru
 if(!$process.WaitForExit(300000)){throw '安装超时'}
 if($process.ExitCode -ne 0){throw ('安装返回错误：'+$process.ExitCode)}
}
function Start-And-Verify {
 Start-Process -FilePath $exe -WindowStyle Normal | Out-Null
 $deadline=[DateTime]::UtcNow.AddSeconds(25)
 do { Start-Sleep -Milliseconds 400; $native=@(Installed-Processes | Where-Object ProcessName -eq 'TodoHost') } while(!$native.Count -and [DateTime]::UtcNow -lt $deadline)
 if(!$native.Count){throw '待办工作区没有启动'}
 Start-Sleep -Seconds 2
 $actual=(& node (Join-Path $PSScriptRoot 'migration-preview.cjs') --current | ConvertFrom-Json)
 if($LASTEXITCODE -ne 0 -or $actual.idsHash -ne $script:meta.Expected.idsHash){throw '安装后的任务标识与合并预演不一致，保留旧程序及备份。'}
 $version=(Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
 if(!$version.StartsWith($package.version)){throw ('安装版本异常：'+$version)}
 $desktop=[Environment]::GetFolderPath('Desktop')
 $link=Join-Path $desktop '栖序.lnk'
 if(!(Test-Path -LiteralPath $link)){throw '没有创建栖序桌面快捷方式'}
 $shell=New-Object -ComObject WScript.Shell
 if($shell.CreateShortcut($link).TargetPath -ne $exe){throw '桌面快捷方式目标错误'}
 $script:meta.VerifiedTasks=$actual.total
 $script:meta.ProductVersion=$version
 Write-Output ('安装运行验证通过，任务数：'+$actual.total)
}
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
if($Stage -eq 'Install') {
 if(!(Test-Path -LiteralPath $installer)){throw '安装包尚未生成'}
 if(@(Installed-Processes).Count){throw '当前仍有旧栖序在运行，请先正常退出后执行部署。'}
 if(Test-Path -LiteralPath (Join-Path $legacyDir 'Daiban.exe')) {
  $stop=Start-Process -FilePath (Join-Path $legacyDir 'Daiban.exe') -ArgumentList '--exit' -WindowStyle Hidden -PassThru
  $stop.WaitForExit(10000) | Out-Null
  $deadline=[DateTime]::UtcNow.AddSeconds(10)
  while(@(Get-Process Daiban -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $legacyDir 'Daiban.exe') }).Count -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 150}
  if(@(Get-Process Daiban -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $legacyDir 'Daiban.exe') }).Count){throw '旧待办未退出，未修改数据'}
 }
 $backup=Join-Path $backupRoot (Get-Date -Format 'yyyyMMdd-HHmmss')
 New-Item -ItemType Directory -Path $backup | Out-Null
 if(Test-Path -LiteralPath $userData){Copy-Item -LiteralPath $userData -Destination (Join-Path $backup 'qixu-userdata') -Recurse}
 if(Test-Path -LiteralPath $legacyDir){Compress-Archive -LiteralPath $legacyDir -DestinationPath (Join-Path $backup '待办旧版归档.zip')}
 $preview=(& node (Join-Path $PSScriptRoot 'migration-preview.cjs') | ConvertFrom-Json)
 if($LASTEXITCODE -ne 0){throw '合并预演失败'}
 $script:meta=[pscustomobject]@{Backup=$backup;Expected=$preview;Installed=$false;Upgraded=$false;Cleaned=$false;VerifiedTasks=0;ProductVersion='';At=(Get-Date).ToString('o')}
 Save-Meta
 $uninstaller=Join-Path $installDir 'Uninstall 栖序.exe'
 if(Test-Path -LiteralPath $uninstaller){$u=Start-Process -FilePath $uninstaller -ArgumentList '/S' -WindowStyle Hidden -PassThru;if(!$u.WaitForExit(120000) -or $u.ExitCode -ne 0){throw '旧栖序卸载未完成'}}
 Run-Installer
 Start-And-Verify
 $script:meta.Installed=$true;Save-Meta
 Write-Output ('数据备份：'+$backup)
} else {
 $script:meta=Get-Content -LiteralPath $metaFile -Raw | ConvertFrom-Json
 if(!$script:meta.Installed){throw '尚未通过安装验证'}
 if($Stage -eq 'Upgrade') {
  Stop-Qixu
  $script:meta.Expected=(& node (Join-Path $PSScriptRoot 'migration-preview.cjs') --current | ConvertFrom-Json)
  if($LASTEXITCODE -ne 0){throw '升级前无法确认任务数据'}
  Save-Meta
  Run-Installer
  Start-And-Verify
  $script:meta.Upgraded=$true;Save-Meta
 } else {
  if(!$script:meta.Upgraded){throw '尚未通过覆盖升级验证'}
  $actual=(& node (Join-Path $PSScriptRoot 'migration-preview.cjs') --current | ConvertFrom-Json)
  if($actual.idsHash -ne $script:meta.Expected.idsHash){throw '任务变化与迁移快照不一致，停止清理'}
  if(!(Test-Path -LiteralPath (Join-Path $script:meta.Backup '待办旧版归档.zip'))){throw '缺少旧待办归档，停止清理'}
  if(Test-Path -LiteralPath $legacyDir){
   $resolved=(Resolve-Path -LiteralPath $legacyDir).Path.TrimEnd('\')
   if($resolved -ne 'F:\待办' -or ((Get-Item -LiteralPath $legacyDir).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw '旧安装目录安全检查失败'}
   if(@(Get-ChildItem -LiteralPath $legacyDir -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count){throw '旧安装目录包含链接，停止递归清理'}
   Remove-Item -LiteralPath $resolved -Recurse -Force
  }
  $desktop=[Environment]::GetFolderPath('Desktop')
  foreach($name in @('待办.lnk','待办安装包.exe')){ $file=Join-Path $desktop $name;if(Test-Path -LiteralPath $file){Copy-Item -LiteralPath $file -Destination (Join-Path $script:meta.Backup $name);Remove-Item -LiteralPath $file -Force} }
  $run='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  $startup=(Get-ItemProperty -LiteralPath $run -Name 'DaibanDesktop' -ErrorAction SilentlyContinue).DaibanDesktop
  if($startup -and $startup.Contains('F:\待办\Daiban.exe')){Remove-ItemProperty -LiteralPath $run -Name 'DaibanDesktop'}
  $programs=[Environment]::GetFolderPath('Programs');$shell=New-Object -ComObject WScript.Shell
  foreach($link in @(Get-ChildItem -LiteralPath $programs -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue)){if($shell.CreateShortcut($link.FullName).TargetPath -eq 'F:\待办\Daiban.exe'){Remove-Item -LiteralPath $link.FullName -Force}}
  $script:meta.Cleaned=$true;Save-Meta
  Write-Output '旧待办程序、桌面入口和旧自启已清理，数据归档保留在工作区。'
 }
}
