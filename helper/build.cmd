@echo off
rem Builds nova-helper.exe with the C# compiler that ships with Windows (.NET Framework 4, C# 5).
setlocal
cd /d "%~dp0"
set "FW=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319"
set "WM=%WINDIR%\System32\WinMetadata"
"%FW%\csc.exe" -nologo -optimize+ -platform:x64 -target:exe -out:nova-helper.exe ^
  -r:"%FW%\System.Runtime.dll" -r:"%FW%\System.Management.dll" -r:"%FW%\System.Xml.dll" -r:"%FW%\System.Core.dll" ^
  -r:"%FW%\Microsoft.CSharp.dll" -r:"%FW%\System.Runtime.InteropServices.WindowsRuntime.dll" -r:"%FW%\System.Drawing.dll" -r:"%FW%\WPF\UIAutomationClient.dll" -r:"%FW%\WPF\UIAutomationTypes.dll" -r:"%FW%\WPF\WindowsBase.dll" ^
  -r:"%WM%\Windows.Foundation.winmd" -r:"%WM%\Windows.Media.winmd" -r:"%WM%\Windows.Storage.winmd" -r:"%WM%\Windows.UI.winmd" -r:"%WM%\Windows.ApplicationModel.winmd" -r:"%FW%\System.Runtime.WindowsRuntime.dll" ^
  NovaHelper.cs Apps.cs YtUrl.cs AddressBar.cs AppWindows.cs Vlc.cs AudioSpectrum.cs AppNotify.cs
if errorlevel 1 exit /b %errorlevel%
"%FW%\csc.exe" -nologo -optimize+ -platform:x64 -target:exe -out:browser-media-host.exe BrowserMediaHost.cs
exit /b %errorlevel%
