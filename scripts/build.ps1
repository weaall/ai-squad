# AI Squad v0.1 구현을 Headroom 을 거친 Claude CLI 에 맡긴다 (사람이 지켜볼 수 있게 터미널 탭에서 실행)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
New-Item -ItemType Directory -Force "$root\logs" | Out-Null
$prompt = [IO.File]::ReadAllText("$root\scripts\build-prompt.md")
$tools = 'Read,Write,Edit,Glob,Grep,Bash(node *),Bash(npm test*),Bash(git *),Bash(curl *),Bash(mkdir *),Bash(ls *)'
headroom wrap claude --no-mcp -- -p $prompt --permission-mode acceptEdits --allowedTools $tools --add-dir 'C:\Users\weaal\qugo' 2>&1 | Tee-Object -FilePath "$root\logs\build.log"
"exit=$LASTEXITCODE" | Tee-Object -FilePath "$root\logs\build.log" -Append
