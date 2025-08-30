// index.js (Gemini)
const functions = require('@google-cloud/functions-framework');
const https = require('https');
const crypto = require('crypto');
const { VertexAI } = require('@google-cloud/vertexai');

const TOKEN = process.env.LINE_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GEMINI_LOCATION = process.env.GEMINI_LOCATION || 'asia-northeast1';
const GEMINI_TEMPERATURE = Number(process.env.GEMINI_TEMPERATURE || 0.7);
const GEMINI_MAX_TOKENS = Number(process.env.GEMINI_MAX_TOKENS || 400);
const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  'You are a concise assistant. Reply briefly for mobile chat in the user’s language.';

const vertex = new VertexAI({ project: process.env.GOOGLE_CLOUD_PROJECT, location: GEMINI_LOCATION });
const getModel = (name) => vertex.getGenerativeModel({ model: name, systemInstruction: SYSTEM_PROMPT });

const isDummyReplyToken = (t) => !t || t === '00000000000000000000000000000000';
function verifySignature(req) {
  try {
    const sig = req.get('x-line-signature') || '';
    const raw = req.rawBody ? req.rawBody : Buffer.from(JSON.stringify(req.body));
    const expected = crypto.createHmac('sha256', CHANNEL_SECRET).update(raw).digest('base64');
    return sig === expected;
  } catch (e) { console.error('signature-verify-error', e); return false; }
}
function reply(replyToken, text) {
  if (!TOKEN) console.error('Missing LINE_ACCESS_TOKEN');
  if (isDummyReplyToken(replyToken)) { console.log('skip-dummy-token'); return Promise.resolve(); }
  const payload = JSON.stringify({ replyToken, messages: [{ type: 'text', text }] });
  const opt = {
    hostname: 'api.line.me', path: '/v2/bot/message/reply', method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      'Content-Length': Buffer.byteLength(payload),
    },
  };
  return new Promise((resolve) => {
    const rq = https.request(opt, (rs) => {
      const chunks = []; rs.on('data', c => chunks.push(c));
      rs.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        if (rs.statusCode !== 200) console.error('Reply API non-200', { status: rs.statusCode, body });
        else console.log('Reply API 200 OK');
        resolve();
      });
    });
    rq.on('error', (err) => { console.error('Reply API request error', err); resolve(); });
    rq.write(payload); rq.end();
  });
}
async function askGemini(userText, modelName) {
  const model = getModel(modelName);
  const resp = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: { temperature: GEMINI_TEMPERATURE, maxOutputTokens: GEMINI_MAX_TOKENS },
  });
  return resp.response?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ?? '';
}

functions.http('webhook', async (req, res) => {
  if (req.method === 'GET') return res.status(200).send('OK');
  if (req.method !== 'POST') return res.status(200).send('OK');
  if (!verifySignature(req)) return res.status(401).send('unauthorized');

  const events = req.body?.events;
  if (!Array.isArray(events)) return res.status(200).send('OK');

  await Promise.all(events.map(async (ev) => {
    if (ev?.deliveryContext?.isRedelivery) return;
    if (isDummyReplyToken(ev.replyToken)) { console.log('skip-dummy-token'); return; }

    if (ev.type === 'message' && ev.message?.type === 'text') {
      const text = (ev.message.text || '').trim();

      if (text.toLowerCase().startsWith('echo:')) {
        return reply(ev.replyToken, text.slice(5).trim() || '(empty)');
      }

      const wantPro = text.toLowerCase().startsWith('pro:');
      const q = wantPro ? text.slice(4).trim() : text;
      const modelName = wantPro ? 'gemini-1.5-pro' : GEMINI_MODEL;

      try {
        const aiText = await askGemini(q, modelName);
        return reply(ev.replyToken, aiText || '（AIなし：seoul-gemini）'); // 反映確認用
      } catch (e) {
        console.error('Gemini error', e);
        return reply(ev.replyToken, 'ただいまAI応答でエラーが発生しています。');
      }
    }
  })).catch((e) => console.error('handler-error', e));

  return res.status(200).send('OK');
});
