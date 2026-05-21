@echo off
setlocal

set "PORT=%~1"
if "%PORT%"=="" set "PORT=4173"

set "APP_ROOT=%~dp0src"
if not exist "%APP_ROOT%\index.html" (
  echo Could not find "%APP_ROOT%\index.html".
  echo Make sure this file is next to the src folder.
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run Void Zero locally.
  echo Download Node.js from https://nodejs.org/
  echo.
  pause
  exit /b 1
)

echo Void Zero local server
echo Root: %APP_ROOT%
echo URL:  http://127.0.0.1:%PORT%/
echo.
echo Close this window or press Ctrl+C to stop the server.
echo.

set "SERVER_SCRIPT=%TEMP%\void-zero-local-server-%RANDOM%-%RANDOM%.js"

> "%SERVER_SCRIPT%" (
  echo const http = require("http"^);
  echo const fs = require("fs"^);
  echo const path = require("path"^);
  echo const root = process.argv[2];
  echo const port = Number(process.argv[3] ^|^| 4173^);
  echo const host = "127.0.0.1";
  echo const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".obj": "text/plain; charset=utf-8", ".ogg": "audio/ogg", ".ico": "image/x-icon" };
  echo const server = http.createServer((request, response^) =^> {
  echo   const url = new URL(request.url, `http://${host}:${port}`^);
  echo   const requestPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname^);
  echo   const filePath = path.normalize(path.join(root, requestPath^)^);
  echo   if (!filePath.startsWith(root^)^) {
  echo     response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }^);
  echo     response.end("Forbidden"^);
  echo     return;
  echo   }
  echo   fs.readFile(filePath, (error, data^) =^> {
  echo     if (error^) {
  echo       response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }^);
  echo       response.end("Not found"^);
  echo       return;
  echo     }
  echo     response.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath^)] ^|^| "application/octet-stream", "Cache-Control": "no-store" }^);
  echo     response.end(data^);
  echo   }^);
  echo }^);
  echo server.on("error", (error^) =^> {
  echo   if (error.code === "EADDRINUSE"^) {
  echo     console.error(`Port ${port} is already in use.`^);
  echo     console.error("Run this file with another port, for example: Start-Void-Zero.bat 4180"^);
  echo   } else {
  echo     console.error(error.message^);
  echo   }
  echo   process.exit(1^);
  echo }^);
  echo server.listen(port, host, (^) =^> console.log(`Serving Void Zero at http://${host}:${port}/`^)^);
)

start "" "http://127.0.0.1:%PORT%/"
node "%SERVER_SCRIPT%" "%APP_ROOT%" "%PORT%"
set "SERVER_EXIT=%ERRORLEVEL%"
del "%SERVER_SCRIPT%" >nul 2>nul

echo.
echo Server stopped.
pause
exit /b %SERVER_EXIT%
