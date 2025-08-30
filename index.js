const functions = require('@google-cloud/functions-framework');

functions.http('helloWorld', async (req, res) => {
  // L7 の到達確認用ログ（これが出ればコンテナには来ている）
  console.log('hit:', req.method, req.headers['user-agent']);

  // ヘルスチェック / 誤リクエスト / 署名未実装でも、とにかく即 200 を返す
  if (req.method !== 'POST') return res.status(200).send('OK');
  return res.status(200).send('OK');
});
