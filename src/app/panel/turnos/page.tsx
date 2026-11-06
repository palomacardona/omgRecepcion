import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { appointmentRequests, contacts } from "@/db/schema";
import { fmtDate } from "@/lib/format";
import { setAppointmentStatus } from "../actions";

const LABEL: Record<string, string> = {
  nueva: "Nueva",
  cargada_en_flowww: "Cargada en Flowww",
  confirmada: "Confirmada",
  cancelada: "Cancelada",
};

export default async function Turnos() {
  const rows = await db()
    .select({ a: appointmentRequests, name: contacts.name, waId: contacts.waId })
    .from(appointmentRequests)
    .innerJoin(contacts, eq(contacts.id, appointmentRequests.contactId))
    .orderBy(sql`case ${appointmentRequests.status} when 'nueva' then 0 when 'cargada_en_flowww' then 1 else 2 end`, desc(appointmentRequests.createdAt))
    .limit(200);

  return (
    <>
      <h1>Solicitudes de turno</h1>
      <p className="muted">
        Claudia no tiene acceso a la agenda. Cargá cada solicitud en Flowww, marcala como “Cargada” y, cuando esté confirmada, avisale a la persona desde el chat (o con la plantilla de confirmación).
      </p>
      <table>
        <thead>
          <tr>
            <th>Pedido</th>
            <th>Persona</th>
            <th>Tratamiento</th>
            <th>Preferencia</th>
            <th>Notas</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ a, name, waId }) => (
            <tr key={a.id}>
              <td className="muted">{fmtDate(a.createdAt)}</td>
              <td>
                <Link href={`/panel/chat/${a.contactId}`}>{a.clientName ?? name ?? waId}</Link>
                <div className="muted">+{waId}</div>
              </td>
              <td>{a.treatment}</td>
              <td>
                {a.preferredDays}
                <div className="muted">{a.preferredTime}</div>
              </td>
              <td>{a.notes}</td>
              <td>
                <form action={setAppointmentStatus} className="row">
                  <input type="hidden" name="id" value={a.id} />
                  <select name="status" defaultValue={a.status}>
                    {Object.entries(LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <button className="small secondary">Guardar</button>
                </form>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                No hay solicitudes todavía.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
