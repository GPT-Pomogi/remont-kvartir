module.exports = function handler(req, res) {
  res.json({
    kv_url:   !!process.env.KV_REST_API_URL,
    kv_token: !!process.env.KV_REST_API_TOKEN,
    tg_token: !!process.env.TG_TOKEN,
    tg_chat:  !!process.env.TG_CHAT_ID,
  });
};
