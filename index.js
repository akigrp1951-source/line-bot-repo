const functions = require('@google-cloud/functions-framework');
const https = require('https');

const TOKEN = process.env.LINE_ACCESS_TOKEN || ''; // ← 環境変数で設定済み

functions.http('helloWorld', async (req, res) => {
  // 1) ヘルスチェック/ブラウザ/検証など → 常に 200
  if (req.method !== 'POST') {
    return res.status(200).send('OK');
  }
  if (!req.body || !Array.isArray(req.body.events)) {
    return res.status(200).send('OK');
  }

  // 2) 通常のWebhook（メッセージのみエコー）
  const events = req.body.events;
  try {
    await Promise.all(events.map(ev => {
      if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') {
        return Promise.resolve();
      }
      return reply(ev.replyToken, `Echo: ${ev.message.text}`);
    }));
    return res.status(200).send('OK');
  } catch (e) {
    console.error('process error:', e);
    return res.status(200).send('OK'); // ← 失敗しても 200 を返すのがWebhookの作法
  }
});

function reply(replyToken, text) {
  const data = JSON.stringify({ replyToken, messages: [{ type: 'text', text }] });
  const options = {
    hostname: 'api.line.me',
    path: '/v2/bot/message/reply',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`
    }
  };
  return new Promise((resolve, reject) => {
    const rq = https.request(options, rs => {
      let body = '';
      rs.on('data', d => body += d);
      rs.on('end', () => {
        console.log(`Reply API: ${rs.statusCode} ${body}`);
        resolve();
      });
    });
    rq.on('error', reject);
    rq.write(data);
    rq.end();
  });
}
