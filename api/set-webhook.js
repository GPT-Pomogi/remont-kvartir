module.exports = async function handler(req, res) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host  = req.headers['x-forwarded-host'] || req.headers.host;
  const webhookUrl = `${proto}://${host}/api/webhook`;

  const result = await fetch(
    `https://api.telegram.org/bot${process.env.TG_TOKEN}/setWebhook`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl }),
    }
  );
  const data = await result.json();
  return res.json({ webhookUrl, telegram: data });
};
