import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { logout } from "./actions";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand">Claudia 💖</div>
        <Link href="/panel">Bandeja</Link>
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
