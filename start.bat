@echo off
rem マネージャーアプリを起動します（ダブルクリックで実行）
cd /d "%~dp0"
title マネージャー起動中

rem --- Node.js があるか確認 ---
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js が見つかりません。https://nodejs.org/ja から LTS 版を入れてください。
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo Node.js が古いです。https://nodejs.org/ja から新しい LTS 版を入れてください。
  pause
  exit /b 1
)

rem --- すでに起動していればブラウザを開くだけ ---
curl -s -o nul http://localhost:3000/ 2>nul
if not errorlevel 1 goto open

rem --- 初回だけ：部品の準備と組み立て ---
if not exist node_modules (
  echo 部品を準備しています（初回だけ、1～2 分かかります）...
  call npm ci
  if errorlevel 1 goto failed
)
if not exist .next\BUILD_ID (
  echo アプリを組み立てています（初回だけ、少しかかります）...
  call npm run build
  if errorlevel 1 goto failed
)

rem --- デスクトップのショートカットを、このフォルダーの start.bat に向ける ---
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[Environment]::GetFolderPath('Desktop');$p=Join-Path $d 'マネージャー.lnk';$new=-not(Test-Path $p);$s=(New-Object -ComObject WScript.Shell).CreateShortcut($p);$s.TargetPath='%~f0';$s.WorkingDirectory='%~dp0';$s.WindowStyle=7;$s.Save();if($new){Write-Host 'デスクトップに「マネージャー」のショートカットを作りました。'}"

rem --- アプリを起動（小さくした別ウィンドウで動きます） ---
start "マネージャー（このウィンドウを閉じるとアプリが止まります）" /min cmd /k "npm start"

echo 起動を待っています...
set tries=0
:wait
curl -s -o nul http://localhost:3000/ 2>nul
if not errorlevel 1 goto open
set /a tries+=1
if %tries% GEQ 60 goto failed
timeout /t 1 /nobreak >nul
goto wait

:open
start "" http://localhost:3000/
exit /b 0

:failed
echo.
echo うまく起動できませんでした。上に出ているメッセージを Claude に伝えてください。
pause
exit /b 1
