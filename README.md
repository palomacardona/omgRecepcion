# Claudia · WhatsApp de OMG Que Linda

Servicio que recibe los mensajes de WhatsApp de **OMG Que Linda**, los contesta con Claude usando la personalidad de "Claudia, la recepcionista", y le pasa al equipo lo que no puede resolver. En la v1 **nada se envía sin aprobación humana**: Claudia deja borradores en el panel y una persona los aprueba, edita o descarta.

Contexto y decisiones: [handover.md](handover.md).

## Cómo funciona

```
WhatsApp ──webhook──▶ /api/whatsapp (Next.js en Vercel, runtime Node)
                        │ valida X-Hub-Signature-256, guarda (dedupe por wamid), responde 200
                        ▼
                     after() → pipeline  ──▶ Claude (claude-sonnet-5-5 + herramientas)
                        │                      ├─ crear_solicitud_turno
                        │                      └─ derivar_a_humano
                        ▼
                     Postgres (Neon)  ◀── Panel del equipo (/panel)
                        ▲
   Vercel Cron ─────────┘  /api/cron/process-pending (cada 5 min: reintentos)
                           /api/cron/maintenance     (cada hora: borradores viejos, derivaciones vencidas)
```

- **Idempotencia:** `messages.wa_message_id` es único; un reintento de Meta no duplica nada. El procesamiento usa un lock optimista (`processing` + `attempts`), así que el cron y el webhook no responden dos veces.
- **Cola:** se usa `after()` de Next (que en Vercel es `waitUntil`) y el cron reintenta lo que haya fallado (hasta 3 intentos). Es la opción simple que propone el handover para la v1; si hace falta más garantía, cambiar por Vercel Queues o Upstash QStash en `src/app/api/whatsapp/route.ts`.
- **Ráfagas:** si la clienta manda 3 mensajes seguidos, Claudia responde solo al último (con todo el historial).
- **No pisar al equipo (Coexistence):** los mensajes que el equipo manda desde la app del celular llegan como eco (`smb_message_echoes`), se guardan en el historial, descartan el borrador pendiente y Claudia se calla durante `humanCooldownMinutes` (30 min por defecto).
- **Ventana de 24 h:** el panel no deja mandar texto libre si pasaron 24 h desde el último mensaje del cliente; ofrece solo las plantillas de `src/lib/templates.ts`.
- **Salud:** además del criterio de Claude, hay una red de seguridad por palabras clave (`src/lib/safety.ts`). Ante una posible emergencia responde con un texto fijo que indica llamar al 911 y deriva con prioridad urgente, sin pasar por Claude. Ante embarazo, medicación, alergias o reacciones, siempre deriva con prioridad alta aunque el modelo no lo haya hecho.
- **Audios e imágenes:** v1 contesta que por ahora lee solo texto y deriva.
- **Fuera de tema:** el prompt obliga a Claudia a quedarse en temas del centro (política de IA de Meta desde el 15/1/2026).
- **Prompt:** versionado en [prompts/claudia.md](prompts/claudia.md). El catálogo y los datos del centro se inyectan desde la base, con prompt caching.
- **Fallback de seguridad de Claude:** las llamadas usan `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`): si el modelo declina por un falso positivo, la API reintenta con otro modelo dentro del mismo pedido. Si igual declina, se deriva al equipo.

## Estructura

| Ruta | Qué es |
|---|---|
| `src/app/api/whatsapp/route.ts` | Webhook (GET verificación, POST eventos) |
| `src/app/api/cron/*` | Tareas de Vercel Cron |
| `src/app/panel/*` | Panel: bandeja, chat + borrador, turnos, derivaciones, catálogo, configuración |
| `src/lib/pipeline.ts` | Procesamiento de cada mensaje y envío de borradores |
| `src/lib/claudia/` | Prompt + contexto, llamada a Claude, clasificador para modo automático |
| `src/lib/whatsapp/` | Firma, parseo del webhook y cliente de la Cloud API |
| `src/db/schema.ts` | Modelo de datos (Drizzle) · migraciones en `drizzle/` |
| `tests/` | Tests (Vitest + Postgres en memoria con PGlite) |
| `evals/` | ~20 conversaciones de ejemplo contra el modelo real |

