# Page Pilot — Product Requirements Document

## Problem
Navigating complex websites (travel booking, government portals, multi-step checkouts) is tedious
and error-prone. Users know what they want but not how to get there.

## Solution
Page Pilot is a Chrome Extension that acts as an AI co-pilot for any website. The user states a
goal; the AI reads the page, decides what to do next, and does it — one step at a time, with the
user always in control.

---

## Target Users
- Non-technical users who struggle with complex web workflows
- Power users who want to automate repetitive browsing tasks
- Accessibility users who benefit from AI-assisted navigation

---

## Core Features (MVP)

### F1 — Goal Input
- User opens the popup and types a natural-language goal.
- Goals can reference the current page ("book the cheapest round trip to Paris") or a future page ("go to Amazon and search for noise-cancelling headphones under $100").
- Character limit: 500.

### F2 — DOM Snapshot
- Content script scans the page and extracts interactive elements: `<a>`, `<button>`, `<input>`, `<select>`, `<textarea>`.
- Each element is given a stable `data-pilot-id` attribute so the AI can reference it.
- Snapshot is serialized to JSON and sent to the backend.

### F3 — AI Navigation
- Backend sends snapshot + goal + prior action history to Claude.
- Claude responds with ONE action at a time:
  - `{ action: "click", targetId: "pilot-42" }`
  - `{ action: "type", targetId: "pilot-7", text: "Paris" }`
  - `{ action: "scroll", direction: "down", px: 400 }`
  - `{ action: "navigate", url: "https://..." }`
  - `{ action: "done", message: "I've completed your goal." }`
  - `{ action: "ask", question: "Which departure date do you prefer?" }`
- Backend validates and returns the action JSON to the extension.

### F4 — Action Execution
- Content script executes DOM actions (click, type, scroll) directly.
- Background handles `navigate` by calling `chrome.tabs.update`.
- After execution, the loop restarts (new snapshot → new action).

### F5 — Status Panel
- Popup shows a live log of each step taken.
- User can pause or stop the session at any time.
- On `ask` action, popup shows a text input for the user to answer.

### F6 — Session History (Post-MVP)
- Sessions stored in Supabase with full step logs.
- User can replay or re-run past sessions.

---

## Non-Goals (MVP)
- No file downloads or uploads via AI
- No cross-browser support (Chrome only)
- No payment form auto-fill (security boundary)
- No background / scheduled automation

---

## Success Metrics
- Task completion rate ≥ 70% on common e-commerce flows
- P95 action latency < 3 seconds (snapshot → action executed)
- Zero API key leaks from extension

---

## Technical Constraints
- Manifest V3: no persistent background pages, no remote code execution
- Claude context window: keep snapshots under 8K tokens by filtering to visible, interactive elements
- All network requests from the extension go to our own backend, never to Anthropic directly

---

## UX Requirements
- Extension popup width: 380px, min-height: 500px
- Colors: navy `#0F172A` background, blue `#3B82F6` accent
- Font: system-ui / Inter
- States: idle, running, paused, done, error
- Every AI action must be visible to the user before/as it executes (no silent actions)

---

## Milestones
| # | Milestone | Description |
|---|---|---|
| M1 | Foundation | Repo scaffold, extension loads, backend health check passes |
| M2 | Snapshot | Content script extracts and serializes DOM |
| M3 | AI Loop | Backend calls Claude, extension executes returned action |
| M4 | Full Loop | End-to-end: goal → AI loop → done |
| M5 | Auth + Storage | Supabase auth + session persistence |
| M6 | Polish | Error handling, rate limiting, UX refinement |
