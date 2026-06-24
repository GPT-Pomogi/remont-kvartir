module.exports = function handler(req, res) {
  res.json({
    kv_url:   !!process.env.UPSTASH_REDIS_REST_URL,
    kv_token: !!process.env.UPSTASH_REDIS_REST_TOKEN,
    tg_token: !!process.env.TG_TOKEN,
    tg_chat:  !!process.env.TG_CHAT_ID,
  });
};
