// index.js
const functions = require('@google-cloud/functions-framework');
const https = require('https');
const crypto = require('crypto');

// ★ 環境変数
const TOKEN = process.env.LINE_ACCESS_TOKEN;        // チャネルアクセストークン（長期）
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET; // チャネルシークレット

// --- 署名検証（X-Line-Signature） ---
function verifySignature(req) {
  try {
    const signature = req.get('x-line-signature') || '';
    // functions-framework 環境では rawBody が入る（なければ body から生成）
    const raw = req.rawBody ? req.rawBody : Buffer.from(JSON.stringify(req.body));
    const expected = crypto.createHmac('sha256', CHANNEL_SECRET)
      .update(raw)
      .digest('base64');
    return signature === expected;
  } catch (e) {
    console.error('signature-verify-error', e);
    return false;
  }
}

// --- LINE 返信 ---
function reply(replyToken, text) {
  if (!TOKEN) {
    console.error('Missing env LINE_ACCESS_TOKEN');
    return Promise.resolve(); // WebhookはACK優先なので失敗でも200返す
  }
  const payload = JSON.stringify({
    replyToken,
    messages: [{ type: 'text', text }],
  });

  const opt = {
    hostname: 'api.line.me',
    path: '/v2/bot/message/reply',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  return new Promise((resolve) => {
    const rq = https.request(opt, (rs) => {
      const chunks = [];
      rs.on('data', (c) => chunks.push(c));
      rs.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        if (rs.statusCode !== 200) {
          console.error('line-reply-non200', { status: rs.statusCode, body });
        } else {
          console.log('line-reply-200');
        }
        resolve();
      });
    });
    rq.on('error', (err) => {
      console.error('line-reply-error', err);
      resolve();
    });
    rq.write(payload);
    rq.end();
  });
}

// --- エンドポイント本体 ---
functions.http('webhook', async (req, res) => {
  // ヘルスチェック
  if (req.method === 'GET') return res.status(200).send('OK');

  // POST以外は200でACK（LINE検証や空POSTも成功させる）
  if (req.method !== 'POST') return res.status(200).send('OK');

  // 署名検証（本番必須）
  if (!verifySignature(req)) {
    // 署名不一致は401を返す（LINEは再送することがあります）
    return res.status(401).send('unauthorized');
  }

  const events = req.body?.events;
  if (!Array.isArray(events)) return res.status(200).send('OK');

  // 各イベント処理
  await Promise.all(
    events.map(async (ev) => {
      // 再送（Redelivery）は無視して冪等性を確保
      if (ev?.deliveryContext?.isRedelivery) {
        console.log('skip-redelivery', ev?.message?.id || ev?.replyToken);
        return;
      }
      // テキストのみエコー
      if (ev.type === 'message' && ev.message?.type === 'text') {
        const text = `Echo: ${ev.message.text}`;
        await reply(ev.replyToken, text);
      }
    })
  ).catch((e) => console.error('handler-error', e));

  // Webhookは常に200でACK
  return res.status(200).send('OK');
});
