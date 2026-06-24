module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const update = req.body;
  const msg = update?.message;

  if (msg?.text?.startsWith('/start')) {
    const id = msg.text.split(' ')[1]?.trim();
    let text;

    const KV_URL   = process.env.UPSTASH_REDIS_REST_URL;
    const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (id && KV_URL && KV_TOKEN) {
      try {
        const kvRes = await fetch(KV_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(['GET', `s:${id}`]),
        });
        const { result } = await kvRes.json();
        const d = result ? JSON.parse(result) : null;

        if (d) {
          text = [
            `✅ *Ваша заявка принята!*`,
            '',
            `👤 Имя: ${d.name}`,
            `📱 Телефон: \`${d.phone}\``,
            d.tg    ? `✈️ Telegram: ${d.tg}`           : '',
            d.type  ? `🔧 Тип ремонта: ${d.type}`       : '',
            d.rooms ? `🛏 Комнат: ${d.rooms}`            : '',
            d.when  ? `⏰ Начать: ${d.when}`             : '',
            d.price ? `💰 Ориентировочно: *${d.price}*` : '',
            '',
            `_Мы свяжемся с вами в ближайшее время_ 🏠`,
          ].filter(Boolean).join('\n');
        } else {
          text = '⚠️ Заявка не найдена или устарела (данные хранятся 24 часа).';
        }
      } catch (e) {
        console.error('KV read error:', e);
        text = '⚠️ Ошибка при поиске заявки. Попробуйте снова.';
      }
    } else {
      text = '👋 Привет! Заполните форму на сайте, чтобы получить расчёт стоимости ремонта.';
    }

    try {
      await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: msg.chat.id,
          text,
          parse_mode: 'Markdown',
        }),
      });
    } catch (e) {
      console.error('Telegram DM error:', e);
    }
  }

  return res.json({ ok: true });
};
