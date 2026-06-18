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

chrome.runtime.onMessage.addListener((msg: unknown, sender) => {
  const m = msg as { type?: string; payload?: Record<string, unknown> };
  if (m.type === "USER_MESSAGE" && typeof m.payload?.userMessage === "string") {
    handleUserMessage(m.payload.userMessage);
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
  }
});

/**
 * Entry point for a USER_MESSAGE: resolves the active tab then hands off
 * to startNavigationLoop. Skips if a loop is already running for that tab.
 */
async function handleUserMessage(userMessage: string): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    console.error("[PagePilot] No active tab found");
    return;
  }
  const tabId = tab.id;

  if (activeSessions.get(tabId)) {
    console.log("[PagePilot] Navigation already in progress for tab", tabId);
    return;
  }

  await startNavigationLoop(tabId, userMessage);
}

/** Shape of an action returned by the backend /api/navigate endpoint. */
interface NavigationAction {
  action: string;
  selector: string | null;
  explanation: string;
  message: string | null;
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
  activeSessions.set(tabId, true);

  try {
    while (stepCount < MAX_STEPS && activeSessions.get(tabId)) {
      stepCount++;

      // 1. Get a fresh skeleton from the page.
      const skeletonResp = await sendMessageToTab(tabId, { type: "GET_SKELETON" }) as { skeleton: string; url: string };
      const { skeleton, url: currentUrl } = skeletonResp;

      console.log(`[PagePilot] Step ${stepCount}/${MAX_STEPS}`);
      console.log("[PagePilot] Sending to backend:", { tab_id: String(tabId), url: currentUrl, user_message: userMessage });

      // 2. Ask the backend for the next action.
      const res = await fetch("http://localhost:8000/api/navigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tab_id: String(tabId),
          url: currentUrl,
          user_message: userMessage,
          dom_skeleton: skeleton,
        }),
      });
      if (!res.ok) throw new Error(`Backend error: ${res.status} ${res.statusText}`);
      const action = await res.json() as NavigationAction;
      console.log("[PagePilot] Action:", action);

      // 3. Send a live step update to the widget.
      await sendMessageToTab(tabId, {
        type: "STATUS_UPDATE",
        payload: { step: stepCount, explanation: action.explanation, action: action.action },
      });

      // 4. Terminal actions — end the loop.
      if (action.action === "done" || action.action === "respond") {
        await sendMessageToTab(tabId, {
          type: "NAVIGATION_COMPLETE",
          payload: { success: action.action === "done", message: action.message ?? action.explanation },
        });
        activeSessions.delete(tabId);
        return;
      }

      // 5. Execute the action in the page.
      await sendMessageToTab(tabId, {
        type: "EXECUTE_ACTION",
        action: action as unknown as PilotAction,
      });

      // 6. Wait for the page to settle before re-reading the DOM.
      try {
        await sendMessageToTab(tabId, { type: "WAIT_FOR_SETTLE" });
      } catch {
        // Full navigation unloads the content script — wait for the tab to reload.
        await waitForTabLoad(tabId);
        await sleep(500);
      }

      await sleep(300);
    }

    // Hit the step limit.
    await sendMessageToTab(tabId, {
      type: "NAVIGATION_COMPLETE",
      payload: {
        success: false,
        message: "I reached the step limit without completing the goal. Please try navigating manually.",
      },
    }).catch(() => { /* content script may be gone */ });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[PagePilot] Navigation loop error:", err);
    sendMessageToTab(tabId, {
      type: "NAVIGATION_COMPLETE",
      payload: { success: false, message: `Navigation failed: ${message}` },
    }).catch(() => { /* ignore */ });
  } finally {
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
        reject(new Error(chrome.runtime.lastError.message));
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