## Desarrollo local

Requisitos: Node.js 22+ (probado con 26) y una base Postgres (la de Neon sirve, mejor un *branch* de desarrollo).

```bash
npm install
```

```bash
cp .env.example .env.local
```

Completá `.env.local` (o, con el proyecto ya creado en Vercel, usá `vercel env pull .env.local`). Con `WHATSAPP_DRY_RUN=true` nada se manda a Meta: los envíos quedan registrados como `simulated`.

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm run dev
```

Panel en http://localhost:3000/panel (pide tu nombre y `PANEL_ADMIN_PASSWORD`).

Para probar el webhook desde Meta en local hace falta una URL pública (por ejemplo un túnel de Cloudflare o ngrok) apuntando a `http://localhost:3000/api/whatsapp`.

### Tests y evals

```bash
npm test
```

Cubren: firma del webhook, dedupe, ventana de 24 h, horarios en hora de Uruguay, derivaciones de salud/quejas/pedido de humano, eco del equipo, audios, turnos, modo automático, reintentos, sesión del panel. No llaman a Claude ni a Meta.

```bash
npm run evals
```

Corre 21 conversaciones de ejemplo (precios del catálogo, precios que faltan, turnos, salud, emergencias, quejas, fuera de tema, intentos de cambiar las reglas) **contra el modelo real**: necesita `ANTHROPIC_API_KEY` y gasta tokens (pocos centavos de dólar por corrida). Usa un catálogo ficticio de `evals/cases.ts`. Correlo cada vez que cambies `prompts/claudia.md`.

## Deploy en Vercel

1. Subí el repo a GitHub e importalo en Vercel (team **OMG Que Linda**, `omg-que-linda`). Framework: Next.js; no hace falta tocar el build.
2. **Plan:** Hobby es solo para uso personal/no comercial, y además limita los cron a una vez por día. Para la clínica corresponde **Pro** (verificá la política vigente de Vercel antes de lanzar).
   > **Hoy el proyecto está en Hobby (decidido 6/11/2026, para probar con el sandbox de Meta).** Por eso `vercel.json` tiene los crons una vez por día (09:00 y 09:30 de Uruguay). Al pasar a Pro, volver a `*/5 * * * *` en `process-pending` y `0 * * * *` en `maintenance`: si no, un mensaje cuyo procesamiento falle puede tardar hasta 24 h en reintentarse.
3. Storage → Marketplace → **Neon** → crear la base y conectarla al proyecto (crea `DATABASE_URL`).
4. Settings → Environment Variables: cargá todas las de `.env.example`, marcadas como **Sensitive**. En producción `WHATSAPP_DRY_RUN=false`. `CRON_SECRET` lo usa Vercel Cron automáticamente.
5. Migraciones contra la base de producción (desde tu máquina, con la `DATABASE_URL` de producción):

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

6. Opcional: dominio propio, por ejemplo `claudia.omgquelinda.com` (Settings → Domains).

## Pasos manuales en Meta (los hace el equipo)

Claude Code no puede hacer estos pasos: necesitan los logins del negocio.

1. **Meta Business:** entrá a business.facebook.com con la cuenta del negocio. Si Meta pide verificar el negocio, hacelo (documentación de la empresa).
2. **App:** en developers.facebook.com → *Mis apps* → *Crear app* → tipo *Empresa* → agregá el producto **WhatsApp**. Anotá el **App Secret** (Configuración de la app → Básica) → `WHATSAPP_APP_SECRET`.
3. **Sandbox primero:** WhatsApp → *Configuración de la API* te da un **número de prueba** y un token temporal. Agregá tu celular como destinatario de prueba y probá todo el flujo con ese número antes de tocar el real (`WHATSAPP_PHONE_NUMBER_ID` = el del número de prueba).
4. **Número real con Coexistence:** el onboarding se hace con *Embedded Signup*, escaneando un QR desde la app **WhatsApp Business** del celular (Configuración → Herramientas para la empresa / Plataforma). Verificar antes:
   - que Coexistence esté disponible para Uruguay y para este número;
   - si Meta permite hacerlo directo o exige pasar por un Tech Provider/BSP (en ese caso, elegir uno y seguir su proceso; el código no cambia, solo de dónde salen el token y el número).
   - El throughput con Coexistence es menor (~20 msg/s): de sobra para este volumen.
