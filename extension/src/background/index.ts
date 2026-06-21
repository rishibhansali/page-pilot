// Background service worker for Page Pilot (Manifest V3).
// Orchestrates the navigation loop: popup → background → content script → backend → content script.
// This is the only place that makes HTTP requests to the backend.

import type {
  PopupToBackground,
  BackgroundToPopup,
  BackgroundToContent,
  ContentToBackground,
  DomSnapshot,
  PilotAction,
  NavigateRequest,
  NavigateResponse,
  SessionStatus,
  ChatMessage,
} from "@/types";

// ---------------------------------------------------------------------------
// State — kept in memory for the lifetime of the service worker.
// ---------------------------------------------------------------------------

interface SessionState {
  status: SessionStatus;
  goal: string;
  history: PilotAction[];
  tabId: number | null;
  popupPortId: string | null;
}

let session: SessionState = {
  status: "idle",
  goal: "",
  history: [],
  tabId: null,
  popupPortId: null,
};

// Active long-lived connection to the popup (so we can push updates).
let popupPort: chrome.runtime.Port | null = null;

// ---------------------------------------------------------------------------
// Navigation loop state
// ---------------------------------------------------------------------------

/**
 * Tracks which tabs currently have an active navigation loop running.
 * The loop checks this flag before each step so Stop cancels mid-flight.
 */
const activeSessions = new Map<number, boolean>();

/**
 * Interval handle for the service-worker keepalive ping.
 * A plain setTimeout (sleep) has no I/O, so MV3 can idle-terminate the SW
 * between loop steps. Touching chrome.storage on a regular cadence resets the
 * idle timer and keeps the SW alive for the full duration of the loop.
 */
let keepaliveInterval: ReturnType<typeof setInterval> | null = null;

/** Starts the SW keepalive ping. Safe to call multiple times — no-ops if already running. */
function startKeepalive(): void {
  if (keepaliveInterval) return;
  keepaliveInterval = setInterval(() => {
    chrome.storage.session.get("keepalive").catch(() => {});
  }, 20000);
}

/** Stops the SW keepalive ping and clears the interval handle. */
function stopKeepalive(): void {
  if (keepaliveInterval) {
    clearInterval(keepaliveInterval);
    keepaliveInterval = null;
  }
}

// ---------------------------------------------------------------------------
// Widget state — persisted here so it survives cross-origin navigations.
// sessionStorage is origin-scoped; the service worker is tab-scoped.
// ---------------------------------------------------------------------------

/** Chat message history per tab, keyed by tab ID. */
const tabChatHistory = new Map<number, ChatMessage[]>();

/** Widget open/closed state per tab, keyed by tab ID. */
const widgetOpenState = new Map<number, boolean>();

// Free memory when the user closes a tab.
chrome.tabs.onRemoved.addListener((tabId) => {
  tabChatHistory.delete(tabId);
  widgetOpenState.delete(tabId);
});

// ---------------------------------------------------------------------------
// Popup port connection — popup connects on open, disconnects on close.
// ---------------------------------------------------------------------------

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "popup") return;
  popupPort = port;

  port.onDisconnect.addListener(() => {
    popupPort = null;
  });

  // Relay messages from the popup to our handler.
  port.onMessage.addListener((msg: PopupToBackground) => {
    handlePopupMessage(msg);
  });
});

