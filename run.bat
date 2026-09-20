@echo off
REM Starts the HireFlow API and web app together.
cd /d %~dp0
if not exist api\.venv (
  echo Creating python venv
  python -m venv api\.venv
  api\.venv\Scripts\pip install -q -r api\requirements.txt
)
if not exist web\node_modules (
  echo Installing web dependencies
  pushd web && npm install && popd
)
start "HireFlow API" cmd /k "cd api && ..\api\.venv\Scripts\uvicorn main:app --port 8000"
start "HireFlow web" cmd /k "cd web && npm run dev"
echo API  http://127.0.0.1:8000
echo Web  http://localhost:5173
