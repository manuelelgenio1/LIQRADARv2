@echo off
chcp 65001 >nul
set "PYTHONUTF8=1"
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title LIQ-RADAR - One Click
color 0B

set "PYEXE="
set "PYFULL="

rem ============================================================
rem 1) Buscar Python real
rem ============================================================
if exist ".venv\Scripts\python.exe" (
    set "PYFULL=%CD%\.venv\Scripts\python.exe"
    goto PYTHON_READY
)

if exist "%LocalAppData%\Programs\Python\Python312\python.exe" (
    set "PYFULL=%LocalAppData%\Programs\Python\Python312\python.exe"
    goto PYTHON_READY
)

if exist "%LocalAppData%\Programs\Python\Python311\python.exe" (
    set "PYFULL=%LocalAppData%\Programs\Python\Python311\python.exe"
    goto PYTHON_READY
)

where py >nul 2>&1
if not errorlevel 1 (
    set "PYEXE=py"
    goto PYTHON_COMMAND_READY
)

where python >nul 2>&1
if not errorlevel 1 (
    for /f "delims=" %%P in ('where python 2^>nul') do (
        set "PYFULL=%%P"
        goto PYTHON_READY
    )
)

rem ============================================================
rem 2) Instalar Python automaticamente
rem ============================================================
echo.
echo ============================================================
echo              LIQ-RADAR - PYTHON SETUP
echo ============================================================
echo Python no fue encontrado en este PC.
echo Intentando instalar Python 3.12 automaticamente...
echo.

where winget >nul 2>&1
if errorlevel 1 (
    echo ERROR: winget no esta disponible.
    echo Instala Python desde:
    echo https://www.python.org/downloads/windows/
    echo.
    start "" "https://www.python.org/downloads/windows/"
    pause
    exit /b 1
)

winget install --id Python.Python.3.12 -e --source winget --silent --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
    echo.
    echo ERROR: No se pudo instalar Python automaticamente.
    pause
    exit /b 1
)

rem Refrescar rutas tipicas de Python despues de winget
if exist "%LocalAppData%\Programs\Python\Python312\python.exe" (
    set "PYFULL=%LocalAppData%\Programs\Python\Python312\python.exe"
    goto PYTHON_READY
)

if exist "%ProgramFiles%\Python312\python.exe" (
    set "PYFULL=%ProgramFiles%\Python312\python.exe"
    goto PYTHON_READY
)

where py >nul 2>&1
if not errorlevel 1 (
    set "PYEXE=py"
    goto PYTHON_COMMAND_READY
)

where python >nul 2>&1
if not errorlevel 1 (
    for /f "delims=" %%P in ('where python 2^>nul') do (
        set "PYFULL=%%P"
        goto PYTHON_READY
    )
)

echo.
echo Python se instalo, pero no se pudo localizar en esta consola.
echo Cierra esta ventana y ejecuta nuevamente INICIAR_LIQ_RADAR.bat.
echo.
pause
exit /b 1

:PYTHON_READY
set "PYEXE=%PYFULL%"
echo [1/4] Python detectado: %PYEXE%
goto CREATE_VENV

:PYTHON_COMMAND_READY
echo [1/4] Python detectado mediante el launcher: %PYEXE%

:CREATE_VENV
if not exist ".venv\Scripts\python.exe" (
    echo [1/4] Creando entorno virtual local...
    "%PYEXE%" -m venv ".venv"
    if errorlevel 1 (
        echo.
        echo ERROR: No se pudo crear el entorno virtual.
        echo Python utilizado: %PYEXE%
        echo.
        pause
        exit /b 1
    )
)

set "PYEXE=%CD%\.venv\Scripts\python.exe"

if not exist ".env" (
    if exist ".env.example" (
        copy /Y ".env.example" ".env" >nul
    )
)

if not exist ".venv\.liq-radar-ready" (
    echo [2/4] Instalando dependencias...
    "%PYEXE%" -m pip install --disable-pip-version-check --upgrade pip
    if errorlevel 1 (
        echo.
        echo ERROR actualizando pip.
        pause
        exit /b 1
    )

    "%PYEXE%" -m pip install --disable-pip-version-check -r "requirements.txt"
    if errorlevel 1 (
        echo.
        echo ERROR instalando dependencias. Revisa tu conexion a Internet.
        pause
        exit /b 1
    )

    type nul > ".venv\.liq-radar-ready"
) else (
    echo [2/4] Dependencias listas.
)

if not exist "frontend\index.html" (
    echo ERROR: Falta frontend\index.html. El proyecto esta incompleto.
    pause
    exit /b 1
)

if not exist "backend\main.py" (
    echo ERROR: Falta backend\main.py. El proyecto esta incompleto.
    pause
    exit /b 1
)

echo [3/4] Iniciando servidor LIQ-RADAR...
start "LIQ-RADAR SERVER" "%PYEXE%" -m uvicorn backend.main:app --host 127.0.0.1 --port 8000

echo [4/4] Esperando el servidor...
set "READY_OK=0"
for /l %%I in (1,1,30) do (
    powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8000/api/health' -TimeoutSec 1; if($r.StatusCode -eq 200){exit 0}else{exit 1} } catch { exit 1 }" >nul 2>&1
    if not errorlevel 1 (
        set "READY_OK=1"
        goto READY
    )
    timeout /t 1 /nobreak >nul
)

:READY
start "" "http://127.0.0.1:8000"

echo.
echo ============================================================
echo                 LIQ-RADAR ESTA LISTO
echo                 http://127.0.0.1:8000
echo ============================================================
echo.
if "%READY_OK%"=="0" (
    echo El navegador se abrira igualmente. Si la pagina tarda, espera unos segundos.
    echo Revisa la ventana "LIQ-RADAR SERVER" si aparece algun error.
) else (
    echo Servidor conectado correctamente.
)
echo.
pause
exit /b 0
