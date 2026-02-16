@echo off
echo === VinciTu - Fix Fasi 2/3/6 (v2) ===
echo.

echo Creando cartelle...
if not exist "app\admin\treasury" mkdir "app\admin\treasury"
if not exist "app\admin\aml" mkdir "app\admin\aml"
if not exist "app\admin\audit" mkdir "app\admin\audit"
if not exist "app\(player)\sport\[id]" mkdir "app\(player)\sport\[id]"
if not exist "app\(player)\bets" mkdir "app\(player)\bets"

echo.
echo [FASE 2] Wallet con QR + 2FA + Monitor depositi...
copy /Y "%~dp0wallet-page.tsx" "app\(player)\wallet\page.tsx"

echo [FASE 2] Admin Treasury...
copy /Y "%~dp0admin-treasury.tsx" "app\admin\treasury\page.tsx"

echo [FASE 2] Admin AML...
copy /Y "%~dp0admin-aml.tsx" "app\admin\aml\page.tsx"

echo [FASE 3] Dettaglio Evento...
copy /Y "%~dp0event-detail.tsx" "app\(player)\sport\[id]\page.tsx"

echo [FASE 3] Le Mie Scommesse...
copy /Y "%~dp0my-bets.tsx" "app\(player)\bets\page.tsx"

echo [FASE 6] Admin Audit Log...
copy /Y "%~dp0admin-audit.tsx" "app\admin\audit\page.tsx"

echo.
echo === FATTO! ===
echo Riavvia: npm run dev
pause
