export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const webhookUrl = process.env.N8N_BAG_PREORDER_WEBHOOK_URL || process.env.REACT_APP_N8N_BAG_PREORDER_WEBHOOK_URL
  if (!webhookUrl) {
    return res.status(200).json({ ok: false, skipped: true, error: 'Missing N8N_BAG_PREORDER_WEBHOOK_URL' })
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    })

    const text = await response.text()
    let result = null
    try {
      result = text ? JSON.parse(text) : null
    } catch {
      result = text || null
    }

    if (!response.ok) {
      console.error('n8n bag preorder webhook failed:', response.status, result)
      return res.status(200).json({ ok: false, status: response.status, result })
    }

    return res.status(200).json({ ok: true, status: response.status, result })
  } catch (err) {
    console.error('n8n bag preorder proxy error:', err)
    return res.status(200).json({ ok: false, error: err?.message || 'n8n webhook failed' })
  }
}
