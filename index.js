const functions = require('@google-cloud/functions-framework');
const https = require('https');

// Cloud Run の「環境変数」で設定する（後述）
const TOKEN = process.env.LINE_ACCESS_TOKEN || '';

/**
 * Cloud Run（Functions Framework）用 HTTP エントリポイント
 * - GET: ヘルスチェック → 200 "OK"
 * - POST:
 *   - body.events が無い/空/検証用でも 200 "OK"
 *   - メッセージイベントなら Echo 返信
 */
functions.http('webhook', async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).send('OK');       // ← これで / への GET が必ず 200
  }

  // Content-Type が text/html でも 200 にしておく（LINEの検証で重要）
  if (!req.body || !Array.isArray(req.body.events)) {
    return res.status(200).send('OK');
  }

  const tasks = req.body.events.map(ev => {
    if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') {
      return Promise.resolve();
    }
    return reply(ev.replyToken, `Echo: ${ev.message.text}`);
  });

  try {
    await Promise.all(tasks);
    return res.status(200).send('OK');
  } catch (e) {
    console.error('reply error:', e);
    // ここも 200 を返す（Webhook 側は 200 であることが最重要）
    return res.status(200).send('OK');
  }
});

function reply(replyToken, text) {
  if (!TOKEN) {
    console.warn('LINE_ACCESS_TOKEN is empty');
    return Promise.resolve();
  }

  const data = JSON.stringify({
    replyToken,
    messages: [{ type: 'text', text }],
  });

  const options = {
    hostname: 'api.line.me',
    path: '/v2/bot/message/reply',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
    },
  };

  return new Promise((resolve, reject) => {
    const rq = https.request(options, (rs) => {
      let body = '';
      rs.on('data', d => body += d);
      rs.on('end', () => {
        console.log('LINE reply:', rs.statusCode, body);
        resolve();
      });
    });
    rq.on('error', reject);
    rq.write(data);
    rq.end();
  });
}
