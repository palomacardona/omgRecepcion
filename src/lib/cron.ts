import type { NextRequest } from "next/server";

/** Vercel Cron manda "Authorization: Bearer $CRON_SECRET". */
export function isAuthorizedCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
}
