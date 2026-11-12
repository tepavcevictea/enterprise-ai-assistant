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
  const [sessions, setSessions] = useState<Partial<Record<DemoUserId, Snapshot>>>({});
  const [phase, setPhase] = useState<"ready" | "sending" | "resetting">("ready");
  const [error, setError] = useState<string | null>(null);
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [pending, setPending] = useState<{ question: string; failed: boolean } | null>(null);
  const snapshot = sessions[userId] ?? null;
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
    for (const user of DEMO_USERS) {
      readSession(user.id)
        .then((next) => {
          if (!cancelled) setSessions((current) => ({ ...current, [user.id]: next }));
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setConfirmReset(false);
    setPending(null);
    readSession(userId)
      .then((next) => {
        if (cancelled) return;
        setSessions((current) => ({ ...current, [userId]: next }));
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(errorText(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (snapshot?.activeTurn == null || phase === "sending") return;
    const timer = window.setInterval(() => {
      readSession(userId)
        .then((next) => setSessions((current) => ({ ...current, [userId]: next })))
        .catch(() => undefined);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [snapshot?.activeTurn, phase, userId]);

  async function onSend(message: string) {
    setPhase("sending");
    setPending({ question: message, failed: false });
    setError(null);
    setConfirmReset(false);
    try {
      const response = await sendMessage(userId, message, crypto.randomUUID());
      const next = await readSession(userId);
      setSessions((current) => ({ ...current, [userId]: next }));
      setSelectedTurnId(response.turnId);
      setPending(null);
    } catch (reason) {
      setError(errorText(reason));
      setPending({ question: message, failed: true });
      const next = await readSession(userId).catch(() => null);
      if (next !== null) setSessions((current) => ({ ...current, [userId]: next }));
    } finally {
      setPhase("ready");
    }
  }

  async function onReset() {
    setPhase("resetting");
    setError(null);
    try {
      const next = await resetSession(userId);
      setSessions((current) => ({ ...current, [userId]: next }));
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
          <div className="thread-scroll">
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
            {snapshot !== null || pending !== null ? (
              <Transcript
                turns={turns}
                traces={snapshot?.traces ?? []}
                resets={snapshot?.passwordResets ?? []}
                selectedTurnId={selectedTurn?.turnId ?? null}
                pending={pending}
                onSelect={setSelectedTurnId}
              />
            ) : null}
          </div>
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
