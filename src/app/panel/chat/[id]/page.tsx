import { and, asc, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { appointmentRequests, contacts, drafts, handoffs, messages } from "@/db/schema";
import { CATEGORY_LABEL, fmtDate } from "@/lib/format";
import { TEMPLATES } from "@/lib/templates";
import { isWindowOpen, windowClosesAt } from "@/lib/time";
import { approveDraft, discardDraft, resolveHandoff, sendTemplateAction, setMarketingOptIn } from "../../actions";

export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { id } = await params;
  const { ok, error } = await searchParams;
  const contactId = Number(id);
  if (!Number.isInteger(contactId)) notFound();

  const [contact] = await db().select().from(contacts).where(eq(contacts.id, contactId));
  if (!contact) notFound();

  const [history, [draft], openHandoffs, appts] = await Promise.all([
    db().select().from(messages).where(eq(messages.contactId, contactId)).orderBy(asc(messages.timestamp), asc(messages.id)).limit(200),
    db().select().from(drafts).where(and(eq(drafts.contactId, contactId), eq(drafts.status, "pending"))).orderBy(desc(drafts.id)).limit(1),
    db().select().from(handoffs).where(and(eq(handoffs.contactId, contactId), eq(handoffs.resolved, false))),
    db().select().from(appointmentRequests).where(eq(appointmentRequests.contactId, contactId)).orderBy(desc(appointmentRequests.id)).limit(5),
  ]);

  const now = new Date();
  const windowOpen = isWindowOpen(contact.lastInboundAt, now);
  const closes = windowClosesAt(contact.lastInboundAt);

  return (
    <>
      <h1>{contact.name ?? contact.waId}</h1>
      <p className="muted">
        +{contact.waId} ·{" "}
        {windowOpen ? (
          <span className="badge ok">Ventana abierta hasta {fmtDate(closes)}</span>
        ) : (
          <span className="badge danger">Ventana de 24 h cerrada: solo plantillas</span>
        )}{" "}
        · Marketing: {contact.optInMarketing ? `sí (desde ${fmtDate(contact.optInMarketingAt)})` : "no"}
      </p>
      {ok && <div className="alert ok">{ok}</div>}
      {error && <div className="alert danger">{error}</div>}

      {openHandoffs.map((h) => (
        <div key={h.id} className={`alert ${h.priority === "urgente" || h.priority === "alta" ? "danger" : ""}`}>
          <div className="row">
            <div className="grow">
              <strong>Derivado ({h.priority}):</strong> {h.reason} <span className="muted">· {fmtDate(h.createdAt)}</span>
            </div>
            <form action={resolveHandoff}>
              <input type="hidden" name="id" value={h.id} />
              <button className="secondary small">Marcar resuelto</button>
            </form>
          </div>
        </div>
      ))}

      <div className="card">
        <div className="chat">
          {history.map((m) => (
            <div key={m.id} className={`bubble ${m.direction}`}>
              {m.content}
              <span className="meta">
                {m.direction === "echo" ? "Equipo (app) · " : m.direction === "out" ? "Enviado · " : ""}
                {fmtDate(m.timestamp)}
                {m.direction !== "in" && ` · ${m.status}`}
              </span>
            </div>
          ))}
        </div>
      </div>

      {draft && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>
            Borrador de Claudia <span className="badge">{CATEGORY_LABEL[draft.category] ?? draft.category}</span>
          </h2>
          {draft.error && <div className="alert danger">Último intento: {draft.error}</div>}
          <form action={approveDraft}>
            <input type="hidden" name="draftId" value={draft.id} />
            <input type="hidden" name="contactId" value={contact.id} />
            <div className="field">
              <textarea name="text" defaultValue={draft.proposedText} />
            </div>
            <div className="row">
              <button type="submit" disabled={!windowOpen}>
                Aprobar y enviar
              </button>
              <span className="muted">Podés editar el texto antes de enviar.</span>
            </div>
          </form>
          <form action={discardDraft} style={{ marginTop: "0.5rem" }}>
            <input type="hidden" name="draftId" value={draft.id} />
            <input type="hidden" name="contactId" value={contact.id} />
            <button className="danger small">Descartar</button>
          </form>
        </div>
      )}

      {!windowOpen && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Enviar plantilla</h2>
          <p className="muted">Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo permite plantillas aprobadas.</p>
          {TEMPLATES.map((t) => (
            <form key={t.id} action={sendTemplateAction} className="card">
              <input type="hidden" name="contactId" value={contact.id} />
              <input type="hidden" name="templateId" value={t.id} />
              <strong>{t.label}</strong>
              <p className="muted">{t.preview}</p>
              <div className="grid2">
                {t.params.map((p, i) => (
                  <div className="field" key={i}>
                    <label>{`{{${i + 1}}}`} {p.label}</label>
                    <input name={`p${i}`} placeholder={p.placeholder} defaultValue={i === 0 ? contact.name ?? "" : ""} required />
                  </div>
                ))}
              </div>
              <button className="secondary">Enviar plantilla</button>
            </form>
          ))}
        </div>
      )}

      {appts.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Solicitudes de turno</h2>
          {appts.map((a) => (
            <div key={a.id} className="muted">
              {fmtDate(a.createdAt)} · {a.treatment} · {a.preferredDays} {a.preferredTime} · <span className="badge">{a.status}</span>
            </div>
          ))}
        </div>
      )}

      <form action={setMarketingOptIn} className="row">
        <input type="hidden" name="contactId" value={contact.id} />
        <input type="hidden" name="value" value={contact.optInMarketing ? "false" : "true"} />
        <button className="secondary small">
          {contact.optInMarketing ? "Quitar consentimiento de marketing" : "Registrar consentimiento de marketing (opt-in explícito)"}
        </button>
      </form>
    </>
  );
}
