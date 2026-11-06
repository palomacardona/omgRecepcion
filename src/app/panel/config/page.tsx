import { DAY_NAMES } from "@/lib/settings";
import { getSettings } from "@/lib/store";
import { saveSettingsAction } from "../actions";

export default async function Config({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const s = await getSettings();
  return (
    <>
      <h1>Configuración</h1>
      {ok && <div className="alert ok">{ok}</div>}
      {error && <div className="alert danger">Revisá estos campos: {error}</div>}
      <form action={saveSettingsAction}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Estado</h2>
          <label className="row">
            <input type="checkbox" name="enabled" defaultChecked={s.enabled} style={{ width: "auto" }} /> Claudia activa (si la desmarcás,
            queda pausada: guarda los mensajes pero no propone ni envía nada)
          </label>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Datos del centro</h2>
          <div className="grid2">
            <div className="field">
              <label>Nombre</label>
              <input name="businessName" defaultValue={s.businessName} />
            </div>
            <div className="field">
              <label>Link de Google Maps</label>
              <input name="mapsUrl" defaultValue={s.mapsUrl} />
            </div>
          </div>
          <div className="field">
            <label>Dirección</label>
            <input name="address" defaultValue={s.address} />
          </div>
          <div className="field">
            <label>Otra información que Claudia puede usar (estacionamiento, formas de pago, etc.)</label>
            <textarea name="extraInfo" defaultValue={s.extraInfo} />
          </div>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Horario de atención (hora de Uruguay)</h2>
          {DAY_NAMES.map((d, i) => {
            const h = s.businessHours[i];
            return (
              <div className="row field" key={d}>
                <div style={{ width: 100 }}>{d}</div>
                <input name={`open${i}`} type="time" defaultValue={h?.open ?? "09:00"} style={{ width: 130 }} />
                <span>a</span>
                <input name={`close${i}`} type="time" defaultValue={h?.close ?? "19:00"} style={{ width: 130 }} />
                <label className="row" style={{ margin: 0 }}>
                  <input type="checkbox" name={`closed${i}`} defaultChecked={!h} style={{ width: "auto" }} /> cerrado
                </label>
              </div>
            );
          })}
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Modo de envío</h2>
          <p className="muted">
            Por defecto todo queda como borrador hasta que alguien lo aprueba. Podés activar el envío automático solo para consultas
            simples. Nunca se envían solas: precios, turnos, salud, quejas, cancelaciones ni derivaciones.
          </p>
          <label className="row">
            <input type="checkbox" name="auto_faq_horarios" defaultChecked={s.autoSend.faq_horarios} style={{ width: "auto" }} /> Automático
            para preguntas de horarios
          </label>
          <label className="row">
            <input type="checkbox" name="auto_faq_ubicacion" defaultChecked={s.autoSend.faq_ubicacion} style={{ width: "auto" }} />{" "}
            Automático para preguntas de dirección / cómo llegar
          </label>
          <label className="row">
            <input type="checkbox" name="auto_faq_general" defaultChecked={s.autoSend.faq_general} style={{ width: "auto" }} /> Automático
            para otras consultas generales simples (sin precios)
          </label>
          <label className="row">
            <input type="checkbox" name="outOfHoursAutoReply" defaultChecked={s.outOfHoursAutoReply} style={{ width: "auto" }} /> Fuera de
            horario, mandar automáticamente un aviso corto de cuándo respondemos
          </label>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Ajustes</h2>
          <div className="grid2">
            <div className="field">
              <label>Si alguien respondió desde la app, Claudia se calla durante (min)</label>
              <input name="humanCooldownMinutes" type="number" min={0} defaultValue={s.humanCooldownMinutes} />
            </div>
            <div className="field">
              <label>Mensajes de historial que lee Claudia</label>
              <input name="historyLimit" type="number" min={2} max={100} defaultValue={s.historyLimit} />
            </div>
            <div className="field">
              <label>Avisar borradores sin aprobar después de (min)</label>
              <input name="staleDraftMinutes" type="number" min={5} defaultValue={s.staleDraftMinutes} />
            </div>
            <div className="field">
              <label>Cerrar derivaciones abiertas después de (horas)</label>
              <input name="handoffExpiryHours" type="number" min={1} defaultValue={s.handoffExpiryHours} />
            </div>
          </div>
        </div>
        <button type="submit">Guardar configuración</button>
      </form>
    </>
  );
}
