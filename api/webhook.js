function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isValidLeadId(value) {
  return /^[a-z0-9]{12,32}$/i.test(String(value || '').trim());
}

async function kvRequest(cmd, kvUrl, kvToken) {
  if (!kvUrl || !kvToken) return { result: null };

  const response = await fetch(kvUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kvToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cmd),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`KV HTTP ${response.status}: ${text}`);
  }

  return response.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const webhookSecret = process.env.TG_WEBHOOK_SECRET;
  if (webhookSecret) {
    const receivedSecret = req.headers['x-telegram-bot-api-secret-token'];
    if (receivedSecret !== webhookSecret) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }

  const update = req.body;
  const msg = update?.message;
  if (!msg) return res.json({ ok: true });

  const kvUrl = process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const tgToken = process.env.TG_TOKEN;
  if (!tgToken) {
    return res.status(500).json({ error: 'Server is not configured' });
  }

  if (msg.from?.username) {
    try {
      await kvRequest(
        ['SET', `user:@${String(msg.from.username).toLowerCase()}`, String(msg.chat.id), 'EX', String(60 * 60 * 24 * 30)],
        kvUrl,
        kvToken
      );
    } catch (error) {
      console.error('KV username cache error:', error);
    }
  }

  if (!msg.text?.startsWith('/start')) return res.json({ ok: true });

  const id = msg.text.split(' ')[1]?.trim();
  let text;

  if (id && isValidLeadId(id)) {
    try {
      const { result } = await kvRequest(['GET', `s:${id}`], kvUrl, kvToken);
      const lead = result ? JSON.parse(result) : null;

      text = lead
        ? [
            '<b>Ваша заявка принята</b>',
            '',
            `<b>Имя:</b> ${escapeHtml(lead.name)}`,
            `<b>Телефон:</b> <code>${escapeHtml(lead.phone)}</code>`,
            lead.tg ? `<b>Telegram:</b> ${escapeHtml(lead.tg)}` : '',
            (lead.typeLabel || lead.type) ? `<b>Тип ремонта:</b> ${escapeHtml(lead.typeLabel || lead.type)}` : '',
            (lead.roomsLabel || lead.rooms) ? `<b>Комнат:</b> ${escapeHtml(lead.roomsLabel || lead.rooms)}` : '',
            (lead.whenLabel || lead.when) ? `<b>Когда начать:</b> ${escapeHtml(lead.whenLabel || lead.when)}` : '',
            lead.price ? `<b>Ориентировочно:</b> ${escapeHtml(lead.price)}` : '',
            '',
            '<i>Мы свяжемся с вами в ближайшее время</i>',
          ].filter(Boolean).join('\n')
        : 'Заявка не найдена или устарела. Данные хранятся 24 часа.';
    } catch (error) {
      console.error('Lead lookup error:', error);
      text = 'Не удалось найти заявку. Попробуйте отправить форму еще раз.';
    }
  } else if (id) {
    text = 'Некорректный идентификатор заявки.';
  } else {
    text = 'Привет! Теперь при следующей заявке на сайте копия придет вам автоматически.';
  }

  await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: msg.chat.id,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  }).catch(error => console.error('TG DM error:', error));

  return res.json({ ok: true });
};
