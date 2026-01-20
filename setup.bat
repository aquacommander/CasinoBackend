@echo off
echo Installing backend dependencies...
cd /d %~dp0
call npm install
echo.
echo Backend setup complete!
echo.
echo Next steps:
echo 1. Create a .env file (copy from .env.example)
echo 2. Configure MongoDB connection in .env
echo 3. Run: npm run dev
pause
