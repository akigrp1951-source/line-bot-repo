// index.js (CommonJS)
const functions = require('@google-cloud/functions-framework');
const { GoogleAuth } = require('google-auth-library');

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LOCATION = process.env.GEMINI_LOCATION || 'asia-northeast1';
const MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash-002';
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT; // Cloud Run なら自動で入る

async function replyToLine(replyToken, text) {
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }]
    })
  });
  const body = await res.text();
  console.log('Reply API:', res.status, body);
  if (!res.ok) throw new Error(`LINE reply failed: ${res.status} ${body}`);
}

async function callGemini(prompt) {
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`;

  const resp = await client.request({
    url,
    method: 'POST',
    data: {
      contents: [{ role: 'user', parts: [{ text: prompt }]}],
      generationConfig: { maxOutputTokens: 256, temperature: 0.7 }
    }
  });

  const cands = resp.data?.candidates || [];
  const text = cands[0]?.content?.parts?.[0]?.text;
  return text || '(すみません、うまく考えがまとまりませんでした)';
}

// Cloud Run（Functions Framework）のHTTPエンドポイント
functions.http('webhook', async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('ok');

  try {
    const events = req.body?.events || [];
    for (const ev of events) {
      if (ev.type === 'message' && ev.message?.type === 'text') {
        const msg = (ev.message.text || '').trim();
        const replyToken = ev.replyToken;

        if (msg.toLowerCase().startsWith('ai:')) {
          const prompt = msg.replace(/^ai:\s*/i, '');
          let answer;
          try {
            answer = await callGemini(prompt);
          } catch (e) {
            console.error('Gemini error:', e);
            answer = `(エラー) いったんエコー返し: ${prompt}`;
          }
          await replyToLine(replyToken, answer);
        } else {
          await replyToLine(replyToken, `Echo: ${msg}`);
        }
      }
    }
    res.status(200).send('ok');
  } catch (e) {
    console.error(e);
    res.status(500).send('error');
  }
});
