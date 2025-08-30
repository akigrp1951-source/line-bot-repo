// services/comecafe/index.js
const functions = require('@google-cloud/functions-framework');
const https = require('https');
const crypto = require('crypto');

const TOKEN = process.env.LINE_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

function verifySignature(req) {
  try {
    const sig = req.get('x-line-signature') || '';
    const raw = req.rawBody ? req.rawBody : Buffer.from(JSON.stringify(req.body));
    const expected = crypto.createHmac('sha256', CHANNEL_SECRET).update(raw).digest('base64');
    return sig === expected;
  } catch { return false; }
}

function reply(replyToken, text) {
  const payload = JSON.stringify({ replyToken, messages: [{ type: 'text', text }] });
  return new Promise((resolve) => {
    const rq = https.request({
      hostname: 'api.line.me',
      path: '/v2/bot/message/reply',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (rs) => { rs.on('data',()=>{}); rs.on('end', resolve); });
    rq.on('error', resolve);
    rq.write(payload); rq.end();
  });
}

functions.http('webhook', async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('OK');
  if (!verifySignature(req)) return res.status(401).send('unauthorized');

  const evs = req.body?.events || [];
  await Promise.all(evs.map(async (ev) => {
    if (ev?.deliveryContext?.isRedelivery) return;
    if (ev.type === 'message' && ev.message?.type === 'text') {
      const t = (ev.message.text || '').trim();
      return reply(ev.replyToken, `【COMECAFE-ONLY】 ${t}`);
    }
  }));

  return res.status(200).send('OK');
});
