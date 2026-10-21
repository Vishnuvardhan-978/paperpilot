# PaperPilot Local Agent

Phase 2 Cursor-like machine helper for PaperPilot.

## Why a separate process?

Browsers cannot give real disk paths or edit your files freely (especially on LAN HTTP).  
This agent runs on your PC and opens folders **directly** — no upload/index wait.

## Run

```bash
npm run agent

# PowerShell — optional default folder
$env:PAPERPILOT_WORKSPACE="C:\path\to\project"
npm run agent
```

Status page: http://127.0.0.1:8787/

## Security

Every endpoint except the status page needs the `X-PaperPilot-Token` header.
The agent creates the token once in `~/.paperpilot/agent-token`; the Next.js
server hands it only to PaperPilot's own pages (`GET /api/agent/token`).
Requests are also rejected unless the page origin is this machine and the
`Host` header is `127.0.0.1`/`localhost` (blocks DNS rebinding).

| Variable | Purpose |
|----------|---------|
| `PAPERPILOT_AGENT_TOKEN` | Use a fixed token instead of the file (set it for both agent and app) |
| `PAPERPILOT_TOKEN_FILE` | Custom token file location |
| `PAPERPILOT_ALLOWED_ORIGINS` | Extra allowed page origins, comma-separated |

## Connect from the app

1. Start the agent  
2. Click **Folder** → paste the folder path (or keep the agent’s current path)  
3. Explorer loads instantly (paths only); file bodies are read on click  

## Tools

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Status |
| `GET/POST /workspace` | Get / switch root folder |
| `GET /tree` | Fast path list (no file contents) |
| `GET /list` `GET /read` `POST /write` | Files |
| `GET /search` | Text search |
| `POST /exec` | Terminal under workspace |
| `POST /restore` | Copy `<file>.ppbak` back over the file (undo last save) |
| `POST /delete` | Delete a file inside the workspace (used to reject new files) |

## Desktop app

`npm run desktop` runs the Electron shell from this folder.
`npm run desktop:build` creates `release/dist/PaperPilot Setup <version>.exe`.
