cat > index.js <<'EOF'
const { GoogleAuth } = require('google-auth-library');

// LINE のチャネルアクセストークン（Cloud Run の環境変数に設定してある想定）
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// ---- Vertex AI (Gemini) を呼ぶ ----
async function generateWithGemini(promptText) {
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    (await auth.getProjectId());

  const location = 'asia-northeast3';
  const model = 'gemini-1.5-flash-latest';
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: promptText }]}],
    generationConfig: { temperature: 0.6, topP: 0.95, maxOutputTokens: 512 },
  };

  const res = await client.request({ url, method: 'POST', data: body });
  const parts = res.data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p.text || '').join('').trim();
  return text || '（AIの応答が空でした）';
}

// ---- LINE に返信 ----
async function replyLine(replyToken, text) {
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LINE_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
    }),
  });
  const body = await res.text();
  console.log('Reply API:', res.status, body);
}

// ai: プレフィックス判定
function wantsAI(t) { return /^ai[:：]\s*/i.test((t||'').trim()); }
function stripAI(t) { return (t||'').trim().replace(/^ai[:：]\s*/i, '').trim(); }

// ---- エクスポート（functions-framework が見る関数）----
exports.webhook = async (req, res) => {
  // ヘルスチェックなど GET は 200 を返す
  if (req.method !== 'POST') {
    res.status(200).send('ok');
    return;
  }

  const events = (req.body && req.body.events) || [];
  await Promise.all(events.map(async (ev) => {
    if (ev.type === 'message' && ev.message?.type === 'text') {
      const text = ev.message.text || '';
      if (wantsAI(text)) {
        const prompt = stripAI(text) || 'こんにちは';
        try {
          const ai = await generateWithGemini(prompt);
          await replyLine(ev.replyToken, ai);
        } catch (e) {
          console.error('Vertex AI error:', e);
          await replyLine(ev.replyToken, 'AI 呼び出しでエラーが発生しました。権限や API 有効化を確認してください。');
        }
      } else {
        await replyLine(ev.replyToken, `Echo: ${text}`);
      }
    }
  }));

  res.status(200).send('OK');
};
EOF