// ---------------------------------------------------------------------------
// Simple one-shot message handler — wires widget → backend for Part 3.
// The port-based START_SESSION flow above is preserved for the full loop (Part 7+).
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
  const m = msg as { type?: string; payload?: Record<string, unknown> };

  if (m.type === "USER_MESSAGE" && typeof m.payload?.userMessage === "string" && sender?.tab?.id) {
    // tabId is available synchronously from sender — passed directly so the
    // guard check-and-set in handleUserMessage needs no async chrome.tabs.query.
    handleUserMessage(m.payload.userMessage, sender.tab.id);

  } else if (m.type === "CHECK_ACTIVE_SESSION") {
    const tabId = sender?.tab?.id;
    sendResponse({ isActive: tabId !== undefined ? (activeSessions.get(tabId) ?? false) : false });
    return true;

  } else if (m.type === "ACTION_COMPLETE") {
    console.log("[PagePilot] Action complete:", m.payload);

  } else if (m.type === "PAGE_SETTLING") {
    console.log("[PagePilot] Page settling, tab:", sender?.tab?.id);

  } else if (m.type === "STOP_NAVIGATION") {
    const tabId = sender?.tab?.id;
    if (tabId !== undefined) {
      console.log("[PagePilot] Stopping navigation for tab", tabId);
      activeSessions.set(tabId, false);
    }

  } else if (m.type === "GET_CHAT_HISTORY") {
    const tabId = sender?.tab?.id;
    sendResponse({ messages: tabId !== undefined ? (tabChatHistory.get(tabId) ?? []) : [] });
    return true;

  } else if (m.type === "SAVE_CHAT_HISTORY") {
    const tabId = sender?.tab?.id;
    const messages = m.payload?.messages;
    if (tabId !== undefined && Array.isArray(messages)) {
      tabChatHistory.set(tabId, messages as ChatMessage[]);
    }
    sendResponse({ ok: true });
    return true;

  } else if (m.type === "GET_WIDGET_OPEN_STATE") {
    const tabId = sender?.tab?.id;
    sendResponse({ isOpen: tabId !== undefined ? (widgetOpenState.get(tabId) ?? false) : false });
    return true;

  } else if (m.type === "SAVE_WIDGET_OPEN_STATE") {
    const tabId = sender?.tab?.id;
    const isOpen = m.payload?.isOpen;
    if (tabId !== undefined && typeof isOpen === "boolean") {
      widgetOpenState.set(tabId, isOpen);
    }
    sendResponse({ ok: true });
    return true;
  }
});

/**
 * Entry point for a USER_MESSAGE. tabId comes directly from sender.tab.id
 * (available synchronously in the onMessage listener) so the guard check-and-set
 * is fully atomic — no await before we claim the slot.
 *
 * Ownership model: handleUserMessage is the sole writer of activeSessions for a
 * given tab. startNavigationLoop reads the flag each iteration (for Stop support)
 * but never sets it to true.
 */
async function handleUserMessage(userMessage: string, tabId: number): Promise<void> {
  // Synchronous check-and-set — no await before this point, so no TOCTOU race.
  if (activeSessions.get(tabId)) {
    console.log("[PagePilot] Navigation already in progress for tab", tabId);
    return;
  }
  activeSessions.set(tabId, true);

  try {
    await startNavigationLoop(tabId, userMessage);
  } finally {
    // Belt-and-suspenders: startNavigationLoop's own finally also deletes, but
    // this guarantees cleanup even if an unexpected throw escapes the inner try.
    activeSessions.delete(tabId);
  }
}

/** Shape of an action returned by the backend /api/navigate endpoint. */
interface NavigationAction {
  action: string;
  selector: string | null;
  explanation: string;
  message: string | null;
}

/**
 * Wraps fetch with a 30-second AbortController timeout.
 * Rejects with a DOMException named "AbortError" if the deadline is exceeded,
 * which the caller can detect to show a user-friendly timeout message.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = 30000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Runs the observe → act → observe loop for a single navigation goal.
 * After each successful action it waits for the page to settle before
 * re-reading the DOM and asking the backend for the next step.
 * Sends STATUS_UPDATE + NAVIGATION_COMPLETE to the content script so
 * the widget can show live progress and re-enable the input when done.
 */
