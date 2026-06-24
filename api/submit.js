const { randomUUID } = require('node:crypto');

const MAX_FIELD_LENGTH = 120;
const PHONE_MIN_DIGITS = 10;
const PHONE_MAX_DIGITS = 15;
const allowedTypes = new Set(['cosmetic', 'capital', 'designer']);
const allowedRooms = new Set(['38', '55', '72', '95']);
const allowedWhen = new Set(['asap', '1-3m', 'later']);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanText(value, maxLength = MAX_FIELD_LENGTH) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function cleanPhone(value) {
  const trimmed = String(value || '').trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < PHONE_MIN_DIGITS || digits.length > PHONE_MAX_DIGITS) {
    return null;
  }

  return trimmed.slice(0, 32);
}

function cleanTelegram(value) {
  const normalized = String(value || '').trim().replace(/^@/, '');
  return /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(normalized) ? `@${normalized}` : null;
}

function cleanSiteUrl(rawUrl, fallbackUrl) {
  try {
    const parsed = new URL(String(rawUrl || fallbackUrl));
    if (!['http:', 'https:'].includes(parsed.protocol)) return fallbackUrl;
    return parsed.origin;
  } catch {
    return fallbackUrl;
  }
}

function buildExpectedOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return host ? `${proto}://${host}` : '';
}

function isAllowedOrigin(req, expectedOrigin) {
  const origin = req.headers.origin;
  if (!origin) return true;

  const configured = process.env.ALLOWED_ORIGIN;
  if (configured) return origin === configured;
  return origin === expectedOrigin;
}

async function postJson(url, token, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return response.json();
}

async function rateLimit(req, kvUrl, kvToken) {
  if (!kvUrl || !kvToken) return;

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0]
    .trim()
    .slice(0, 80);
  const key = `rate:${ip}:${new Date().toISOString().slice(0, 13)}`;

  const increment = await postJson(kvUrl, kvToken, ['INCR', key]);
  const hits = Number(increment.result || 0);
  if (hits === 1) {
    await postJson(kvUrl, kvToken, ['EXPIRE', key, '3600']);
  }

  if (hits > 10) {
    const error = new Error('Too many requests');
    error.statusCode = 429;
    throw error;
  }
}

function normalizeLead(body, fallbackUrl, fallbackSiteName) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  const source = cleanText(body.source, 80);
  const name = cleanText(body.name, 80);
  const phone = cleanPhone(body.phone);
  const tg = cleanTelegram(body.tg);
  const price = cleanText(body.price, 40);
  const siteName = cleanText(body.siteName, 40) || fallbackSiteName;

  if (!source || !name || !phone || !tg) return null;

  const normalized = {
    source,
    name,
    phone,
    tg,
    siteName,
    siteUrl: cleanSiteUrl(body.siteUrl, fallbackUrl),
  };

  if (price) normalized.price = price;
  if (body.type && allowedTypes.has(body.type)) normalized.type = body.type;
  if (body.rooms && allowedRooms.has(body.rooms)) normalized.rooms = body.rooms;
  if (body.when && allowedWhen.has(body.when)) normalized.when = body.when;

  if (!normalized.type && body.typeLabel) normalized.typeLabel = cleanText(body.typeLabel, 40);
  if (!normalized.rooms && body.roomsLabel) normalized.roomsLabel = cleanText(body.roomsLabel, 40);
  if (!normalized.when && body.whenLabel) normalized.whenLabel = cleanText(body.whenLabel, 40);

  if (!normalized.type && !normalized.typeLabel && body.type) {
    normalized.typeLabel = cleanText(body.type, 40);
  }
  if (!normalized.rooms && !normalized.roomsLabel && body.rooms) {
    normalized.roomsLabel = cleanText(body.rooms, 40);
  }
  if (!normalized.when && !normalized.whenLabel && body.when) {
    normalized.whenLabel = cleanText(body.when, 40);
  }

  return normalized;
}