5. **Token permanente:** Business Settings → Usuarios → **Usuarios del sistema** → crear uno (rol administrador) → asignarle la app y la cuenta de WhatsApp → *Generar token* con permisos `whatsapp_business_messaging` y `whatsapp_business_management`, sin vencimiento → `WHATSAPP_TOKEN`. No uses el token temporal de 24 h.
6. **Webhook:** WhatsApp → Configuración → Webhook:
   - URL: `https://<tu-dominio>/api/whatsapp`
   - Token de verificación: el mismo valor que `WHATSAPP_VERIFY_TOKEN`
   - Suscribirse a `messages` y, con Coexistence, a `smb_message_echoes`.
7. **Plantillas** (WhatsApp Manager → Plantillas de mensajes), idioma **Español (es)**, categoría **Utilidad**. Los nombres tienen que ser exactamente estos (o cambiá `src/lib/templates.ts`):
   - `consulta_seguimiento`: "¡Hola {{1}}! Te escribimos de OMG Que Linda por la consulta que nos dejaste. ¿Seguimos por acá?"
   - `confirmacion_turno`: "¡Hola {{1}}! Te confirmamos tu turno de {{2}} el {{3}}. ¡Te esperamos en OMG Que Linda!"
   - `recordatorio_turno`: "¡Hola {{1}}! Te recordamos tu turno de {{2}} el {{3}} en OMG Que Linda. Si no podés venir, avisanos por acá."
   La aprobación puede tardar de minutos a un par de días.
8. **Anthropic:** en console.anthropic.com crear una API key → `ANTHROPIC_API_KEY`, y poner un **límite de gasto mensual** (Settings → Limits).
9. **Catálogo:** cargar todos los tratamientos con precios en el panel (`/panel/catalogo`), y horarios y dirección en `/panel/config`.

## Costos (a completar antes de lanzar)

| Servicio | Qué se paga | Monto |
|---|---|---|
| Vercel Pro | Por usuario/mes | _verificar_ |
| Neon | Plan según uso (el gratuito puede alcanzar al principio) | _verificar_ |
| Meta (WhatsApp) | Por plantilla entregada (utility/marketing). Mensajes de servicio dentro de la ventana de 24 h: gratis hasta donde se sabe, pero hay fuentes de 2026 que mencionan un tope mensual. **Revisar la página oficial de precios de Meta para Uruguay.** | _verificar_ |
| Anthropic | Por tokens. `claude-sonnet-5-5`: US$ 2 / 1M de entrada, US$ 10 / 1M de salida; el system prompt va cacheado. `claude-haiku-5-5` solo si se activa el modo automático. | según volumen |

## Privacidad y seguridad

- **Ley 18.331** (Uruguay): los datos de salud son datos sensibles. El sistema guarda solo lo necesario; los logs no incluyen contenido de mensajes ni teléfonos (solo IDs internos y errores). Neon cifra en reposo.
- El panel exige login (contraseña compartida + nombre de quien aprueba; cookie firmada `httpOnly`, 12 h).
- Cada webhook se valida con el App Secret; sin firma válida se rechaza.
- Las conversaciones **no** se usan para entrenar modelos (términos de Meta).
- Marketing solo a contactos con opt-in explícito (se registra desde el chat en el panel). Si alguien pide "baja" o "stop", quitarle el opt-in.

## Pendiente / ideas futuras

- Respuestas a las preguntas abiertas del handover §12 (Coexistence para el número actual, quién paga, quiénes aprueban, catálogo real, qué categorías pasan a automático).
- Usuarios individuales en el panel (hoy: una contraseña compartida + nombre).
- Detección automática de "baja/stop" para marketing.
- Integración con Flowww, recordatorios automáticos, transcripción de audios, campañas, reportes (handover §11).