async function startNavigationLoop(tabId: number, userMessage: string): Promise<void> {
  let stepCount = 0;
  const MAX_STEPS = 10;

  // Keep the MV3 service worker alive. A bare sleep() has no I/O, so Chrome
  // can idle-terminate the SW between steps — which would wipe activeSessions
  // and allow a second loop to start for the same tab.
  startKeepalive();

  // Repeated-action tracking — detects when the model clicks the same selector
  // on the same URL multiple times, which means it failed to return "done".
  let lastSelector: string | null = null;
  let lastUrl: string | null = null;
  let repeatCount = 0;

  try {
    while (stepCount < MAX_STEPS && activeSessions.get(tabId)) {
      stepCount++;

      // 1. Get a fresh skeleton from the page.
      const skeletonResp = await sendMessageToTab(tabId, { type: "GET_SKELETON" }) as { skeleton: string; url: string } | null;
      if (skeletonResp === null) {
        // Tab navigated before the content script could respond — wait and retry.
        await waitForTabLoad(tabId);
        await sleep(500);
        continue;
      }
      const { skeleton, url: currentUrl } = skeletonResp;

      console.log(`[PagePilot] Step ${stepCount}/${MAX_STEPS}`);
      console.log("[PagePilot] Sending to backend:", { tab_id: String(tabId), url: currentUrl, user_message: userMessage });

      // 2. Ask the backend for the next action.
      let res: Response;
      try {
        res = await fetchWithTimeout("http://localhost:8000/api/navigate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tab_id: String(tabId),
            url: currentUrl,
            user_message: userMessage,
            dom_skeleton: skeleton,
          }),
        });
      } catch (fetchErr) {
        const isTimeout =
          fetchErr instanceof DOMException && fetchErr.name === "AbortError";
        await sendNavigationComplete(tabId, {
          success: false,
          message: isTimeout
            ? "Navigation timed out — Ollama may be slow or the backend may be down. Please try again."
            : `Network error: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
        }).catch(() => { /* content script may be gone */ });
        activeSessions.delete(tabId);
        return;
      }
      if (!res.ok) throw new Error(`Backend error: ${res.status} ${res.statusText}`);
      const action = await res.json() as NavigationAction;
      console.log("[PagePilot] Action:", action);

      // 3. Terminal actions — end the loop immediately (before status update so
      //    chat responses never show a "Step N/10" progress bubble).
      if (action.action === "done" || action.action === "respond" || action.action === "chat") {
        await sendNavigationComplete(tabId, {
          success: action.action === "done",
          message: action.message ?? action.explanation,
          isChat: action.action === "chat",
        });
        activeSessions.delete(tabId);
        return;
      }

      // 4. Send a live step update to the widget (only for actionable steps).
      await sendMessageToTab(tabId, {
        type: "STATUS_UPDATE",
        payload: { step: stepCount, explanation: action.explanation, action: action.action },
      });

      // 5. Repeated-action guard — if the model issues the same click on the
      //    same URL twice in a row, it has almost certainly already reached the
      //    goal but failed to return "done". Stop gracefully rather than looping.
      if (action.action === "click" && action.selector === lastSelector && currentUrl === lastUrl) {
        repeatCount++;
        console.log(`[PagePilot] Repeated action detected (${repeatCount}x): ${action.selector} on ${currentUrl}`);
        if (repeatCount >= 2) {
          await sendNavigationComplete(tabId, {
            success: true,
            message: `Looks like I've reached the destination — ${action.explanation}`,
          });
          activeSessions.delete(tabId);
          return;
        }
      } else {
        repeatCount = 0;
      }
      lastSelector = action.selector;
      lastUrl = currentUrl;

      // 6. Execute the action in the page.
      // A timeout here almost always means the click fired and triggered a navigation
      // before the content script could send back its response. Treat it as an
      // optimistic success and let WAIT_FOR_SETTLE detect the new page state rather
      // than crashing the loop with an uncaught throw.
      try {
        await sendMessageToTab(tabId, {
          type: "EXECUTE_ACTION",
          action: action as unknown as PilotAction,
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        if (errMsg.includes('timed out')) {
          console.log('[PagePilot] EXECUTE_ACTION timed out — action likely fired and triggered navigation. Continuing loop.');
        } else {
          throw e;
        }
      }

      // 7. Wait for the page to settle before re-reading the DOM.
      const settleResp = await sendMessageToTab(tabId, { type: "WAIT_FOR_SETTLE" });
      if (settleResp === null) {
        // Full navigation unloads the content script — wait for the tab to reload.
        await waitForTabLoad(tabId);
        await sleep(500);
      }

      await sleep(600);
    }

    // Hit the step limit.
    await sendNavigationComplete(tabId, {
      success: false,
      message: "I reached the step limit without completing the goal. Please try navigating manually.",
    }).catch(() => { /* content script may be gone */ });

  } catch (err) {
    console.error("[PagePilot] Navigation loop error:", err);
    try {
      await sendNavigationComplete(tabId, {
        success: false,
        message: "Navigation interrupted — the page changed unexpectedly. Please try again.",
      });
    } catch (sendErr) {
      console.error("[PagePilot] Could not send error completion:", sendErr);
    }
  } finally {
    stopKeepalive();
    activeSessions.delete(tabId);
  }
}

