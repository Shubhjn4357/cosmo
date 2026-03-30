@echo off
setlocal EnableExtensions

echo Starting Whisper AI Backend Server...
echo.

set "VENV_DIR="

if defined WHISPER_VENV (
    if exist "%WHISPER_VENV%\Scripts\python.exe" (
        set "VENV_DIR=%WHISPER_VENV%"
    )
)

if not defined VENV_DIR (
    for %%D in (".venv" "venv" "venv312" "..\.venv" "..\venv" "..\venv312") do (
        if exist "%%~D\Scripts\python.exe" (
            set "VENV_DIR=%%~D"
            goto :venv_found
        )
    )
)

:venv_found
if not defined VENV_DIR (
    echo [ERROR] No Python virtual environment was found.
    echo Tried: .venv, venv, venv312 in this folder and the parent folder.
    echo You can also set WHISPER_VENV to a custom environment path.
    pause
    exit /b 1
)

call "%VENV_DIR%\Scripts\activate.bat"

echo Environment: %VENV_DIR%
echo Server: http://0.0.0.0:8000
echo Docs: http://localhost:8000/docs
echo.
echo Press CTRL+C to stop the server
echo.

"%VENV_DIR%\Scripts\python.exe" -m uvicorn api.route:app --reload --host 0.0.0.0 --port 8000
