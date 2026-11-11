import { useState } from "react";

const MESSAGE_LIMIT = 2_000;

export function Composer(props: {
  disabled: boolean;
  pending: boolean;
  onSend: (message: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const trimmed = draft.trim();
  const tooLong = draft.length > MESSAGE_LIMIT;
  const canSend = !props.disabled && trimmed !== "" && !tooLong;

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSend) return;
        props.onSend(trimmed);
        setDraft("");
      }}
    >
      <label htmlFor="message">Question</label>
      <textarea
        id="message"
        name="message"
        rows={3}
        maxLength={MESSAGE_LIMIT}
        value={draft}
        disabled={props.disabled}
        placeholder="Ask about a service, a company policy, or a password reset."
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="composer-bar">
        <span>{draft.length} / {MESSAGE_LIMIT}</span>
        <button type="submit" disabled={!canSend}>
          {props.pending ? "Working" : "Send"}
        </button>
      </div>
    </form>
  );
}
