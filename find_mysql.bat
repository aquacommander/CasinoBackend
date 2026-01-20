@echo off
echo Searching for MySQL installation...
echo.

REM Check common MySQL installation locations
if exist "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" (
    echo Found: C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe
    set MYSQL_PATH=C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe
    goto :found
)

if exist "C:\Program Files\MySQL\MySQL Server 8.1\bin\mysql.exe" (
    echo Found: C:\Program Files\MySQL\MySQL Server 8.1\bin\mysql.exe
    set MYSQL_PATH=C:\Program Files\MySQL\MySQL Server 8.1\bin\mysql.exe
    goto :found
)

if exist "C:\Program Files\MySQL\MySQL Server 5.7\bin\mysql.exe" (
    echo Found: C:\Program Files\MySQL\MySQL Server 5.7\bin\mysql.exe
    set MYSQL_PATH=C:\Program Files\MySQL\MySQL Server 5.7\bin\mysql.exe
    goto :found
)

if exist "C:\xampp\mysql\bin\mysql.exe" (
    echo Found: C:\xampp\mysql\bin\mysql.exe
    set MYSQL_PATH=C:\xampp\mysql\bin\mysql.exe
    goto :found
)

if exist "C:\wamp64\bin\mysql\mysql8.0.xx\bin\mysql.exe" (
    echo Found: C:\wamp64\bin\mysql\mysql8.0.xx\bin\mysql.exe
    set MYSQL_PATH=C:\wamp64\bin\mysql\mysql8.0.xx\bin\mysql.exe
    goto :found
)

echo MySQL not found in common locations.
echo.
echo Please use MySQL Workbench instead:
echo 1. Open MySQL Workbench
echo 2. File ^> Open SQL Script
echo 3. Select: backend\database\schema.sql
echo 4. Click Execute
echo.
pause
exit /b 1

:found
echo.
echo MySQL found! Use this command to create the database:
echo.
echo "%MYSQL_PATH%" -u root -p ^< database\schema.sql
echo.
echo Or run this script with MySQL path:
echo setup_database_with_path.bat "%MYSQL_PATH%"
echo.
pause
