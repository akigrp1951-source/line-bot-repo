const functions = require('@google-cloud/functions-framework');

functions.http('helloWorld', (req, res) => {
  console.log('hit:', req.method, req.headers['user-agent']);
  return res.status(200).send('OK'); // どんなリクエストでも 200 即返す
});
