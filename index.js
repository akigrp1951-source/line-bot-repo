const functions = require('@google-cloud/functions-framework');
const https = require('https');

// 環境変数から取得（Cloud Run の 変数 に設定：LINE_ACCESS_TOKEN）
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;

functions.http('helloWorld', async (req, res) => {
  // ヘルスチェック
  if (req.method === 'GET') return res.status(200).send('OK');

  // 検証や不正なPOSTは即200で返す（重要）
  if (req.method !== 'POST' || !req.body || !Array.isArray(req.body.events)) {
    return res.status(200).send('OK');
  }

  try {
    const jobs = req.body.events.map(ev => {
      if (ev.type !== 'message' || ev.message?.type !== 'text') return Promise.resolve();
      return reply(ev.replyToken, `Echo: ${ev.message.text}`);
    });
    await Promise.all(jobs);
    return res.status(200).send('OK');
  } catch (e) {
    console.error('Error processing events:', e);
    return res.status(500).send('Error');
  }
});

function reply(replyToken, text) {
  const payload = JSON.stringify({
    replyToken,
    messages: [{ type: 'text', text }]
  });
  const options = {
    hostname: 'api.line.me',
    path: '/v2/bot/message/reply',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Authorization': `Bearer ${LINE_ACCESS_TOKEN}`
    }
  };
  return new Promise((resolve, reject) => {
    const rq = https.request(options, rs => {
      let body = '';
      rs.on('data', d => (body += d));
      rs.on('end', () => {
        console.log(`Reply API: ${rs.statusCode} ${body}`);
        resolve();
      });
    });
    rq.on('error', reject);
    rq.write(payload);
    rq.end();
  });
}
