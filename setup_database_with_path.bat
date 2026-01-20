@echo off
if "%~1"=="" (
    echo Usage: setup_database_with_path.bat "C:\Path\To\mysql.exe"
    echo.
    echo Example:
    echo   setup_database_with_path.bat "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
    echo.
    echo Or run find_mysql.bat to find MySQL automatically.
    echo.
    pause
    exit /b 1
)

set MYSQL_PATH=%~1

if not exist "%MYSQL_PATH%" (
    echo ERROR: MySQL not found at: %MYSQL_PATH%
    echo.
    echo Please check the path and try again.
    echo.
    pause
    exit /b 1
)

echo ========================================
echo QUBIC Casino - MySQL Database Setup
echo ========================================
echo.
echo Using MySQL at: %MYSQL_PATH%
echo.
echo You will be prompted for your MySQL root password.
echo.
pause
echo.

echo Running schema.sql to create database and tables...
echo.

"%MYSQL_PATH%" -u root -p < database\schema.sql
if %errorlevel% neq 0 (
    echo.
    echo ========================================
    echo ERROR: Database setup failed!
    echo ========================================
    echo.
    echo Possible reasons:
    echo 1. Wrong MySQL root password
    echo 2. MySQL server is not running
    echo.
    echo SOLUTION: Use MySQL Workbench instead:
    echo 1. Open MySQL Workbench
    echo 2. Connect to your MySQL server
    echo 3. File ^> Open SQL Script
    echo 4. Select: backend\database\schema.sql
    echo 5. Click Execute button
    echo.
    pause
    exit /b %errorlevel%
)

echo.
echo ========================================
echo SUCCESS: Database setup complete!
echo ========================================
echo.
echo The 'qubic_casino' database and all tables have been created.
echo.
echo You can now start the backend server with:
echo   npm run dev
echo.
pause
