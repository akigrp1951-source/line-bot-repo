const functions = require('@google-cloud/functions-framework');
const https = require('https');

const TOKEN = process.env.LINE_ACCESS_TOKEN; // ← 環境変数で管理推奨

functions.http('helloWorld', async (req, res) => {
  if (req.method === 'GET') return res.status(200).send('OK');
  if (req.method !== 'POST' || !req.body || !Array.isArray(req.body.events)) {
    return res.status(200).send('OK');

// LINEの長期アクセストークン（最新に差し替え）
const LINE_ACCESS_TOKEN = 'AuCCaWUqCo5ZGG+ANwEy+KrNziz2sLG+8gFRJrjdak3H0BpdTfipVfdXcn6opp9FB2tCb3Ma3EWBCeMZadQ7MUHwKl0EL1muoSLyy6VtskjN5lD8Vp6fbT5HkQpXxw8Xy2ZUUnTBRaq/8AiMId0b3wdB04t89/1O/w1cDnyilFU=';

functions.http('helloWorld', (req, res) => {
  console.log('Request received:', JSON.stringify(req.body, null, 2));

  // verifyや誤リクエストでも 200 を即返す（LINEの検証で必須）
  if (req.method !== 'POST' || !req.body || !Array.isArray(req.body.events)) {
    return res.status(200).send('OK');
  }

  const promises = req.body.events.map(ev => {
    if (ev.type !== 'message' || ev.message.type !== 'text') return Promise.resolve();
    return reply(ev.replyToken, `Echo: ${ev.message.text}`);
  });

  Promise.all(promises)
    .then(() => res.status(200).send('OK'))
    .catch(err => { console.error(err); res.status(500).send('Error'); });
});

function reply(replyToken, text) {
  const data = JSON.stringify({ replyToken, messages: [{ type: 'text', text }] });
  const options = {
    hostname: 'api.line.me',
    path: '/v2/bot/message/reply',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_ACCESS_TOKEN}` }
  };
  return new Promise((resolve, reject) => {
    const rq = https.request(options, rs => {
      let body = ''; rs.on('data', d => body += d);
      rs.on('end', () => { console.log(`Reply API: ${rs.statusCode} ${body}`); resolve(); });
    });
    rq.on('error', reject); rq.write(data); rq.end();
  });
}

