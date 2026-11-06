import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { getSettings } from "@/lib/store";
import { logout, setClaudiaEnabled } from "./actions";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const { enabled } = await getSettings();
  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand">Claudia 💖</div>
        <form action={setClaudiaEnabled} className={`switch ${enabled ? "on" : "off"}`}>
          <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
          <div className="switch-state">
            <span className="dot" /> {enabled ? "Claudia activa" : "Claudia pausada"}
          </div>
          <button type="submit" className={`small ${enabled ? "secondary" : ""}`}>
            {enabled ? "Pausar" : "Activar"}
          </button>
        </form>
        <Link href="/panel">Bandeja</Link>
        <Link href="/panel/probar">Probar a Claudia</Link>
        <Link href="/panel/turnos">Solicitudes de turno</Link>
        <Link href="/panel/derivaciones">Derivaciones</Link>
        <Link href="/panel/catalogo">Catálogo</Link>
        <Link href="/panel/config">Configuración</Link>
        <div className="who">
          {session.name}
          <form action={logout}>
            <button className="secondary small" type="submit">Salir</button>
          </form>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