// ---------------------------------------------------------------------------
// Message handler for popup → background messages.
// ---------------------------------------------------------------------------

/**
 * Routes popup messages to the correct session action.
 * Uses a switch on the message `type` field for exhaustive handling.
 */
function handlePopupMessage(msg: PopupToBackground): void {
  switch (msg.type) {
    case "START_SESSION":
      startSession(msg.goal);
      break;
    case "PAUSE_SESSION":
      session.status = "paused";
      break;
    case "STOP_SESSION":
      session.status = "idle";
      session.history = [];
      break;
    case "USER_ANSWER":
      // Resume the loop with the user's answer appended to history context.
      if (session.status === "paused") {
        session.history.push({ action: "ask", question: `User answered: ${msg.answer}` });
        session.status = "running";
        runNavigationLoop();
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/**
 * Starts a new navigation session for the given goal.
 * Grabs the active tab ID, resets history, and kicks off the loop.
 */
async function startSession(goal: string): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    sendToPopup({ type: "SESSION_ERROR", error: "No active tab found." });
    return;
  }

  session = {
    status: "running",
    goal,
    history: [],
    tabId: tab.id,
    popupPortId: null,
  };

  sendToPopup({ type: "STEP_LOG", message: `Starting: "${goal}"` });
  runNavigationLoop();
}

// ---------------------------------------------------------------------------
// Core navigation loop
// ---------------------------------------------------------------------------

/**
 * Runs one iteration of the navigate → act loop.
 * Calls itself recursively (via async/await) until the session ends.
 * Stops if status is no longer "running" between steps.
 */
async function runNavigationLoop(): Promise<void> {
  if (session.status !== "running" || session.tabId === null) return;

  try {
    // 1. Get a DOM snapshot from the active tab's content script.
    const snapshot = await requestSnapshot(session.tabId);
    sendToPopup({ type: "STEP_LOG", message: `Snapshot captured: ${snapshot.elements.length} elements` });

    // 2. Ask the backend what to do next.
    const action = await fetchNextAction(session.goal, snapshot, session.history);
    session.history.push(action);

    sendToPopup({ type: "ACTION_EXECUTED", action });

    // 3. Handle terminal / pause actions before executing.
    if (action.action === "done") {
      session.status = "done";
      sendToPopup({ type: "SESSION_DONE", message: action.message });
      return;
    }

    if (action.action === "ask") {
      session.status = "paused";
      sendToPopup({ type: "ASK_USER", question: action.question });
      return;
    }

    // 4. Execute the action in the content script or via Chrome APIs.
    if (action.action === "navigate") {
      await chrome.tabs.update(session.tabId, { url: action.url });
      // Wait for the page to load before looping.
      await waitForTabLoad(session.tabId);
    } else {
      await executeInContentScript(session.tabId, action);
    }

    // 5. Loop.
    runNavigationLoop();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    session.status = "error";
    sendToPopup({ type: "SESSION_ERROR", error: message });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wraps chrome.tabs.sendMessage in a Promise that rejects after 10 seconds.
 * Used by startNavigationLoop so each step is a clean async/await call.
 */
function sendMessageToTab(tabId: number, message: BackgroundToContent): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Tab message timed out: ${message.type}`));
    }, 10000);

    chrome.tabs.sendMessage(tabId, message, (response: unknown) => {
      clearTimeout(timeoutId);
      if (chrome.runtime.lastError) {
        const errMsg = chrome.runtime.lastError.message ?? '';
        if (
          errMsg.includes('message channel closed') ||
          errMsg.includes('Receiving end does not exist') ||
          errMsg.includes('back/forward cache') ||
          errMsg.includes('bfcache')
        ) {
          // Expected during page navigation — content script destroyed or suspended mid-flight.
          console.log('[PagePilot] Tab navigated during message (expected):', errMsg);
          resolve(null);
        } else {
          reject(new Error(errMsg));
        }
        return;
      }
      resolve(response);
    });
  });
}

/**
 * Returns a Promise that resolves after ms milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Delivers NAVIGATION_COMPLETE to the content script with retry logic.
 *
 * The race: after a page navigation the content script runs immediately but
 * the React widget tree may not have mounted yet, so page-pilot-root doesn't
 * exist and the event gets silently dropped. The content script now reports
 * delivered:false in that case so we can wait and retry here.
 *
 * A null result from sendMessageToTab means the content script itself is gone
 * (tab closed / navigation destroyed it) — we don't retry in that case.
 */
async function sendNavigationComplete(
  tabId: number,
  payload: { success: boolean; message: string; isChat?: boolean },
  attempt = 1
): Promise<void> {
  const MAX_ATTEMPTS = 5;
  const RETRY_DELAY_MS = 400;

  const result = await sendMessageToTab(tabId, { type: "NAVIGATION_COMPLETE", payload });

  if (result === null) return;

  const delivered = (result as Record<string, unknown>).delivered;
  if (delivered === false && attempt < MAX_ATTEMPTS) {
    console.log(`[PagePilot] Widget not ready, retrying NAVIGATION_COMPLETE (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
    await sleep(RETRY_DELAY_MS);
    return sendNavigationComplete(tabId, payload, attempt + 1);
  }

  if (delivered === false) {
    console.error('[PagePilot] Failed to deliver NAVIGATION_COMPLETE after max retries');
  }
}

/**
 * Sends a message to the content script and waits for its response.
 * Uses chrome.tabs.sendMessage for request/response semantics.
 */
function requestSnapshot(tabId: number): Promise<DomSnapshot> {
  return new Promise((resolve, reject) => {
    const msg: BackgroundToContent = { type: "GET_SNAPSHOT" };
    chrome.tabs.sendMessage(tabId, msg, (response: ContentToBackground) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response.type === "SNAPSHOT_RESULT") {
        resolve(response.snapshot);
      } else {
        reject(new Error("Unexpected response from content script"));
      }
    });
  });
}

