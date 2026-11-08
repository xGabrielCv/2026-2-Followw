@echo off
rem Atalho para o stop.ps1 (duplo clique), sem depender da política de execução do PowerShell.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1" %*
