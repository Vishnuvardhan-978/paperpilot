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

Health: http://127.0.0.1:8787/health

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

## Next

Desktop shell (Electron/Tauri) so path picking feels exactly like Cursor.
