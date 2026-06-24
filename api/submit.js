module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const d = req.body;
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  // Save to Upstash Redis with 24h TTL
  const KV_URL   = process.env.UPSTASH_REDIS_REST_URL;
  const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (KV_URL && KV_TOKEN) {
    try {
      await fetch(KV_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['SET', `s:${id}`, JSON.stringify(d), 'EX', '86400']),
      });
    } catch (e) {
      console.error('KV write error:', e);
    }
  }

  const TG_API = `https://api.telegram.org/bot${process.env.TG_TOKEN}`;

  // Get bot username for the deep link
  let botUsername = null;
  try {
    const meRes = await fetch(`${TG_API}/getMe`);
    const me = await meRes.json();
    botUsername = me.result?.username ?? null;
  } catch (e) {}

  // Create forum topic + send message to owner's group
  try {
    const topicRes = await fetch(`${TG_API}/createForumTopic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TG_CHAT_ID,
        name: d.siteName || 'remont-kvartir-pf',
        icon_color: 16478047,
      }),
    });
    const topicJson = await topicRes.json();
    const threadId = topicJson.result?.message_thread_id;

    const lines = [
      `🏠 *Новая заявка* — ${d.source}`,
      '',
      `👤 Имя: ${d.name}`,
      `📱 Телефон: \`${d.phone}\``,
      d.tg    ? `✈️ Telegram: ${d.tg}`              : '',
      d.type  ? `🔧 Тип ремонта: ${d.type}`          : '',
      d.rooms ? `🛏 Комнат: ${d.rooms}`               : '',
      d.when  ? `⏰ Начать: ${d.when}`                : '',
      d.price ? `💰 Ориентировочно: *${d.price}*`    : '',
      '',
      `🌐 [${d.siteName}](${d.siteUrl})`,
      `ℹ️ _Портфолио — все формы рабочие, можно тестировать_`,
    ].filter(l => l !== undefined && !(l === '' && false)).join('\n');

    await fetch(`${TG_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TG_CHAT_ID,
        message_thread_id: threadId,
        text: lines,
        parse_mode: 'Markdown',
      }),
    });
  } catch (e) {
    console.error('Telegram group error:', e);
    return res.status(500).json({ error: 'Telegram send failed' });
  }

  return res.json({
    ok: true,
    startLink: botUsername ? `https://t.me/${botUsername}?start=${id}` : null,
  });
};
