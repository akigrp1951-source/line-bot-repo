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

// Google APIクライアントをグローバルスコープで一度だけ初期化
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

// --- メイン処理 ---
functions.http('helloWorld', async (req, res ) => {
  console.log('Webhook received:', JSON.stringify(req.body));
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook Error:', err.stack || err);
    res.status(500).send('Error');
  }
});

// --- イベントごとの処理 ---
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return;
  }
  const text = event.message.text.trim();
  let replyText = '';

  try {
    if (text.startsWith('#在庫')) {
      const keyword = text.replace(/^#在庫\s*/, '').trim();
      replyText = await handleInventory(keyword);
    } else if (text.startsWith('#レシピ')) {
      const keyword = text.replace(/^#レシピ\s*/, '').trim();
      replyText = await handleRecipe(keyword);
    } else {
      replyText = "使い方:\n・「#在庫 (商品名)」\n・「#在庫 警戒」\n・「#レシピ (料理名)」";
    }
    await lineClient.replyMessage(event.replyToken, { type: 'text', text: replyText });
  } catch (err) {
    console.error('Handle Event Error:', err.stack || err);
    await lineClient.replyMessage(event.replyToken, { type: 'text', text: '処理中にエラーが発生しました。詳細はログを確認してください。' });
  }
}

// --- 在庫検索 ---
async function handleInventory(keyword) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: DRIVE_CONFIG.inventorySheetId,
      range: 'シート1',
    });
    const rows = response.data.values;
    if (!rows || rows.length === 0) return '在庫データがありません。';
    
    const header = rows[0];
    const data = rows.slice(1);
    const idx = { name: header.indexOf("商品名"), stock: header.indexOf("在庫"), par: header.indexOf("最低在庫") };

    let results = data;
    if (keyword && keyword !== '全体' && keyword !== '警戒') {
      results = data.filter(r => String(r[idx.name]).includes(keyword));
    } else if (keyword === '警戒') {
      results = data.filter(r => Number(r[idx.stock]) < Number(r[idx.par]));
    }

    if (!results.length) return '該当する在庫はありません。';
    
    const lines = results.map(r => {
      const mark = Number(r[idx.stock]) < Number(r[idx.par]) ? '⚠️' : '✅';
      return `${mark} ${r[idx.name]}: ${r[idx.stock]} (最低${r[idx.par]})`;
    });
    return lines.slice(0, 40).join('\n');
  } catch (err) {
    console.error('Inventory Error:', err.stack || err);
    throw new Error('在庫情報の取得に失敗しました。');
  }
}

// --- レシピ検索 ---
async function handleRecipe(keyword) {
  if (!keyword) return '料理名を指定してください。';
  try {
    const file = await findRecipeFile(keyword);
    if (!file) return '該当するレシピが見つかりませんでした。';

    const content = await getFileContent(file.id);
    if (!content) return `【${file.name}】\n\n(本文を読めない形式です)\n${file.webViewLink}`;

    const summary = await summarizeText(content);
    
    return `【${file.name}】\n\n【AI要約】\n${summary}\n\nリンク:\n${file.webViewLink}`;
  } catch (err) {
    console.error('Recipe Error:', err.stack || err);
    throw new Error('レシピの検索・要約中にエラーが発生しました。');
  }
}

async function findRecipeFile(keyword) {
  const response = await drive.files.list({
    q: `'${DRIVE_CONFIG.recipeFolderId}' in parents and name contains '${keyword}' and trashed = false`,
    fields: 'files(id, name, webViewLink)',
    pageSize: 1,
  });
  return response.data.files[0];
}

async function getFileContent(fileId) {
  const response = await drive.files.export({ fileId, mimeType: 'text/plain' });
  return response.data;
}

async function summarizeText(text) {
  try {
    const model = 'gemini-1.0-pro';
    const generativeModel = vertex_ai.getGenerativeModel({ model: model });

    const request = {
      contents: [{
        role: "user",
        parts: [{ text: `以下のレシピ内容を、重要な材料と手順のポイントがわかるように150字程度で簡潔に要約してください。\n\n---\n${text}` }]
      }]
    };

    const result = await generativeModel.generateContent(request);
    const response = result.response;

    if (!response.candidates || response.candidates.length === 0 || !response.candidates[0].content || !response.candidates[0].content.parts || response.candidates[0].content.parts.length === 0) {
        console.error('AIからの応答形式が不正です。');
        throw new Error('AIからの応答形式が不正です。');
    }

    return response.candidates[0].content.parts[0].text;

  } catch (err) {
    console.error('Summarize Error:', err.stack || err);
    throw new Error('AIによる要約に失敗しました。');
  }
}
