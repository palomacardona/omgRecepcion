# Handover: Claudia por WhatsApp (API) — OMG Que Linda

_Para: Claude Code · Preparado: 5/11/2026 · Dueña: Paloma Cardona (paloma.i.cardona@gmail.com)_

## 1. Qué hay que construir

Un servicio que reciba los mensajes de WhatsApp de **OMG Que Linda** (centro de estética en Uruguay que quiere crecer hacia clínica estética), los conteste con **Claude** usando la personalidad de "Claudia, la recepcionista", y le pase al equipo humano lo que no pueda resolver.

**Objetivo de la v1:** contestar consultas frecuentes (precios, tratamientos, horarios, ubicación, preparación previa), juntar los datos para un turno y dejar la solicitud lista para que el equipo la confirme en Flowww. **En la v1 nada se envía sin aprobación humana** (ver §6).

## 2. Contexto que tenés que saber

- **Agenda / CRM:** Flowww (`https://br102.flowww.net/955853/`). **No hay API de Flowww**: viene solo con el Plan Legend (~4x el costo actual) y se decidió no contratarlo (3/11/2026). La app **no** puede leer ni escribir la agenda. Las reservas quedan como "solicitud de turno" y una persona (o Claudia por el navegador) las carga en Flowww.
- **WhatsApp hoy:** número de OMG Que Linda en la **app WhatsApp Business**, vinculado a WhatsApp Web en Chrome. El equipo quiere seguir usando la app del celular → usar **Coexistence** (ver §3).
- **Regla del negocio:** Claudia solo manda mensajes cuando el equipo lo aprueba (al menos hasta que se habilite el modo automático).
- **Tono:** rioplatense uruguayo, de "vos", coloquial, amable y muy simpático. Emojis con moderación. Mensajes cortos, como en WhatsApp.
- **Zona horaria:** `America/Montevideo` (UTC-3, sin horario de verano).

## 3. WhatsApp: decisiones y restricciones

Usar la **WhatsApp Business Platform – Cloud API** oficial de Meta (directo, sin BSP, salvo que Coexistence obligue a usar uno; ver abajo). Nada de librerías no oficiales tipo whatsapp-web.js / Baileys: violan los términos y pueden hacer que baneen el número.

**Coexistence (app + API en el mismo número):** permite seguir usando la app WhatsApp Business del celular mientras la API recibe y envía. Puntos a verificar al configurarlo:
- Disponibilidad para Uruguay y para este número (depende del mercado y de la cuenta).
- Se onboardea con *Embedded Signup*; confirmar si Meta permite hacerlo sin un Tech Provider/BSP.
- Throughput reducido (~20 msg/seg): de sobra para este volumen.
- Los mensajes que el equipo manda desde la app del celular llegan a la API como eco (webhook `smb_message_echoes`): guardarlos para que Claudia tenga todo el historial y **no conteste algo que ya respondió una persona**.

**Ventana de 24 horas:** fuera de las 24 h desde el último mensaje del cliente, solo se puede escribir con **plantillas aprobadas** (categorías utility/marketing). Las respuestas dentro de la ventana son mensajes de servicio. El código tiene que chequear la ventana antes de mandar y, si está cerrada, ofrecer solo plantillas.

**Precios:** Meta cobra por mensaje de plantilla entregado. Los mensajes de servicio dentro de la ventana eran gratis, pero hay fuentes de 2026 que hablan de un tope de mensajes de servicio gratis por mes. **Revisar la página oficial de precios de Meta para Uruguay antes de lanzar** y dejar la cuenta en el README.

**Política de IA de Meta (desde 15/1/2026):** prohíbe los asistentes de IA de **uso general** en la Business API. Los bots de atención/ventas propios de un negocio están permitidos. Por eso Claudia **tiene que quedarse en el negocio**: si le piden algo fuera de tema (tareas, código, preguntas generales), lo rechaza con buena onda y vuelve a la clínica. Además, los términos prohíben usar datos de la API para entrenar modelos de terceros: no usar las conversaciones para entrenamiento.

## 4. Arquitectura propuesta

```
WhatsApp ──webhook──▶ Next.js route handler en Vercel
                         │  verifica firma X-Hub-Signature-256
                         │  responde 200 al toque, procesa en cola
                         ▼
              Vercel Queue ──▶ Claude API (tool use)
                         │        ├─ buscar_tratamiento / precios (catálogo local)
                         │        ├─ crear_solicitud_turno
                         │        ├─ derivar_a_humano
                         │        └─ ver_horarios_atencion
                         ▼
                    Postgres (Neon/Supabase vía Vercel Marketplace)
                         ▼
                    Panel web del equipo: bandeja, borradores,
                    aprobar / editar / descartar, solicitudes de turno
```

