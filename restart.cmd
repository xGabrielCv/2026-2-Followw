@echo off
rem Atalho para o restart.ps1 (duplo clique), sem depender da política de execução do PowerShell.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart.ps1" %*
