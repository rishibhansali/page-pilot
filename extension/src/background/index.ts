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

chrome.runtime.onMessage.addListener((msg: unknown) => {
  const m = msg as { type?: string; payload?: { userMessage?: string } };
  if (m.type === "USER_MESSAGE" && m.payload?.userMessage) {
    handleUserMessage(m.payload.userMessage);
  }
});

/**
 * Handles a single USER_MESSAGE round-trip: get the DOM skeleton from the
 * active tab, POST to the backend, and relay the action back to the content
 * script for logging (Part 3) / execution (Part 4+).
 */
async function handleUserMessage(userMessage: string): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab found");
    const tabId = tab.id;

    const skeletonResponse = await new Promise<{ skeleton: string; url: string }>(
      (resolve, reject) => {
        chrome.tabs.sendMessage(
          tabId,
          { type: "GET_SKELETON" } as { type: "GET_SKELETON" },
          (response: unknown) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(response as { skeleton: string; url: string });
          }
        );
      }
    );

    const { skeleton, url } = skeletonResponse;

    console.log("[PagePilot] Sending to backend:", {
      tab_id: String(tabId),
      url,
      user_message: userMessage,
      dom_skeleton: skeleton,
    });

    const res = await fetch("http://localhost:8000/api/navigate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tab_id: String(tabId),
        url,
        user_message: userMessage,
        dom_skeleton: skeleton,
      }),
    });

    if (!res.ok) throw new Error(`Backend error: ${res.status} ${res.statusText}`);

    const responseData = await res.json();
    console.log("[PagePilot] Backend response:", responseData);

    chrome.tabs.sendMessage(tabId, {
      type: "EXECUTE_ACTION",
      action: responseData as PilotAction,
    });
  } catch (error) {
    console.error("[PagePilot] Error:", error);
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
