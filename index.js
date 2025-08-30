const functions = require('@google-cloud/functions-framework');
const line = require('@line/bot-sdk');
const { GoogleAuth } = require('google-auth-library');
const { google } = require('googleapis');
const { VertexAI } = require('@google-cloud/vertexai');

// --- 設定項目 ---
const LINE_CONFIG = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN || 'AuCCaWUqCo5ZGG+ANwEy+KrNziz2sLG+8gFRJrjdak3H0BpdTfipVfdXcn6opp9FB2tCb3Ma3EWBCeMZadQ7MUHwKl0EL1muoSLyy6VtskjN5lD8Vp6fbT5HkQpXxw8Xy2ZUUnTBRaq/8AiMId0b3wdB04t89/1O/w1cDnyilFU=',
};

const DRIVE_CONFIG = {
  inventorySheetId: '1Rv7nsO3-peHV62eObGcrm-zj2FJI86a577L0hWk8JT0',
  recipeFolderId: '1WwC910PEtPGiOa6xhBtgeaDde0BJLvi_',
};

const GCP_PROJECT_ID = 'ak-group-line-bot-470510';
const GCP_REGION = 'asia-northeast3';
// --- 設定ここまで ---

const auth = new GoogleAuth({
  scopes: [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/cloud-platform'
  ],
  projectId: GCP_PROJECT_ID,
} );
const drive = google.drive({ version: 'v3', auth });
const sheets = google.sheets({ version: 'v4', auth });
const vertex_ai = new VertexAI({ project: GCP_PROJECT_ID, location: GCP_REGION });

const lineClient = new line.Client(LINE_CONFIG);

functions.http('helloWorld', async (req, res ) => {
  console.log('START: Webhook received');
  try {
    await Promise.all(req.body.events.map(event => handleEvent(event).catch(e => {
      console.error(`FATAL: Uncaught error in handleEvent for event: ${JSON.stringify(event)}`, e.stack || e);
    })));
    console.log('SUCCESS: All events processed');
    res.status(200).send('OK');
  } catch (err) {
    console.error('FATAL: Webhook main process error:', err.stack || err);
    res.status(500).send('Error');
  }
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    console.log('INFO: Non-text message event ignored.');
    return;
  }
  const text = event.message.text.trim();
  let replyText = '';

  try {
    console.log(`INFO: Processing text: "${text}"`);
    if (text.startsWith('#在庫')) {
      const keyword = text.replace(/^#在庫\s*/, '').trim();
      replyText = await handleInventory(keyword);
    } else if (text.startsWith('#レシピ')) {
      const keyword = text.replace(/^#レシピ\s*/, '').trim();
      replyText = await handleRecipe(keyword);
    } else {
      replyText = "使い方:\n・「#在庫 (商品名)」\n・「#在庫 警戒」\n・「#レシピ (料理名)」";
    }
    
    console.log(`INFO: Replying with: "${replyText}"`);
    await lineClient.replyMessage(event.replyToken, { type: 'text', text: replyText });
    console.log('SUCCESS: Reply message sent.');

  } catch (err) {
    console.error(`ERROR: handleEvent failed for text "${text}":`, err.stack || err);
    try {
      await lineClient.replyMessage(event.replyToken, { type: 'text', text: '内部処理でエラーが発生しました。' });
    } catch (replyErr) {
      console.error('ERROR: Failed to send error reply:', replyErr.stack || replyErr);
    }
  }
}

async function handleInventory(keyword) {
  console.log(`INFO: handleInventory called with keyword: "${keyword}"`);
  // ... (省略) ...
  return "在庫機能は現在デバッグ中です。"; // 一時的に機能を停止
}

async function handleRecipe(keyword) {
  console.log(`INFO: handleRecipe called with keyword: "${keyword}"`);
  if (!keyword) return '料理名を指定してください。';
  
  const file = await findRecipeFile(keyword).catch(e => {
    console.error('ERROR in findRecipeFile:', e.stack || e);
    throw new Error('Google Driveでのファイル検索に失敗しました。');
  });

  if (!file) return '該当するレシピが見つかりませんでした。';
  console.log(`INFO: File found: ${file.name}`);

  const content = await getFileContent(file.id).catch(e => {
    console.error('ERROR in getFileContent:', e.stack || e);
    throw new Error('Google Driveからのファイル内容取得に失敗しました。');
  });

  if (!content) return `【${file.name}】\n\n(本文を読めない形式です)\n${file.webViewLink}`;
  console.log(`INFO: Content length: ${content.length}`);

  const summary = await summarizeText(content).catch(e => {
    console.error('ERROR in summarizeText:', e.stack || e);
    throw new Error('AIによる要約に失敗しました。');
  });
  console.log(`INFO: Summary generated: ${summary}`);

  return `【${file.name}】\n\n【AI要約】\n${summary}\n\nリンク:\n${file.webViewLink}`;
}

async function findRecipeFile(keyword) {
  // ... (省略) ...
  const response = await drive.files.list({
    q: `'${DRIVE_CONFIG.recipeFolderId}' in parents and name contains '${keyword}' and trashed = false`,
    fields: 'files(id, name, webViewLink)',
    pageSize: 1,
  });
  return response.data.files[0];
}

async function getFileContent(fileId) {
  // ... (省略) ...
  const response = await drive.files.export({ fileId, mimeType: 'text/plain' });
  return response.data;
}

async function summarizeText(text) {
    const modelName = `projects/${GCP_PROJECT_ID}/locations/${GCP_REGION}/publishers/google/models/gemini-1.5-flash-001`;

    // APIに渡すリクエストボディ
    const request = {
        contents: [{
            role: "user",
            parts: [{ text: `以下のレシピ内容を、重要な材料と手順のポイントがわかるように150字程度で簡潔に要約してください。\n\n---\n${text}` }]
        }]
    };

    try {
        // メソッドの呼び出し部分を修正
        const genAI = vertex_ai.getGenerativeModel({ model: 'gemini-1.5-flash-001' });
        const [response] = await genAI.generateContent({
            model: modelName,
            contents: request.contents,
        });

        // レスポンスの構造に合わせて修正
        return response.candidates[0].content.parts[0].text;

    } catch (err) {
        // エラーログをより詳細に出力
        console.error('Summarize Error:', err.details || err.message);
        throw new Error('AIによる要約に失敗しました。');
    }
}


