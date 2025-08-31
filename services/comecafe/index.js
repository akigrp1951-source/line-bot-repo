cat > index.js <<'EOF'
/**
 * Cloud Run (Functions Framework) 最小実装
 * ポイント: app.listen は書かない。GET も 200 を返してヘルスチェックに通す。
 */
exports.webhook = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(200).send('ok');
    return;
  }

  try {
    const events = (req.body && req.body.events) || [];
    await Promise.all(events.map(async (ev) => {
      if (ev.type === 'message' && ev.message?.type === 'text') {
        const replyToken = ev.replyToken;
        const body = {
          replyToken,
          messages: [{ type: 'text', text: `ai: ${ev.message.text}` }]
        };
        const r = await fetch('https://api.line.me/v2/bot/message/reply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
          },
          body: JSON.stringify(body),
        });
        console.log('Reply API:', r.status, await r.text());
      }
    }));
    res.status(200).send('ok');
  } catch (e) {
    console.error(e);
    res.status(200).send('ok'); // 再送ループ防止
  }
};
EOF
