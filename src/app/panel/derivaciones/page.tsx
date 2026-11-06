import { asc, desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { contacts, handoffs } from "@/db/schema";
import { ago } from "@/lib/format";
import { resolveHandoff } from "../actions";

export default async function Derivaciones() {
  const rows = await db()
    .select({ h: handoffs, name: contacts.name, waId: contacts.waId })
    .from(handoffs)
    .innerJoin(contacts, eq(contacts.id, handoffs.contactId))
    .orderBy(
      asc(handoffs.resolved),
      sql`case ${handoffs.priority} when 'urgente' then 0 when 'alta' then 1 when 'media' then 2 else 3 end`,
      desc(handoffs.createdAt),
    )
    .limit(200);

  return (
    <>
      <h1>Derivaciones</h1>
      <p className="muted">Conversaciones que Claudia pasó al equipo (salud, quejas, pedidos de hablar con alguien, datos que no están en el catálogo…).</p>
      <table>
        <thead>
          <tr>
            <th>Prioridad</th>
            <th>Persona</th>
            <th>Motivo</th>
            <th>Cuándo</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ h, name, waId }) => (
            <tr key={h.id} style={h.resolved ? { opacity: 0.55 } : undefined}>
              <td>
                <span className={`badge ${h.priority}`}>{h.priority}</span>
              </td>
              <td>
                <Link href={`/panel/chat/${h.contactId}`}>{name ?? waId}</Link>
              </td>
              <td>{h.reason}</td>
              <td className="muted">{ago(h.createdAt)}</td>
              <td>
                {h.resolved ? (
                  <span className="badge ok">Resuelto</span>
                ) : (
                  <form action={resolveHandoff}>
                    <input type="hidden" name="id" value={h.id} />
                    <button className="small secondary">Resolver</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No hay derivaciones.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
