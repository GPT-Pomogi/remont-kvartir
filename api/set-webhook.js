module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const setupSecret = process.env.WEBHOOK_SETUP_SECRET;
  if (setupSecret) {
    const providedSecret = req.headers['x-setup-secret'] || req.query?.secret;
    if (providedSecret !== setupSecret) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }

  const tgToken = process.env.TG_TOKEN;
  if (!tgToken) {
    return res.status(500).json({ error: 'Server is not configured' });
  }

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const webhookUrl = `${proto}://${host}/api/webhook`;

  const payload = { url: webhookUrl };
  if (process.env.TG_WEBHOOK_SECRET) {
    payload.secret_token = process.env.TG_WEBHOOK_SECRET;
  }

  const result = await fetch(`https://api.telegram.org/bot${tgToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await result.json();

  if (!result.ok || !data.ok) {
    return res.status(502).json({ error: 'Telegram webhook setup failed', details: data });
  }

  return res.json({ ok: true, webhookUrl });
};
