import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { contacts, drafts, handoffs, messages } from "@/db/schema";
import { ago, CATEGORY_LABEL } from "@/lib/format";
import { getSettings } from "@/lib/store";

export default async function Inbox() {
  const settings = await getSettings();

  // Último mensaje por contacto + borrador pendiente + derivaciones abiertas.
  const lastMsg = db()
    .select({
      contactId: messages.contactId,
      lastAt: sql<Date>`max(${messages.timestamp})`.as("last_at"),
    })
    .from(messages)
    .groupBy(messages.contactId)
    .as("last_msg");

  const rows = await db()
    .select({
      id: contacts.id,
      name: contacts.name,
      waId: contacts.waId,
      lastAt: lastMsg.lastAt,
      pendingDraftId: sql<number | null>`(select d.id from ${drafts} d where d.contact_id = ${contacts.id} and d.status = 'pending' order by d.id desc limit 1)`,
      pendingCategory: sql<string | null>`(select d.category from ${drafts} d where d.contact_id = ${contacts.id} and d.status = 'pending' order by d.id desc limit 1)`,
      pendingSince: sql<Date | null>`(select d.created_at from ${drafts} d where d.contact_id = ${contacts.id} and d.status = 'pending' order by d.id desc limit 1)`,
      openHandoff: sql<string | null>`(select h.priority from ${handoffs} h where h.contact_id = ${contacts.id} and h.resolved = false order by case h.priority when 'urgente' then 0 when 'alta' then 1 when 'media' then 2 else 3 end limit 1)`,
      lastText: sql<string | null>`(select m.content from ${messages} m where m.contact_id = ${contacts.id} order by m.timestamp desc, m.id desc limit 1)`,
    })
    .from(contacts)
    .innerJoin(lastMsg, eq(lastMsg.contactId, contacts.id))
    .orderBy(
      sql`case when (select 1 from ${handoffs} h where h.contact_id = ${contacts.id} and h.resolved = false and h.priority = 'urgente' limit 1) is not null then 0 else 1 end`,
      sql`case when (select 1 from ${drafts} d where d.contact_id = ${contacts.id} and d.status = 'pending' limit 1) is not null then 0 else 1 end`,
      desc(lastMsg.lastAt),
    )
    .limit(100);

  const now = new Date();
  const staleMs = settings.staleDraftMinutes * 60_000;
  const pending = rows.filter((r) => r.pendingDraftId).length;

  return (
    <>
      <h1>Bandeja</h1>
      <p className="muted">
        {pending} {pending === 1 ? "borrador espera" : "borradores esperan"} aprobación.
        {process.env.WHATSAPP_DRY_RUN === "true" && " · Modo simulación: no se envía nada a WhatsApp."}
      </p>
      {rows.length === 0 && <div className="card muted">Todavía no llegaron mensajes.</div>}
      <table>
        <thead>
          <tr>
            <th>Chat</th>
            <th>Último mensaje</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const lastAt = r.lastAt ? new Date(r.lastAt) : null;
            const since = r.pendingSince ? new Date(r.pendingSince) : null;
            return (
              <tr key={r.id}>
                <td>
                  <Link href={`/panel/chat/${r.id}`}>
                    <strong>{r.name ?? r.waId}</strong>
                  </Link>
                  <div className="muted">+{r.waId}</div>
                </td>
                <td>
                  <div>{(r.lastText ?? "").slice(0, 90)}</div>
                  <div className="muted">{ago(lastAt, now)}</div>
                </td>
                <td>
                  <div className="row">
                    {r.openHandoff && <span className={`badge ${r.openHandoff}`}>Derivado · {r.openHandoff}</span>}
                    {r.pendingDraftId && (
                      <span className={`badge ${since && now.getTime() - since.getTime() > staleMs ? "warn" : ""}`}>
                        Borrador · {CATEGORY_LABEL[r.pendingCategory ?? ""] ?? r.pendingCategory} · {ago(since, now)}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
