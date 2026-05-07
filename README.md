# Page Pilot

> AI-powered Chrome Extension that navigates websites for you.

Tell Page Pilot what you want to accomplish in plain English — it reads the page, decides what to click or type, and does it, one step at a time.

---

## Quick Start

### Prerequisites
- Node.js 20+
- Python 3.11+
- An [Anthropic API key](https://console.anthropic.com)

---

### 1. Clone & configure

```bash
git clone https://github.com/your-org/page-pilot.git
cd page-pilot

# Extension env
cp .env.example extension/.env

# Backend env
cp backend/.env.example backend/.env
# → Edit backend/.env and add your ANTHROPIC_API_KEY
```

---

### 2. Run the backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

uvicorn main:app --reload
# → API running at http://localhost:8000
# → Docs at http://localhost:8000/docs
```

Verify it works:
```bash
curl http://localhost:8000/health
# {"status":"ok","version":"0.1.0"}
```

---

### 3. Build the extension

```bash
cd extension
npm install
npm run dev          # watch mode — rebuilds on file changes
```

---

### 4. Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/dist/` folder

The Page Pilot icon will appear in your toolbar.

---

## Project Structure

```
page-pilot/
├── extension/          # Chrome Extension (React + TS + Vite + Tailwind)
│   ├── src/
│   │   ├── background/ # MV3 service worker — orchestrates the AI loop
│   │   ├── content/    # Content script — reads DOM, executes actions
│   │   ├── popup/      # React UI — goal input, status, step log
│   │   └── types/      # Shared TypeScript types
│   └── manifest.json
├── backend/            # FastAPI service — calls Claude, returns actions
│   ├── app/
│   │   ├── api/        # Route handlers (health, navigate)
│   │   ├── core/       # Config + Claude client
│   │   ├── models/     # Pydantic schemas
│   │   └── services/   # Navigation AI logic
│   └── main.py
└── .github/workflows/  # CI/CD skeletons
```

---

## How It Works

1. User types a goal in the popup (e.g. *"Find a direct flight to Tokyo for next Friday"*)
2. Background service worker requests a DOM snapshot from the content script
3. Snapshot + goal are sent to the backend `/api/navigate` endpoint
4. Backend calls Claude, which returns a single JSON action (`click`, `type`, `scroll`, etc.)
5. Content script executes the action on the page
6. Loop repeats until Claude returns `{ "action": "done" }`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Extension | React 18 + TypeScript + Vite + Tailwind CSS |
| Chrome API | Manifest V3 (service worker + content script) |
| Backend | FastAPI (Python 3.11) |
| AI | Claude `claude-sonnet-4-20250514` |
| Database | Supabase (PostgreSQL) — schema only, coming in M5 |

---

## Development

```bash
# Type check extension
cd extension && npm run typecheck

# Run backend tests
cd backend && pytest -v
```

---

## Security

- The Anthropic API key **never** leaves the backend.
- The extension communicates only with our own backend, never with Anthropic directly.
- Payment forms are explicitly excluded from AI interaction.

---

## Roadmap

| Milestone | Status |
|---|---|
| M1 — Foundation (this PR) | ✅ Done |
| M2 — DOM Snapshot | 🔲 Next |
| M3 — AI Loop | 🔲 |
| M4 — Full End-to-End | 🔲 |
| M5 — Auth + Supabase | 🔲 |
| M6 — Polish | 🔲 |
