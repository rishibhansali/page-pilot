# Page Pilot

> AI-powered Chrome Extension that navigates websites for you.

Tell Page Pilot what you want to accomplish in plain English — it reads the page, decides what to click or type, and does it, one step at a time.

---

## Quick Start

### Prerequisites
- Node.js 20+
- Python 3.11+
- An [Anthropic API key](https://console.anthropic.com)
- A [Supabase](https://supabase.com) project (free tier works)

---

### 1. Clone & configure

```bash
git clone https://github.com/rishibhansali/page-pilot.git
cd page-pilot

# Backend env
cp backend/.env.example backend/.env
# → Edit backend/.env and fill in your keys (see Environment Variables below)
```

---

### 2. Set up Supabase

In your Supabase project's SQL Editor, run:

```sql
CREATE TABLE sessions (
  tab_id     TEXT PRIMARY KEY,
  url        TEXT,
  messages   JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE navigation_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tab_id     TEXT NOT NULL,
  goal       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'running',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE navigation_steps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES navigation_sessions(id) ON DELETE CASCADE,
  step_num    INT NOT NULL,
  action      TEXT NOT NULL,
  selector    TEXT,
  explanation TEXT NOT NULL,
  url         TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

### 3. Run the backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

uvicorn main:app --reload
# → API running at http://localhost:8000
```

---

### 4. Build the extension

```bash
cd extension
npm install
npm run build
```

---

### 5. Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/dist/` folder

The Page Pilot pill will appear on every page — drag it anywhere, click to open.

---

## Environment Variables

Add these to `backend/.env`:

```env
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key
ALLOWED_ORIGINS=chrome-extension://your-extension-id
```

---

## How It Works

1. User types a goal (e.g. *"Show me Spotify Premium prices"*)
2. The floating widget sends the goal to the background service worker
3. Service worker reads the DOM via the content script and POSTs to the backend
4. Backend calls Claude, which returns a single JSON action (`click`, `scroll`, `done`, etc.)
5. Content script executes the action; the loop repeats up to 10 steps
6. Every session and step is persisted to Supabase in real time

---

## Project Structure

```
page-pilot/
├── extension/
│   └── src/
│       ├── background/     # MV3 service worker — orchestrates the AI loop
│       ├── content/        # Content script — reads DOM, executes actions
│       ├── widget/         # Floating React UI (Shadow DOM, Variant B active)
│       └── types/          # Shared TypeScript types
├── backend/
│   ├── routes/             # FastAPI route handlers
│   ├── services/
│   │   ├── claude.py           # Anthropic API calls
│   │   ├── supabase.py         # Conversation history persistence
│   │   └── supabase_sessions.py # Session + step persistence
│   ├── models.py
│   └── main.py
└── .github/workflows/
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Extension UI | React 18 + TypeScript + Vite + Tailwind CSS |
| Chrome API | Manifest V3 (service worker + content script) |
| Backend | FastAPI (Python 3.11) |
| AI | Claude `claude-sonnet-4-6` |
| Database | Supabase (PostgreSQL) |

---

## Development

```bash
# Type check extension
cd extension && npx tsc --noEmit

# Run backend tests (21 tests, all mocked — no network calls)
cd backend && pytest tests/ -v
```

---

## Security

- The Anthropic API key **never** leaves the backend.
- The extension communicates only with the local backend, never with Anthropic directly.
- Payment forms are explicitly excluded from AI interaction.

---

## Milestones

| Milestone | Status |
|---|---|
| M1 — Foundation | ✅ |
| M2 — DOM Snapshot | ✅ |
| M3 — AI Loop | ✅ |
| M4 — Full End-to-End | ✅ |
| M5 — Session Persistence | ✅ |
| M6 — Polish | ✅ |
