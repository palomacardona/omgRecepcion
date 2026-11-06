import { redirect } from "next/navigation";
import { checkPassword, setSessionCookie } from "@/lib/auth";

async function login(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim().slice(0, 40);
  const password = String(formData.get("password") ?? "");
  if (!name || !checkPassword(password)) redirect("/login?error=1");
  await setSessionCookie(name);
  redirect("/panel");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="login card">
      <h1>Claudia · OMG Que Linda</h1>
      {error && <div className="alert danger">Nombre o contraseña incorrectos.</div>}
      <form action={login}>
        <div className="field">
          <label htmlFor="name">Tu nombre (queda registrado al aprobar mensajes)</label>
          <input id="name" name="name" required autoComplete="username" />
        </div>
        <div className="field">
          <label htmlFor="password">Contraseña del equipo</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" />
        </div>
        <button type="submit">Entrar</button>
      </form>
    </div>
  );
}
