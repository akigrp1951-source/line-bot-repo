cd ~/line-bot

cat > index.js <<'EOF'
'use strict';

const { GoogleAuth } = require('google-auth-library');
const functions = require('@google-cloud/functions-framework');

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GEMINI_LOCATION = process.env.GEMINI_LOCATION || 'asia-northeast1';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash-002';

async function callGemini(prompt) {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const url = `https://${GEMINI_LOCATION}-aiplatform.googleapis.com/v1/projects/${project}/locations/${GEMINI_LOCATION}/publishers/google/models/${GEMINI_MODEL}:generateContent`;

  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const token = await client.getAccessToken();

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }]}],
    generationConfig: { maxOutputTokens: 256 }
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.token || token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!r.ok) {
    const t = await r.text();
    console.log('gemini-non200', r.status, t);
    throw new Error(`Gemini ${r.status}`);
  }

  const j = await r.json();
  const text = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? '(空の応答)';
  return text.trim();
}

async function replyLine(replyToken, text) {
  const r = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${LINE_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] })
  });
  const txt = await r.text();
  console.log('Reply API:', r.status, txt);
}

functions.http('webhook', async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  const events = req.body?.events || [];

  for (const ev of events) {
    try {
      if (ev.type === 'message' && ev.message?.type === 'text') {
        const raw = ev.message.text || '';
        console.log('incoming-text:', raw);

        if (/^ai:\s*/i.test(raw)) {
          const prompt = raw.replace(/^ai:\s*/i, '').trim();
          let answer;
          try {
            answer = await callGemini(prompt);
          } catch (e) {
            answer = '（Gemini 呼び出しでエラーが発生しました）';
          }
          await replyLine(ev.replyToken, answer);
        } else {
          await replyLine(ev.replyToken, `Echo: ${raw}`);
        }
      }
    } catch (e) {
      console.error('event-error', e);
    }
  }

  res.status(200).json({ ok: true });
});
EOF
