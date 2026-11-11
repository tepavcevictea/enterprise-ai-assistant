import { agentLabel, eventLabel, formatTimestamp, outcomeLabel, plannedTasks, statusLabel } from "../present";
import type { TurnStatus } from "../present";
import type { PasswordResetRow, TraceEvent } from "../types";

export function TracePanel(props: {
  turnId: string | null;
  question: string | null;
  status: TurnStatus | null;
  events: TraceEvent[];
  resets: PasswordResetRow[];
}) {
  return (
    <aside className="trace" aria-label="Execution trace">
      <header>
        <p className="eyebrow">Execution trace</p>
        <h2>{props.question ?? "No turn selected"}</h2>
        {props.status !== null ? <p className={`status-chip status-${props.status}`}>{statusLabel(props.status)}</p> : null}
      </header>
      {props.turnId === null ? (
        <p className="trace-empty">Send a question to record a trace for this identity.</p>
      ) : props.events.length === 0 ? (
        <p className="trace-empty">This turn has no stored trace events.</p>
      ) : (
        <ol className="trace-list">
          {props.events.map((event) => {
            const tasks = event.eventType === "plan.tasks" ? plannedTasks(event.result) : undefined;
            return (
              <li key={event.traceId} className={`trace-event agent-${event.agentId}`}>
                <div className="trace-meta">
                  <time dateTime={event.timestamp}>{formatTimestamp(event.timestamp)}</time>
                  <span className={`agent-pill agent-${event.agentId}`}>{agentLabel(event.agentId)}</span>
                  {event.durationMs !== undefined ? <span>{event.durationMs} ms</span> : null}
                </div>
                <p className="trace-title">{eventLabel(event.eventType)}</p>
                <dl>
                  {event.taskId !== undefined ? (
                    <div>
                      <dt>Task</dt>
                      <dd>{event.taskId}</dd>
                    </div>
                  ) : null}
                  {event.toolId !== undefined ? (
                    <div>
                      <dt>Tool</dt>
                      <dd>{event.toolId}</dd>
                    </div>
                  ) : null}
                  {event.authorization !== undefined ? (
                    <div>
                      <dt>Authorization</dt>
                      <dd className={event.authorization === "denied" ? "auth-denied" : "auth-allowed"}>
                        {event.authorization === "denied" ? "Denied" : "Allowed"}
                      </dd>
                    </div>
                  ) : null}
                  {event.outcome !== undefined ? (
                    <div>
                      <dt>Outcome</dt>
                      <dd>{outcomeLabel(event.outcome)}</dd>
                    </div>
                  ) : null}
                  {event.errorCode !== undefined ? (
                    <div>
                      <dt>Error</dt>
                      <dd>{event.errorCode}</dd>
                    </div>
                  ) : null}
                  {event.sourceIds !== undefined && event.sourceIds.length > 0 ? (
                    <div>
                      <dt>Sources</dt>
                      <dd>{event.sourceIds.join(", ")}</dd>
                    </div>
                  ) : null}
                </dl>
                {tasks !== undefined && tasks.length > 0 ? (
                  <ul className="planned-tasks">
                    {tasks.map((task) => (
                      <li key={task.id}>
                        <span className={`agent-pill agent-${task.specialist}`}>{agentLabel(task.specialist)}</span>
                        {task.objective}
                        {task.dependsOn !== undefined && task.dependsOn.length > 0 ? " Depends on an earlier task." : ""}
                      </li>
                    ))}
                  </ul>
                ) : event.result !== undefined && event.eventType !== "plan.tasks" && event.eventType !== "plan.validated" && event.eventType !== "plan.repaired" ? (
                  <p className="trace-result">{event.result}</p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {props.resets.length > 0 ? (
        <section className="trace-resets">
          <h3>Simulated password resets</h3>
          <ul>
            {props.resets.map((reset) => (
              <li key={`${reset.turnId}-${reset.targetUser}`}>{reset.detail}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </aside>
  );
}
