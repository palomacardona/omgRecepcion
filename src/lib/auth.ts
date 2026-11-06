import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const SESSION_COOKIE = "claudia_session";
const MAX_AGE_S = 12 * 3600;

type Session = { name: string; exp: number };

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET falta o es muy corto (mínimo 16 caracteres)");
  return s;
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const mac = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function encodeSession(name: string, now = Date.now()): string {
  const payload = b64(JSON.stringify({ name, exp: now + MAX_AGE_S * 1000 } satisfies Session));
  return `${payload}.${mac(payload)}`;
}

export function decodeSession(value: string | undefined, now = Date.now()): Session | null {
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(mac(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    return typeof s.name === "string" && s.exp > now ? s : null;
  } catch {
    return null;
  }
}

export function checkPassword(given: string): boolean {
  const expected = process.env.PANEL_ADMIN_PASSWORD ?? "";
  if (!expected) return false;
  const a = createHmac("sha256", "pw").update(given).digest();
  const b = createHmac("sha256", "pw").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function setSessionCookie(name: string) {
  (await cookies()).set(SESSION_COOKIE, encodeSession(name), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Para páginas y server actions del panel: devuelve la sesión o redirige al login. */
export async function requireSession(): Promise<Session> {
  const s = decodeSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) redirect("/login");
  return s;
}
