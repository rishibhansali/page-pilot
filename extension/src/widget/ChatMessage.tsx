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
 * The isLoading flag is handled by LoadingState; this component only renders
 * finalised messages.
 */
export default function ChatMessage({ message }: Props): React.JSX.Element {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}
    >
      <div
        className={[
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-pilot-blue text-white rounded-tr-sm"
            : "bg-navy-light text-slate-200 rounded-tl-sm border border-slate-700/50",
        ].join(" ")}
      >
        {message.content}
      </div>
      <span className="text-xs text-slate-500 px-1">
        {formatTime(message.timestamp)}
      </span>
    </div>
  );
}