**Hosting: Vercel (decidido 5/11/2026).** Stack:
- **Next.js (App Router) + TypeScript** en Vercel: webhook (`app/api/whatsapp/route.ts`) y panel del equipo en el mismo proyecto. Runtime **Node.js**, no Edge.
- **Postgres** vía Vercel Marketplace (Neon o Supabase), con Drizzle o Prisma. Usar el driver serverless / pooling para no agotar conexiones.
- SDK oficial `@anthropic-ai/sdk`.
- Auth del panel: Auth.js o una contraseña compartida + cookie firmada para la v1.
- Dominio: el `*.vercel.app` alcanza para el webhook; mejor un subdominio propio (ej. `claudia.omgquelinda.com`).

**Cómo encaja el webhook en serverless:**
1. El `POST` del webhook valida la firma, guarda el mensaje (dedupe por message id) y **responde 200 enseguida**. Meta reintenta si tarda, y eso genera duplicados.
2. El trabajo con Claude (unos segundos) va en una cola: **Vercel Queues** (entrega at-least-once, por eso la idempotencia es obligatoria) o Vercel Workflow. `waitUntil()` sirve solo como alternativa simple para la v1, porque no reintenta si falla. Si Queues sigue en beta y da problemas, usar Upstash QStash.
3. **Vercel Cron** para tareas periódicas: revisar borradores viejos sin aprobar, avisar al equipo y cerrar derivaciones vencidas.
4. Nada de estado en memoria ni archivos locales: todo en Postgres.
5. Funciones con la duración máxima por defecto (300 s) alcanzan de sobra.

**Plan de Vercel:** el plan Hobby es solo para uso personal/no comercial. Para la clínica corresponde **Pro**. Confirmalo con la política actual de Vercel y anotalo en el README.

**Modelos:** `claude-sonnet-5-5` para redactar las respuestas; `claude-haiku-5-5` opcional para clasificar (FAQ / turno / urgencia / fuera de tema). Prompt caching en el system prompt y el catálogo.

## 5. Modelo de datos (mínimo)

- `contacts`: wa_id, nombre, teléfono, opt_in_marketing (bool + fecha), creado.
- `messages`: id de WhatsApp (único → idempotencia), contact, dirección (in/out/echo), tipo (texto/audio/imagen/plantilla), contenido, timestamp, estado (sent/delivered/read/failed).
- `drafts`: mensaje propuesto por Claudia, estado (pendiente/aprobado/editado/descartado), quién aprobó, cuándo.
- `appointment_requests`: contact, tratamiento, preferencia de día/franja, notas, estado (nueva/cargada en Flowww/confirmada/cancelada).
- `handoffs`: contact, motivo, prioridad, resuelto.
- `catalog`: tratamientos, descripción corta, duración, precio o rango, contraindicaciones/preparación, activo. **Editable desde el panel** (el equipo arma paquetes nuevos seguido).
- `settings`: horarios de atención, dirección, modo (aprobación/automático por categoría).

## 6. Flujo y modos

1. Llega el webhook → guardar → deduplicar por message id → encolar.
2. El worker arma el contexto (últimos N mensajes + ecos del equipo + datos del contacto) y llama a Claude.
3. **Modo aprobación (default v1):** la respuesta queda como borrador en el panel. Una persona aprueba, edita o descarta. Al aprobar se envía.
4. **Modo automático (después, por categoría):** por ejemplo, autoenviar solo FAQ simples (horarios, dirección). Activable desde `settings`. Nunca automático para: precios de paquetes nuevos, temas de salud, quejas, cancelaciones.
5. Si una persona respondió desde la app en los últimos X minutos, Claudia no propone nada para ese chat (para no pisar al equipo).
6. Fuera de horario: respuesta corta avisando cuándo se contesta, y la solicitud queda en el panel.

**Audios e imágenes:** v1 → contestar que por ahora lee solo texto y derivar al equipo. (Transcripción como mejora futura.)

## 7. System prompt de Claudia (punto de partida)

