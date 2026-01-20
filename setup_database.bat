@echo off
echo ========================================
echo QUBIC Casino - MySQL Database Setup
echo ========================================
echo.
echo This script will create the database and all tables.
echo You will be prompted for your MySQL root password.
echo.
echo IMPORTANT: Make sure MySQL is installed and running!
echo.
pause
echo.

echo Running schema.sql to create database and tables...
echo.

mysql -u root -p < database\schema.sql
if %errorlevel% neq 0 (
    echo.
    echo ========================================
    echo ERROR: Database setup failed!
    echo ========================================
    echo.
    echo Possible reasons:
    echo 1. MySQL is not installed or not running
    echo 2. MySQL is not in your system PATH
    echo 3. Wrong MySQL root password
    echo.
    echo SOLUTION:
    echo If MySQL is not in PATH, use MySQL Workbench instead:
    echo 1. Open MySQL Workbench
    echo 2. Connect to your MySQL server
    echo 3. File ^> Open SQL Script
    echo 4. Select: backend\database\schema.sql
    echo 5. Click Execute button
    echo.
    echo Or find your MySQL installation path and run:
    echo "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p ^< database\schema.sql
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
