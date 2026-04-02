import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') || ''
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') || ''
const TWILIO_FROM = Deno.env.get('TWILIO_WHATSAPP_FROM') || ''  // e.g. 14155238886
const AGENT_WHATSAPP = Deno.env.get('AGENT_WHATSAPP') || ''     // e.g. 355697392683

async function sendWhatsApp(to: string, body: string) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`
  const form = new URLSearchParams()
  form.append('From', `whatsapp:+${TWILIO_FROM}`)
  form.append('To', `whatsapp:+${to}`)
  form.append('Body', body)
  await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  })
}

serve(async (req) => {
  const { action, watch, dealer_name, dealer_whatsapp, offer_price, counter_price, dealer_comment, agent_comment } = await req.json()

  const item = `${watch?.brand} ${watch?.model}`

  if (action === 'new_offer') {
    // Notify agent
    let msg = `New offer from ${dealer_name} on *${item}*:\n\n*€${Number(offer_price).toLocaleString()}*`
    if (dealer_comment) msg += `\n\n"${dealer_comment}"`
    await sendWhatsApp(AGENT_WHATSAPP, msg)

  } else if (action === 'countered') {
    // Notify dealer
    if (!dealer_whatsapp) return new Response('no dealer whatsapp', { status: 200 })
    let msg = `Your offer on *${item}* has been countered:\n\n*€${Number(counter_price).toLocaleString()}*`
    if (agent_comment) msg += `\n\n"${agent_comment}"`
    await sendWhatsApp(dealer_whatsapp, msg)

  } else if (action === 'accepted') {
    // Notify dealer
    if (!dealer_whatsapp) return new Response('no dealer whatsapp', { status: 200 })
    let msg = `Your offer on *${item}* has been accepted at *€${Number(offer_price).toLocaleString()}*`
    if (agent_comment) msg += `\n\n"${agent_comment}"`
    await sendWhatsApp(dealer_whatsapp, msg)

  } else if (action === 'rejected') {
    // Notify dealer
    if (!dealer_whatsapp) return new Response('no dealer whatsapp', { status: 200 })
    let msg = `Your offer on *${item}* has been declined.`
    if (agent_comment) msg += `\n\n"${agent_comment}"`
    await sendWhatsApp(dealer_whatsapp, msg)

  } else if (action === 'dealer_accepted') {
    // Notify agent that dealer accepted counter
    let msg = `${dealer_name} accepted your counter of *€${Number(counter_price).toLocaleString()}* on *${item}*. Time to reserve it.`
    await sendWhatsApp(AGENT_WHATSAPP, msg)

  } else if (action === 'dealer_rejected') {
    // Notify agent that dealer rejected counter
    let msg = `${dealer_name} declined your counter offer on *${item}*.`
    await sendWhatsApp(AGENT_WHATSAPP, msg)
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
