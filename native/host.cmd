@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "APP_DIR=%%~fI"

set "PYTHON_EXE="
set "PYTHON_ARGS="

set "LOCAL_PY=%APP_DIR%\bin\python\python.exe"
if exist "%LOCAL_PY%" set "PYTHON_EXE=%LOCAL_PY%"

if not "%PYTHON_PATH%"=="" set "PYTHON_EXE=%PYTHON_PATH%"
if "%PYTHON_EXE%"=="" for /f "delims=" %%P in ('where python 2^>nul') do if not defined PYTHON_EXE set "PYTHON_EXE=%%P"
if "%PYTHON_EXE%"=="" for /f "delims=" %%P in ('where py 2^>nul') do if not defined PYTHON_EXE set "PYTHON_EXE=py" & set "PYTHON_ARGS=-3"

if "%PYTHON_EXE%"=="" if exist "C:\Program Files\Python312\python.exe" set "PYTHON_EXE=C:\Program Files\Python312\python.exe"
if "%PYTHON_EXE%"=="" if exist "C:\Program Files\Python311\python.exe" set "PYTHON_EXE=C:\Program Files\Python311\python.exe"
if "%PYTHON_EXE%"=="" if exist "C:\Program Files\Python310\python.exe" set "PYTHON_EXE=C:\Program Files\Python310\python.exe"
if "%PYTHON_EXE%"=="" if exist "C:\Program Files (x86)\Python312\python.exe" set "PYTHON_EXE=C:\Program Files (x86)\Python312\python.exe"
if "%PYTHON_EXE%"=="" if exist "C:\Program Files (x86)\Python311\python.exe" set "PYTHON_EXE=C:\Program Files (x86)\Python311\python.exe"
if "%PYTHON_EXE%"=="" if exist "C:\Program Files (x86)\Python310\python.exe" set "PYTHON_EXE=C:\Program Files (x86)\Python310\python.exe"

if "%PYTHON_EXE%"=="" exit /b 1

set "LOCAL_NODE=%APP_DIR%\bin\node\node.exe"
if exist "%LOCAL_NODE%" set "NODE_PATH=%LOCAL_NODE%"
if "%NODE_PATH%"=="" if exist "C:\Program Files\nodejs\node.exe" set "NODE_PATH=C:\Program Files\nodejs\node.exe"
if "%NODE_PATH%"=="" if exist "C:\Program Files (x86)\nodejs\node.exe" set "NODE_PATH=C:\Program Files (x86)\nodejs\node.exe"

"%PYTHON_EXE%" %PYTHON_ARGS% "%SCRIPT_DIR%host.py"
endlocal
