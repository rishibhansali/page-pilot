// ChatMessage component — renders a single message bubble in the chat history.
// User messages are right-aligned blue; assistant messages are left-aligned navy.

import React from "react";
import type { ChatMessage as ChatMessageType } from "@/types";

interface Props {
  message: ChatMessageType;
}

/**
 * Formats a Unix timestamp (ms) to a short HH:MM string for the message footer.
 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Pure display component — no state, no effects.
 * Renders one of four visual styles:
 *   user         — right-aligned blue bubble
 *   isStatus     — compact left-bordered step-progress line
 *   success      — green-tinted completion bubble
 *   error        — orange-tinted failure bubble
 *   assistant    — default navy bubble
 */
export default function ChatMessage({ message }: Props): React.JSX.Element {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex flex-col gap-1 items-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed bg-pilot-blue text-white">
          {message.content}
        </div>
        <span className="text-xs text-slate-500 px-1">{formatTime(message.timestamp)}</span>
      </div>
    );
  }

  // Live step-progress messages — compact, left-bordered in brand blue.
  if (message.isStatus) {
    return (
      <div className="flex flex-col gap-1 items-start">
        <div className="max-w-[90%] rounded-md pl-3 pr-4 py-1.5 text-xs leading-relaxed text-slate-400 border-l-2 border-pilot-blue bg-navy-light/60">
          {message.content}
        </div>
      </div>
    );
  }

  // Terminal navigation message — green for success, orange for failure.
  if (message.success !== undefined) {
    const cls = message.success
      ? "text-green-400 border-green-700/40 bg-green-900/10"
      : "text-orange-400 border-orange-700/40 bg-orange-900/10";
    return (
      <div className="flex flex-col gap-1 items-start">
        <div className={`max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed border ${cls}`}>
          {message.content}
        </div>
        <span className="text-xs text-slate-500 px-1">{formatTime(message.timestamp)}</span>
      </div>
    );
  }

  // Default assistant message.
  return (
    <div className="flex flex-col gap-1 items-start">
      <div className="max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed bg-navy-light text-slate-200 border border-slate-700/50">
        {message.content}
      </div>
      <span className="text-xs text-slate-500 px-1">{formatTime(message.timestamp)}</span>
    </div>
  );
}