Guardarlo en un archivo versionado (`prompts/claudia.md`), no hardcodeado. Tiene que incluir:
- Personalidad y tono (§2), saludo con el nombre si lo tenemos.
- Solo temas de OMG Que Linda; rechazar lo demás con simpatía.
- Usar **solo** precios y datos del catálogo; si algo no está, decir que lo consulta con el equipo (derivar). Nunca inventar precios, promociones ni disponibilidad.
- Nunca confirmar un turno: decir "te lo confirmamos en un ratito" y crear la solicitud.
- **Salud:** no diagnosticar, no prometer resultados, no recomendar medicación. Si mencionan embarazo, enfermedades, medicación, alergias o una reacción después de un tratamiento → derivar con prioridad alta. Ante dolor fuerte, dificultad para respirar o una reacción grave → indicar que llamen a emergencias y derivar de inmediato.
- Pedir solo los datos necesarios para el turno (nombre, tratamiento, preferencia horaria).

## 8. Seguridad y privacidad

- Uruguay: **Ley 18.331** de protección de datos personales. Los datos de salud son **datos sensibles**: minimizar, cifrar en reposo si el hosting lo permite, acceso solo con login, nada de datos de pacientes en logs.
- Verificar la firma de cada webhook con el App Secret. Secrets en variables de entorno: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `ANTHROPIC_API_KEY`, `DATABASE_URL`, `PANEL_ADMIN_PASSWORD`. Nunca commitearlos: cargarlos en Vercel → Settings → Environment Variables (marcados como *Sensitive*), usar `vercel env pull` en local y dejar un `.env.example`.
- Usar un **System User token** permanente de Meta, no el token temporal de 24 h.
- Marketing solo a quien dio opt-in explícito; respetar "baja"/"stop".
- Límite de gasto/uso en la consola de Anthropic.

## 9. Pasos manuales que hace el equipo (documentarlos en el README)

1. Cuenta de Meta Business (verificar el negocio si lo piden).
2. App en developers.facebook.com con el producto WhatsApp.
3. Onboarding del número con Coexistence (escanear QR desde la app WhatsApp Business del celular).
4. Crear System User y token permanente con permisos `whatsapp_business_messaging` y `whatsapp_business_management`.
5. Configurar la URL del webhook + verify token; suscribirse a `messages` (y a ecos si aplica Coexistence).
6. Cargar plantillas iniciales y esperar la aprobación: recordatorio de turno (utility), confirmación de turno (utility), "te escribimos por tu consulta" (utility).
7. API key de Anthropic.
7b. (Cuenta de Vercel ya creada el 5/11/2026: team **OMG Que Linda**, slug `omg-que-linda`, todavía sin Pro.) Proyecto en Vercel conectado al repo de GitHub, base Postgres creada desde el Marketplace y variables de entorno cargadas.
8. Cargar el catálogo de tratamientos y precios en el panel.

Claude Code no puede hacer estos pasos por el equipo (tienen logins y contraseñas): dejá una guía paso a paso clara.

## 10. Entregables y criterios de aceptación

- [ ] Repo con README en español (setup local, deploy, pasos de Meta).
- [ ] Webhook verificado, idempotente, con firma validada; responde en < 1 s.
- [ ] Respuestas en el tono de Claudia usando solo el catálogo.
- [ ] Panel: bandeja por chat, aprobar/editar/descartar borradores, solicitudes de turno, derivaciones, edición del catálogo y de settings.
- [ ] Chequeo de la ventana de 24 h y envío de plantillas.
- [ ] Derivación automática en temas de salud / quejas / pedido de humano.
- [ ] Rechazo de pedidos fuera de tema (cumplir la política de Meta).
- [ ] Tests: firma del webhook, dedupe, ventana 24 h, derivaciones de salud, fuera de tema, que no invente precios (evals con ~20 conversaciones de ejemplo en español).
- [ ] Modo sandbox con el número de prueba de Meta antes de tocar el número real.

## 11. Fuera de alcance v1 / ideas futuras

- Integración con Flowww (si algún día contratan Legend: crear turnos y consultar disponibilidad por API V2 REST).
- Recordatorios automáticos de turnos (plantilla utility + export de agenda desde Flowww).
- Transcripción de audios.
- Campañas de marketing a contactos con opt-in.
- Reportes: consultas por tratamiento, tasa de conversión a turno.

## 12. Preguntas abiertas para el equipo

1. ¿Coexistence está disponible para el número actual? (Si no, ¿se pasa el número a API-only o se usa un número nuevo?)
2. ¿Quién paga Vercel Pro + la base de datos + Meta + Anthropic? ¿La cuenta de Vercel ya es Pro o es Hobby?
3. ¿Quiénes del equipo aprueban borradores? ¿Cuántos usuarios necesita el panel?
4. Horarios de atención, dirección y el catálogo con precios actualizados.
5. ¿Qué categorías pueden pasar a modo automático primero?
