const functions = require('@google-cloud/functions-framework');
const https = require('https');

const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN; // ←環境変数推奨

functions.http('webhook', async (req, res) => {
  if (req.method === 'GET') return res.status(200).send('OK');

  if (req.method !== 'POST' || !req.body || !Array.isArray(req.body.events)) {
    return res.status(200).send('OK'); // LINEの検証や空POSTにも200返す
  }

  const events = req.body.events;
  const tasks = events.map(ev => {
    if (ev.type !== 'message' || ev.message?.type !== 'text') return Promise.resolve();
    return reply(ev.replyToken, `Echo: ${ev.message.text}`);
  });

  try {
    await Promise.all(tasks);
    return res.status(200).send('OK');
  } catch (e) {
    console.error(e);
    return res.status(500).send('Error');
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
      Authorization: `Bearer ${LINE_ACCESS_TOKEN}`,
    },
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
    rq.write(data);
    rq.end();
  });
}
