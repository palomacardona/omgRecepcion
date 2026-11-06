/** Payloads de webhook con la forma que manda Meta (Cloud API). */

export function inboundText(opts: { id: string; from: string; text: string; ts?: number; name?: string }) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "59899000000", phone_number_id: "PHONE_ID" },
              contacts: [{ profile: { name: opts.name ?? "Sofi" }, wa_id: opts.from }],
              messages: [
                {
                  from: opts.from,
                  id: opts.id,
                  timestamp: String(opts.ts ?? Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: opts.text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function inboundAudio(opts: { id: string; from: string; ts?: number }) {
  const p = inboundText({ ...opts, text: "" });
  (p.entry[0].changes[0].value.messages[0] as any) = {
    from: opts.from,
    id: opts.id,
    timestamp: String(opts.ts ?? Math.floor(Date.now() / 1000)),
    type: "audio",
    audio: { id: "MEDIA_ID", mime_type: "audio/ogg; codecs=opus", voice: true },
  };
  return p;
}

export function echo(opts: { id: string; to: string; text: string; ts?: number }) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "smb_message_echoes",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "59899000000", phone_number_id: "PHONE_ID" },
              message_echoes: [
                {
                  from: "59899000000",
                  to: opts.to,
                  id: opts.id,
                  timestamp: String(opts.ts ?? Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: opts.text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function status(opts: { id: string; status: string; ts?: number }) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "59899000000", phone_number_id: "PHONE_ID" },
              statuses: [
                { id: opts.id, status: opts.status, timestamp: String(opts.ts ?? Math.floor(Date.now() / 1000)), recipient_id: "59891111111" },
              ],
            },
          },
        ],
      },
    ],
  };
}
