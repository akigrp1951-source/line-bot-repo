if (ev.type === 'message' && ev.message?.type === 'text') {
  const t = (ev.message.text || '').trim();
  // 何が来ても固定文で返す（切り分け用）
  return reply(ev.replyToken, `【COMECAFE-ONLY】 ${t}`);
  console.log('SEND:', `【COMECAFE-ONLY】 ${t}`);
}
