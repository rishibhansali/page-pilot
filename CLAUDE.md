# Page Pilot — Claude Code Context

## What This Project Is
Page Pilot is an AI-powered Chrome Extension that navigates websites on behalf of users. The user
describes a goal in plain English ("find me a flight to Paris under $500") and the AI reads the
current page, decides what to click or type, and executes that action in the browser.

## Tech Stack
| Layer | Technology |
|---|---|
| Extension UI | React 18 + TypeScript + Vite + Tailwind CSS |
| Extension runtime | Chrome Manifest V3 (service worker + content script) |
| Backend | FastAPI (Python 3.11+) |
| AI | Anthropic Claude — `claude-sonnet-4-20250514` |
| Database | Supabase (PostgreSQL) — schema defined, no live connection yet |
| Auth | Supabase Auth (planned) |

## Folder Structure
```
page-pilot/
├── extension/                  # Chrome extension source
│   ├── public/                 # Static assets (icons)
│   ├── src/
│   │   ├── background/         # MV3 service worker
│   │   ├── content/            # Content scripts injected into pages
│   │   ├── popup/              # React popup UI
│   │   ├── types/              # Shared TypeScript types
│   │   └── utils/              # Pure utility functions
│   ├── manifest.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── tsconfig.json
├── backend/                    # FastAPI service
│   ├── app/
│   │   ├── api/                # Route handlers
│   │   ├── core/               # Config, Claude client
│   │   ├── models/             # Pydantic schemas
│   │   └── services/           # Business logic (navigation, AI)
│   ├── main.py
│   └── requirements.txt
├── .github/workflows/          # CI/CD
├── .env.example
├── CLAUDE.md                   # This file
├── PRD.md
└── README.md
```

## Core Logic Flow
1. User types a goal in the popup.
2. Popup sends the goal to the background service worker via `chrome.runtime.sendMessage`.
3. Background sends a message to the active tab's content script asking for a DOM snapshot.
4. Content script extracts interactive elements (links, buttons, inputs) and returns a serialized snapshot.
5. Background POSTs `{ goal, snapshot, history }` to the backend `/api/navigate` endpoint.
6. Backend calls Claude with the snapshot and goal, receives a structured action (`click`, `type`, `scroll`, `done`).
7. Backend returns the action JSON to the background.
8. Background relays the action to the content script.
9. Content script executes the action (click, fill input, scroll).
10. Loop repeats until Claude returns `{ action: "done" }` or the user stops it.

## Coding Rules — Enforce These Always
- **TypeScript strictly** — no `any`, no implicit types. Use `unknown` and narrow explicitly.
- **Tailwind only** — no inline `style=` props, no CSS modules.
- **Business logic never lives in UI components** — components render and dispatch, nothing else.
- **All Claude API calls go through the backend** — the extension API key is never exposed.
- **Every file starts with a single-line comment** describing what it does.
- **Every function has a JSDoc / docstring** explaining what it does and why.
- **Extension brand colors**: navy `#0F172A`, blue `#3B82F6`.

## Environment Variables
See `.env.example` at the project root and `backend/.env.example`.

## Database (Supabase — schema only)
Tables planned:
- `users` — Supabase auth users
- `sessions` — navigation sessions (goal, status, created_at)
- `steps` — individual AI actions within a session
- `feedback` — thumbs up/down per session

## Claude Model
Always use `claude-sonnet-4-20250514`. Do not change the model without updating this file.
