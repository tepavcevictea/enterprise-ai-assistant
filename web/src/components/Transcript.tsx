import { agentLabel, outcomeLabel, statusLabel, turnStatus, specialistOutcomes } from "../present";
import type { ConversationTurn } from "../present";
import type { PasswordResetRow, TraceEvent } from "../types";

export function Transcript(props: {
  turns: ConversationTurn[];
  traces: TraceEvent[];
  resets: PasswordResetRow[];
  selectedTurnId: string | null;
  onSelect: (turnId: string) => void;
}) {
  if (props.turns.length === 0) {
    return (
      <div className="empty-thread">
        <p>No messages are stored for this identity.</p>
        <p>Ask about a service, a company policy, or a password reset.</p>
      </div>
    );
  }
  return (
    <ol className="thread">
      {props.turns.map((turn) => {
        const status = turnStatus(props.traces, turn.turnId);
        const parts = specialistOutcomes(props.traces, turn.turnId);
        const reset = props.resets.find((row) => row.turnId === turn.turnId);
        const selected = turn.turnId === props.selectedTurnId;
        return (
          <li key={turn.turnId}>
            <article className={selected ? `turn status-${status} selected` : `turn status-${status}`}>
              <button type="button" className="turn-select" onClick={() => props.onSelect(turn.turnId)} aria-pressed={selected}>
                <span className="speaker">You</span>
                <p className="question">{turn.question}</p>
              </button>
              <div className="answer">
                <div className="answer-heading">
                  <span className="speaker">Assistant</span>
                  <span className={`status-chip status-${status}`}>{statusLabel(status)}</span>
                </div>
                <p className="reply">{turn.reply}</p>
                {parts.length > 0 ? (
                  <dl className="part-list">
                    {parts.map((part) => (
                      <div key={`${part.agent}-${part.taskId ?? part.outcome}`} className={`part agent-${part.agent}`}>
                        <dt>{agentLabel(part.agent)}</dt>
                        <dd>{outcomeLabel(part.outcome)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {reset !== undefined ? <p className="reset-note">{reset.detail}</p> : null}
              </div>
            </article>
          </li>
        );
      })}
    </ol>
  );
}