/**
 * Sends an execute-action message to the content script and waits for completion.
 */
function executeInContentScript(tabId: number, action: PilotAction): Promise<void> {
  return new Promise((resolve, reject) => {
    const msg: BackgroundToContent = { type: "EXECUTE_ACTION", action };
    chrome.tabs.sendMessage(tabId, msg, (response: ContentToBackground) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response.type === "ACTION_DONE") {
        if (response.success) {
          resolve();
        } else {
          reject(new Error(response.error ?? "Action failed"));
        }
      }
    });
  });
}

/**
 * POSTs to the backend /api/navigate endpoint and returns the next action.
 * The backend is responsible for calling Claude — never call Claude from here.
 */
async function fetchNextAction(
  goal: string,
  snapshot: DomSnapshot,
  history: PilotAction[]
): Promise<PilotAction> {
  const backendUrl = process.env.VITE_BACKEND_URL ?? "http://localhost:8000";

  const body: NavigateRequest = { goal, snapshot, history };

  const res = await fetch(`${backendUrl}/api/navigate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Backend error: ${res.status} ${res.statusText}`);
  }

  const data: NavigateResponse = await res.json() as NavigateResponse;
  return data.action;
}

/**
 * Waits for a tab to finish loading after a navigation.
 * Resolves when the tab status becomes "complete".
 */
function waitForTabLoad(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const listener = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo
    ) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * Pushes a message to the popup via the long-lived port.
 * No-ops if the popup is not open.
 */
function sendToPopup(msg: BackgroundToPopup): void {
  try {
    popupPort?.postMessage(msg);
  } catch {
    // Port may be disconnected; safe to ignore.
  }
}