module.exports = async function handler(req, res) {
  const expectedOrigin = buildExpectedOrigin(req);

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (isAllowedOrigin(req, expectedOrigin) && req.headers.origin) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  }

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAllowedOrigin(req, expectedOrigin)) {
    return res.status(403).json({ error: 'Forbidden origin' });
  }

  const tgToken = process.env.TG_TOKEN;
  const tgChatId = process.env.TG_CHAT_ID;
  if (!tgToken || !tgChatId) {
    return res.status(500).json({ error: 'Server is not configured' });
  }

  const lead = normalizeLead(req.body, expectedOrigin, (req.headers.host || 'site').split('.')[0]);
  if (!lead) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const kvUrl = process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  try {
    await rateLimit(req, kvUrl, kvToken);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ error: error.message });
  }

  const id = randomUUID().replace(/-/g, '').slice(0, 20);

  if (kvUrl && kvToken) {
    try {
      await postJson(kvUrl, kvToken, ['SET', `s:${id}`, JSON.stringify(lead), 'EX', '86400']);
    } catch (error) {
      console.error('KV write error:', error);
    }
  }

  const tgApi = `https://api.telegram.org/bot${tgToken}`;
  let botUsername = null;

  try {
    const meRes = await fetch(`${tgApi}/getMe`);
    const me = await meRes.json();
    if (meRes.ok && me.ok) {
      botUsername = me.result?.username ?? null;
    }
  } catch (error) {
    console.error('Telegram getMe error:', error);
  }

  const safeName = escapeHtml(lead.name);
  const safePhone = escapeHtml(lead.phone);
  const safeTg = escapeHtml(lead.tg);
  const safeSource = escapeHtml(lead.source);
  const safeSiteName = escapeHtml(lead.siteName);
  const safeSiteUrl = escapeHtml(lead.siteUrl);
  const safeType = escapeHtml(lead.typeLabel || lead.type || 'не указан');
  const safeRooms = escapeHtml(lead.roomsLabel || lead.rooms || 'не указано');
  const safeWhen = escapeHtml(lead.whenLabel || lead.when || 'не указано');
  const safePrice = escapeHtml(lead.price || 'не указана');

  try {
    const topicRes = await fetch(`${tgApi}/createForumTopic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: tgChatId,
        name: `Заявка: ${lead.name}`.slice(0, 120),
        icon_color: 16478047,
      }),
    });
    const topicJson = await topicRes.json();
    if (!topicRes.ok || !topicJson.ok || !topicJson.result?.message_thread_id) {
      throw new Error(JSON.stringify(topicJson));
    }

    const lines = [
      `<b>Новая заявка</b> - ${safeSource}`,
      '',
      `<b>Имя:</b> ${safeName}`,
      `<b>Телефон:</b> <code>${safePhone}</code>`,
      `<b>Telegram:</b> ${safeTg}`,
      `<b>Тип ремонта:</b> ${safeType}`,
      `<b>Комнат:</b> ${safeRooms}`,
      `<b>Когда начать:</b> ${safeWhen}`,
      `<b>Ориентировочно:</b> ${safePrice}`,
      '',
      `<a href="${safeSiteUrl}">${safeSiteName}</a>`,
      '<i>Портфолио: формы рабочие, можно тестировать</i>',
    ].join('\n');

    const sendRes = await fetch(`${tgApi}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: tgChatId,
        message_thread_id: topicJson.result.message_thread_id,
        text: lines,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const sendJson = await sendRes.json();
    if (!sendRes.ok || !sendJson.ok) {
      throw new Error(JSON.stringify(sendJson));
    }
  } catch (error) {
    console.error('Telegram group error:', error);
    return res.status(502).json({ error: 'Telegram send failed' });
  }

  return res.json({
    ok: true,
    startLink: botUsername ? `https://t.me/${botUsername}?start=${id}` : null,
  });
};
