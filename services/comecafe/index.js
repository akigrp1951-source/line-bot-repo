const functions = require('@google-cloud/functions-framework');
const https = require('https');
const crypto = require('crypto');
const { GoogleAuth } = require('google-auth-library'); // ← 追加

const TOKEN = process.env.LINE_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

// --- 署名検証 ---
function verifySignature(req) {
  try {
    const signature = req.get('x-line-signature') || '';
    const raw = req.rawBody ? req.rawBody : Buffer.from(JSON.stringify(req.body));
    const expected = crypto.createHmac('sha256', CHANNEL_SECRET).update(raw).digest('base64');
    return signature === expected;
  } catch (e) { console.error('signature-verify-error', e); return false; }
}

// --- LINE 返信 ---
function reply(replyToken, text) {
  if (!TOKEN) { console.error('Missing env LINE_ACCESS_TOKEN'); return Promise.resolve(); }
  const payload = JSON.stringify({ replyToken, messages: [{ type: 'text', text }] });
  const opt = {
    hostname: 'api.line.me',
    path: '/v2/bot/message/reply',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, 'Content-Length': Buffer.byteLength(payload) }
  };
  return new Promise((resolve) => {
    const rq = https.request(opt, (rs) => { const chunks=[]; rs.on('data',c=>chunks.push(c)); rs.on('end', ()=>{ 
      const body = Buffer.concat(chunks).toString();
      if (rs.statusCode !== 200) console.error('line-reply-non200', { status: rs.statusCode, body });
      resolve();
    });});
    rq.on('error', (err)=>{ console.error('line-reply-error', err); resolve(); });
    rq.write(payload); rq.end();
  });
}

// --- Gemini（Vertex AI） ---
async function askGemini(prompt) {
  const project = process.env.GCP_PROJECT || process.env.GCLOUD_PROJECT;
  const url = `https://asia-northeast3-aiplatform.googleapis.com/v1/projects/${project}/locations/asia-northeast3/publishers/google/models/gemini-1.5-flash:generateContent`;

  // サービスアカウントでアクセストークン取得
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const tokenObj = await client.getAccessToken();
  const token = typeof tokenObj === 'object' ? tokenObj.token : tokenObj;

  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }]}],
    generationConfig: { maxOutputTokens: 512, temperature: 0.7 }
  });

  return new Promise((resolve) => {
    const u = new URL(url);
    const rq = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (rs) => {
      const chunks=[]; rs.on('data',c=>chunks.push(c));
      rs.on('end', ()=>{
        const txt = Buffer.concat(chunks).toString();
        try {
          const j = JSON.parse(txt);
          const out = j.candidates?.[0]?.content?.parts?.map(p=>p.text).join('') || '(no answer)';
          resolve(out);
        } catch (e) {
          console.error('gemini-json-parse', e, txt);
          resolve('(error)');
        }
      });
    });
    rq.on('error', (e)=>{ console.error('gemini-request', e); resolve('(error)'); });
    rq.write(body); rq.end();
  });
}

// --- エンドポイント ---
functions.http('webhook', async (req, res) => {
  if (req.method === 'GET') return res.status(200).send('OK');
  if (req.method !== 'POST') return res.status(200).send('OK');
  if (!verifySignature(req)) return res.status(401).send('unauthorized');

  const events = req.body?.events;
  if (!Array.isArray(events)) return res.status(200).send('OK');

  await Promise.all(events.map(async (ev) => {
    if (ev?.deliveryContext?.isRedelivery) return;
    if (ev.type === 'message' && ev.message?.type === 'text') {
      const t = (ev.message.text || '').trim();

      // ▼ ここだけ分岐： "ai:" で始まったら Gemini、それ以外はエコー
      if (/^ai:/i.test(t)) {
        const prompt = t.replace(/^ai:/i, '').trim() || 'こんにちは';
        const ans = await askGemini(prompt);
        // LINEの文字数制限（約5000文字）ガード
        return reply(ev.replyToken, ans.slice(0, 4900));
      }
      return reply(ev.replyToken, `Echo: ${t}`);
    }
  })).catch((e)=>console.error('handler-error', e));

  return res.status(200).send('OK');
});
