"use client";

import { useState, useTransition } from "react";
import type { SimTurn } from "@/lib/simulate";
import { simulateAction } from "../actions";

type Shown = SimTurn & { notes?: string[] };

const EXAMPLES = [
  "Hola! ¿Cuánto sale la limpieza facial?",
  "Quiero sacar turno para la semana que viene",
  "Estoy embarazada, ¿me puedo hacer depilación láser?",
  "¿Dónde quedan y hasta qué hora abren?",
  "Escribime un poema sobre gatos",
];

export function SimulatorChat() {
  const [turns, setTurns] = useState<Shown[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send(msg: string) {
    const clean = msg.trim();
    if (!clean || pending) return;
    const next: Shown[] = [...turns, { role: "cliente", text: clean }];
    setTurns(next);
    setText("");
    setError(null);
    start(async () => {
      const res = await simulateAction(next.map(({ role, text }) => ({ role, text })));
      if (res.ok) setTurns([...next, { role: "claudia", text: res.reply, notes: res.notes }]);
      else setError(res.error);
    });
  }

  return (
    <div className="card">
      <div className="chat" style={{ minHeight: 200 }}>
        {turns.length === 0 && <p className="muted">Empezá con un mensaje o probá uno de los ejemplos de abajo.</p>}
        {turns.map((t, i) => (
          <div key={i} style={{ display: "contents" }}>
            <div className={`bubble ${t.role === "cliente" ? "in" : "out"}`}>
              {t.text}
              <span className="meta">{t.role === "cliente" ? "Cliente (vos)" : "Claudia"}</span>
            </div>
            {t.notes?.map((n, j) => (
              <div key={j} className="muted" style={{ alignSelf: "flex-end", maxWidth: "75%", fontSize: "0.8rem" }}>
                {n}
              </div>
            ))}
          </div>
        ))}
        {pending && <div className="muted">Claudia está escribiendo…</div>}
      </div>
      {error && <div className="alert danger" style={{ marginTop: "0.75rem" }}>{error}</div>}
      <form
        className="row"
        style={{ marginTop: "1rem" }}
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <input className="grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribí como cliente…" style={{ width: "auto" }} />
        <button type="submit" disabled={pending || !text.trim()}>
          Enviar
        </button>
        <button type="button" className="secondary" disabled={pending} onClick={() => { setTurns([]); setError(null); }}>
          Nueva conversación
        </button>
      </form>
      <div className="row" style={{ marginTop: "0.75rem" }}>
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" className="secondary small" disabled={pending} onClick={() => send(ex)}>
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
