// index.js（app.listenは書かない！）
const functions = require('@google-cloud/functions-framework');

// LINE Webhook (HTTP)
functions.http('webhook', async (req, res) => {
  // LINE の疎通確認やGETでも 200 を返しておく
  if (req.method !== 'POST') {
    res.status(200).send('ok');
    return;
  }

  try {
    const events = (req.body && req.body.events) || [];
    await Promise.all(
      events.map(async (ev) => {
        if (ev.type === 'message' && ev.message?.type === 'text') {
          const text = ev.message.text;
          const replyToken = ev.replyToken;

          const body = {
            replyToken,
            messages: [{ type: 'text', text: `ai: ${text}` }],
          };

          const r = await fetch('https://api.line.me/v2/bot/message/reply', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
            },
            body: JSON.stringify(body),
          });

          const respText = await r.text();
          console.log('Reply API:', r.status, respText);
        }
      })
    );

    res.status(200).send('ok');
  } catch (e) {
    console.error(e);
    // LINE に「200」を返さないと再送されるので基本200で返す
    res.status(200).send('ok');
  }
});
