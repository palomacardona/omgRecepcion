import type { Metadata } from "next";
import { getSettings } from "@/lib/store";
import { DEFAULT_SETTINGS } from "@/lib/settings";

export const metadata: Metadata = {
  title: "Política de privacidad · OMG Que Linda",
  robots: { index: true, follow: true },
};
export const dynamic = "force-dynamic";

export default async function Privacidad() {
  const s = await getSettings().catch(() => DEFAULT_SETTINGS);
  return (
    <main className="main" style={{ margin: "0 auto", maxWidth: 760, lineHeight: 1.6 }}>
      <h1>Política de privacidad — atención por WhatsApp</h1>
      <p className="muted">Última actualización: 6 de noviembre de 2026</p>

      <p>
        Esta política explica cómo <strong>{s.businessName}</strong> (centro de estética en Uruguay
        {s.address && !s.address.startsWith("(") ? `, ${s.address}` : ""}) trata los datos personales de quienes nos escriben por
        WhatsApp. Aplicamos la Ley N.º 18.331 de Protección de Datos Personales y su normativa reglamentaria.
      </p>

      <h2>Qué datos tratamos</h2>
      <ul>
        <li>Tu número de WhatsApp y el nombre de tu perfil.</li>
        <li>Los mensajes que nos mandás y los que te respondemos.</li>
        <li>Los datos que nos des para pedir un turno: nombre, tratamiento y días u horarios de preferencia.</li>
        <li>
          Si nos contás algo sobre tu salud (embarazo, medicación, alergias, reacciones), lo tratamos como dato sensible: solo lo
          usamos para que una persona del equipo te atienda y no lo compartimos con terceros con otros fines.
        </li>
      </ul>

      <h2>Para qué los usamos</h2>
      <ul>
        <li>Responder tus consultas sobre tratamientos, precios, horarios y ubicación.</li>
        <li>Gestionar tus solicitudes de turno y avisarte la confirmación o recordatorios.</li>
        <li>Enviarte novedades o promociones solo si nos diste tu consentimiento expreso. Podés darte de baja cuando quieras escribiendo "baja".</li>
      </ul>

      <h2>Asistente virtual</h2>
      <p>
        Para responder más rápido usamos una asistente virtual ("Claudia") basada en inteligencia artificial (Claude, de Anthropic).
        Las respuestas son revisadas por una persona del equipo antes de enviarse, salvo respuestas simples sobre horarios o
        ubicación cuando así lo configuremos. Tus conversaciones no se usan para entrenar modelos de inteligencia artificial.
      </p>

      <h2>Con quién se comparten</h2>
      <p>Solo con los proveedores que necesitamos para prestar el servicio, que actúan por cuenta nuestra:</p>
      <ul>
        <li>Meta Platforms (WhatsApp Business Platform), para recibir y enviar los mensajes.</li>
        <li>Anthropic, para generar los borradores de respuesta.</li>
        <li>Vercel y Neon, para alojar la aplicación y la base de datos.</li>
      </ul>
      <p>Algunos de estos proveedores procesan datos fuera de Uruguay, con garantías contractuales adecuadas. No vendemos tus datos.</p>

      <h2>Cuánto tiempo los guardamos</h2>
      <p>
        Guardamos las conversaciones y solicitudes mientras sean necesarias para atenderte y por un máximo de 2 años desde tu último
        mensaje, salvo que la ley exija conservarlas más tiempo.
      </p>

      <h2>Tus derechos</h2>
      <p>
        Podés pedir acceso, rectificación, actualización o supresión de tus datos, y retirar tu consentimiento para comunicaciones
        comerciales, escribiéndonos por este mismo WhatsApp. Te respondemos dentro de los plazos de la Ley 18.331. También podés
        recurrir a la Unidad Reguladora y de Control de Datos Personales (URCDP).
      </p>

      <h2>Seguridad</h2>
      <p>
        Los datos se guardan cifrados en reposo y en tránsito, y solo accede el personal autorizado del centro mediante usuario y
        contraseña.
      </p>
    </main>
  );
}
