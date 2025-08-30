// index.js
const functions = require('@google-cloud/functions-framework');

functions.http('webhook', async (req, res) => {
  if (req.method === 'GET') return res.status(200).send('OK');
  if (req.method !== 'POST' || !req.body || !Array.isArray(req.body.events)) {
    return res.status(200).send('OK');
  }
  return res.status(200).send('received');
});
