import { useEffect, useMemo, useState } from "react";
import { errorText, readSession, resetSession, sendMessage } from "./api";
import { Composer } from "./components/Composer";
import { IdentitySwitch } from "./components/IdentitySwitch";
import { TracePanel } from "./components/TracePanel";
import { Transcript } from "./components/Transcript";
import { conversationTurns, turnStatus } from "./present";
import { DEMO_USERS, type DemoUserId, type Snapshot } from "./types";

const STORAGE_KEY = "northstar.demoUser";

function storedUser(): DemoUserId {
  const value = window.localStorage.getItem(STORAGE_KEY);
  return DEMO_USERS.some((user) => user.id === value) ? (value as DemoUserId) : "alex";
}

export function App() {
  const [userId, setUserId] = useState<DemoUserId>(storedUser);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "sending">("loading");
  const [error, setError] = useState<string | null>(null);
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const person = DEMO_USERS.find((user) => user.id === userId) ?? DEMO_USERS[0];
  const turns = useMemo(() => conversationTurns(snapshot?.histories ?? []), [snapshot]);
  const selectedTurn = turns.find((turn) => turn.turnId === selectedTurnId) ?? turns[turns.length - 1] ?? null;
  const selectedEvents = snapshot?.traces.filter((event) => event.turnId === selectedTurn?.turnId) ?? [];
  const selectedResets = snapshot?.passwordResets.filter((reset) => reset.turnId === selectedTurn?.turnId) ?? [];

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, userId);
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    setSnapshot(null);
    setSelectedTurnId(null);
    setError(null);
    setConfirmReset(false);
    readSession(userId)
      .then((next) => {
        if (cancelled) return;
        setSnapshot(next);
        setSelectedTurnId(null);
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setSnapshot(null);
        setError(errorText(reason));
        setPhase("ready");
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (snapshot?.activeTurn == null || phase === "sending") return;
    const timer = window.setInterval(() => {
      readSession(userId)
        .then((next) => setSnapshot(next))
        .catch(() => undefined);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [snapshot?.activeTurn, phase, userId]);

  async function onSend(message: string) {
    setPhase("sending");
    setError(null);
    setConfirmReset(false);
    try {
      const response = await sendMessage(userId, message, crypto.randomUUID());
      const next = await readSession(userId);
      setSnapshot(next);
      setSelectedTurnId(response.turnId);
    } catch (reason) {
      setError(errorText(reason));
      const next = await readSession(userId).catch(() => null);
      if (next !== null) setSnapshot(next);
    } finally {
      setPhase("ready");
    }
  }

  async function onReset() {
    setPhase("loading");
    setError(null);
    try {
      const next = await resetSession(userId);
      setSnapshot(next);
      setSelectedTurnId(null);
      setConfirmReset(false);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setPhase("ready");
    }
  }

  const busy = phase !== "ready";

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">
          <p className="eyebrow">Northstar</p>
          <h1>IT and HR assistant</h1>
        </div>
        <IdentitySwitch userId={userId} disabled={busy} onChange={setUserId} />
        <div className="session-actions">
          <p>
            {person.name}
            <span>Generation {snapshot?.generation ?? "—"}</span>
          </p>
          {confirmReset ? (
            <div className="confirm-reset">
              <p>This clears {person.name}&apos;s stored conversation, trace, and simulated resets.</p>
              <button type="button" onClick={() => void onReset()} disabled={busy}>
                Clear session
              </button>
              <button type="button" className="quiet" onClick={() => setConfirmReset(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="quiet" onClick={() => setConfirmReset(true)} disabled={busy || snapshot === null}>
              Reset session
            </button>
          )}
        </div>
      </header>
      <main>
        <section className="conversation" aria-label="Conversation">
          {snapshot?.activeTurn != null ? (
            <p className="banner" role="status">
              A turn is still running for {person.name}. The stored history will update when it finishes.
            </p>
          ) : null}
          {error !== null ? (
            <p className="banner error" role="alert">
              {error}
            </p>
          ) : null}
          {phase === "loading" && snapshot === null ? <p className="banner">Loading the stored conversation…</p> : null}
          {phase === "sending" ? (
            <p className="banner" role="status">
              Working with the specialists. The question stays disabled until this turn finishes.
            </p>
          ) : null}
          {snapshot !== null ? (
            <Transcript
              turns={turns}
              traces={snapshot.traces}
              resets={snapshot.passwordResets}
              selectedTurnId={selectedTurn?.turnId ?? null}
              onSelect={setSelectedTurnId}
            />
          ) : null}
          <Composer disabled={busy || snapshot === null} pending={phase === "sending"} onSend={(message) => void onSend(message)} />
        </section>
        <TracePanel
          turnId={selectedTurn?.turnId ?? null}
          question={selectedTurn?.question ?? null}
          status={selectedTurn === null ? null : turnStatus(snapshot?.traces ?? [], selectedTurn.turnId)}
          events={selectedEvents}
          resets={selectedResets}
        />
      </main>
    </div>
  );
}
