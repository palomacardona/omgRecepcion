import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Valida X-Hub-Signature-256 ("sha256=<hex>") sobre el cuerpo crudo con el App Secret.
 * Siempre comparar contra el body sin parsear: cualquier re-serialización rompe la firma.
 */
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const [algo, sig] = header.split("=", 2);
  if (algo !== "sha256" || !sig || !/^[0-9a-f]{64}$/i.test(sig)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const given = Buffer.from(sig, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function sign(rawBody: string, appSecret: string): string {
  return "sha256=" + createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
}
