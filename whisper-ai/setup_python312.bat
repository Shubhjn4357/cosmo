@echo off
echo ========================================
echo Whisper AI - Python 3.12 Setup Script
echo ========================================
echo.

REM Check if Python 3.12 is available
py -3.12 --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python 3.12 not found!
    echo.
    echo Please install Python 3.12 from:
    echo https://www.python.org/downloads/
    echo.
    echo Make sure to check "Add Python to PATH" during installation.
    pause
    exit /b 1
)

echo [OK] Found Python 3.12
py -3.12 --version
echo.

REM Create virtual environment
echo Creating virtual environment...
if exist venv312 (
    echo [WARNING] venv312 already exists. Deleting...
    rmdir /s /q venv312
)

py -3.12 -m venv venv312
if %errorlevel% neq 0 (
    echo [ERROR] Failed to create virtual environment
    pause
    exit /b 1
)

echo [OK] Virtual environment created
echo.

REM Activate and install dependencies
echo Activating virtual environment...
call venv312\Scripts\activate.bat

echo.
echo Upgrading pip...
python -m pip install --upgrade pip

echo.
echo Installing dependencies from requirements.txt...
echo This may take 5-10 minutes...
pip install -r requirements.txt

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Some packages failed to install
    echo Check the errors above
    pause
    exit /b 1
)

echo.
echo ========================================
echo [SUCCESS] Setup complete!
echo ========================================
echo.
echo To start the backend:
echo   1. Activate venv: venv312\Scripts\activate.bat
echo   2. Run server: python -m uvicorn api.route:app --reload --host 0.0.0.0 --port 7860
echo.
echo To test auth:
echo   Open: d:\Code\whisper\auth-test.html
echo.
pause
