"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { appointmentRequests, catalog, contacts, drafts, handoffs } from "@/db/schema";
import type { AppointmentStatus } from "@/db/schema";
import { clearSessionCookie, requireSession } from "@/lib/auth";
import { sendDraft } from "@/lib/pipeline";
import { settingsSchema, type Settings } from "@/lib/settings";
import { getSettings, recordOutbound, saveSettings } from "@/lib/store";
import { renderTemplatePreview, TEMPLATES } from "@/lib/templates";
import { sendTemplate } from "@/lib/whatsapp/client";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (contactId: number, msg?: string, kind: "ok" | "error" = "ok") =>
  redirect(`/panel/chat/${contactId}${msg ? `?${kind}=${encodeURIComponent(msg)}` : ""}`);

export async function logout() {
  await clearSessionCookie();
  redirect("/login");
}

/** Interruptor general de Claudia (barra lateral del panel). */
export async function setClaudiaEnabled(formData: FormData) {
  const session = await requireSession();
  const enabled = formData.get("enabled") === "true";
  const current = await getSettings();
  await saveSettings({ ...current, enabled });
  console.log(`[panel] Claudia ${enabled ? "activada" : "pausada"} por ${session.name}`);
  revalidatePath("/panel", "layout");
}

export async function approveDraft(formData: FormData) {
  const session = await requireSession();
  const draftId = Number(formData.get("draftId"));
  const contactId = Number(formData.get("contactId"));
  const text = str(formData, "text");
  const res = await sendDraft(draftId, { reviewer: session.name, editedText: text });
  revalidatePath("/panel");
  return res.ok ? back(contactId, "Mensaje enviado ✔") : back(contactId, res.error, "error");
}

export async function discardDraft(formData: FormData) {
  const session = await requireSession();
  const draftId = Number(formData.get("draftId"));
  const contactId = Number(formData.get("contactId"));
  await db()
    .update(drafts)
    .set({ status: "discarded", reviewedBy: session.name, reviewedAt: new Date() })
    .where(and(eq(drafts.id, draftId), eq(drafts.status, "pending")));
  revalidatePath("/panel");
  back(contactId, "Borrador descartado");
}

export async function sendTemplateAction(formData: FormData) {
  await requireSession();
  const contactId = Number(formData.get("contactId"));
  const t = TEMPLATES.find((x) => x.id === str(formData, "templateId"));
  if (!t) return back(contactId, "Plantilla desconocida", "error");
  const params = t.params.map((_, i) => str(formData, `p${i}`));
  if (params.some((p) => !p)) return back(contactId, "Completá todos los campos de la plantilla", "error");

  const [contact] = await db().select().from(contacts).where(eq(contacts.id, contactId));
  const res = await sendTemplate(contact.waId, { ...t.spec, bodyParams: params });
  if (!res.ok) return back(contactId, `WhatsApp: ${res.error}`, "error");
  await recordOutbound({
    contactId,
    waMessageId: res.waMessageId,
    type: "template",
    content: renderTemplatePreview(t, params),
    simulated: res.simulated,
  });
  back(contactId, "Plantilla enviada ✔");
}

export async function setMarketingOptIn(formData: FormData) {
  await requireSession();
  const contactId = Number(formData.get("contactId"));
  const value = formData.get("value") === "true";
  await db()
    .update(contacts)
    .set({ optInMarketing: value, optInMarketingAt: value ? new Date() : null })
    .where(eq(contacts.id, contactId));
  back(contactId);
}

const APPT_STATUSES: AppointmentStatus[] = ["nueva", "cargada_en_flowww", "confirmada", "cancelada"];

export async function setAppointmentStatus(formData: FormData) {
  await requireSession();
  const id = Number(formData.get("id"));
  const status = str(formData, "status") as AppointmentStatus;
  if (!APPT_STATUSES.includes(status)) return;
  await db().update(appointmentRequests).set({ status, updatedAt: new Date() }).where(eq(appointmentRequests.id, id));
  revalidatePath("/panel/turnos");
}

export async function resolveHandoff(formData: FormData) {
  await requireSession();
  const id = Number(formData.get("id"));
  await db().update(handoffs).set({ resolved: true, resolvedAt: new Date() }).where(eq(handoffs.id, id));
  revalidatePath("/panel/derivaciones");
  revalidatePath("/panel");
}

export async function saveCatalogItem(formData: FormData) {
  await requireSession();
  const id = Number(formData.get("id") || 0);
  const duration = Number(formData.get("durationMinutes") || 0);
  const values = {
    name: str(formData, "name"),
    category: str(formData, "category") || null,
    description: str(formData, "description"),
    durationMinutes: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
    price: str(formData, "price") || null,
    preparation: str(formData, "preparation") || null,
    contraindications: str(formData, "contraindications") || null,
    active: formData.get("active") === "on",
    updatedAt: new Date(),
  };
  if (!values.name) redirect("/panel/catalogo?error=Falta%20el%20nombre");
  if (id) await db().update(catalog).set(values).where(eq(catalog.id, id));
  else await db().insert(catalog).values(values);
  revalidatePath("/panel/catalogo");
  redirect("/panel/catalogo?ok=Guardado");
}

export async function saveSettingsAction(formData: FormData) {
  await requireSession();
  const hours = Array.from({ length: 7 }, (_, d) => {
    if (formData.get(`closed${d}`) === "on") return null;
    return { open: str(formData, `open${d}`), close: str(formData, `close${d}`) };
  });
  const candidate: Settings = {
    enabled: formData.get("enabled") === "on",
    businessName: str(formData, "businessName"),
    address: str(formData, "address"),
    mapsUrl: str(formData, "mapsUrl"),
    extraInfo: str(formData, "extraInfo"),
    businessHours: hours,
    humanCooldownMinutes: Number(formData.get("humanCooldownMinutes")),
    historyLimit: Number(formData.get("historyLimit")),
    staleDraftMinutes: Number(formData.get("staleDraftMinutes")),
    handoffExpiryHours: Number(formData.get("handoffExpiryHours")),
    outOfHoursAutoReply: formData.get("outOfHoursAutoReply") === "on",
    autoSend: {
      faq_horarios: formData.get("auto_faq_horarios") === "on",
      faq_ubicacion: formData.get("auto_faq_ubicacion") === "on",
      faq_general: formData.get("auto_faq_general") === "on",
    },
  };
  const parsed = settingsSchema.safeParse(candidate);
  if (!parsed.success) {
    redirect(`/panel/config?error=${encodeURIComponent(parsed.error.issues.map((i) => i.path.join(".")).join(", "))}`);
  }
  await saveSettings(parsed.data);
  redirect("/panel/config?ok=Guardado");
}
