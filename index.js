const functions = require('@google-cloud/functions-framework');
const line = require('@line/bot-sdk');
const { GoogleAuth } = require('google-auth-library');
const { google } = require('googleapis');
const { VertexAI } = require('@google-cloud/vertexai');

// --- 設定項目 ---
const LINE_CONFIG = {
  channelAccessToken: 'AuCCaWUqCo5ZGG+ANwEy+KrNziz2sLG+8gFRJrjdak3H0BpdTfipVfdXcn6opp9FB2tCb3Ma3EWBCeMZadQ7MUHwKl0EL1muoSLyy6VtskjN5lD8Vp6fbT5HkQpXxw8Xy2ZUUnTBRaq/8AiMId0b3wdB04t89/1O/w1cDnyilFU=',
};

const DRIVE_CONFIG = {
  inventorySheetId: '1Rv7nsO3-peHV62eObGcrm-zj2FJI86a577L0hWk8JT0',
  recipeFolderId: '1WwC910PEtPGiOa6xhBtgeaDde0BJLvi_',
};

const GCP_PROJECT_ID = 'ak-group-line-bot-470510';
const GCP_REGION = 'asia-northeast3';
// --- 設定ここまで ---

console.log('[起動] スクリプト開始');

const lineClient = new line.Client(LINE_CONFIG);
console.log('[起動] LINEクライアント初期化完了');

const auth = new GoogleAuth({
  scopes: [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/cloud-platform'
  ],
  projectId: GCP_PROJECT_ID,
} );
console.log('[起動] GoogleAuthクライアント初期化完了');

const drive = google.drive({ version: 'v3', auth });
const sheets = google.sheets({ version: 'v4', auth });
console.log('[起動] Drive/Sheets APIクライアント初期化完了');

const vertex_ai = new VertexAI({project: GCP_PROJECT_ID, location: GCP_REGION});
const model_instance = vertex_ai.getGenerativeModel({
    model: 'gemini-1.0-pro',
});
console.log('[起動] VertexAIクライアント初期化完了');


// --- メイン処理 ---
functions.http('helloWorld', async (req, res  ) => {
  console.log('[メイン] Webhookリクエスト受信');
  if (req.method !== 'POST') {
    console.error('[メイン] POST以外のメソッドです');
    return res.status(405).send('Method Not Allowed');
  }
  try {
    console.log('[メイン] イベント処理を開始します', JSON.stringify(req.body));
    await Promise.all(req.body.events.map(handleEvent));
    console.log('[メイン] すべてのイベント処理が完了しました');
    res.status(200).send('OK');
  } catch (err) {
    console.error('[メイン] Webhook Error:', err);
    res.status(500).send('Error');
  }
});

// --- イベントごとの処理 ---
async function handleEvent(event) {
  console.log(`[イベント] handleEvent開始: type=${event.type}`);
  if (event.type !== 'message' || event.message.type !== 'text') {
    console.log('[イベント] テキストメッセージではないため処理をスキップします');
    return;
  }
  
  const text = event.message.text.trim();
  console.log(`[イベント] 受信テキスト: "${text}"`);
  let replyText = '';

  try {
    if (text.startsWith('#在庫')) {
      const keyword = text.replace(/^#在庫\s*/, '').trim();
      replyText = await handleInventory(keyword);
    } else if (text.startsWith('#レシピ')) {
      const keyword = text.replace(/^#レシピ\s*/, '').trim();
      replyText = await handleRecipe(keyword);
    } else {
      console.log('[イベント] キーワードに一致しませんでした');
      replyText = "使い方:\n・「#在庫 (商品名)」\n・「#在庫 警戒」\n・「#レシピ (料理名)」";
    }

    console.log(`[イベント] 返信内容: "${replyText.substring(0, 50)}..."`);
    await lineClient.replyMessage(event.replyToken, { type: 'text', text: replyText });
    console.log('[イベント] LINEへの返信が成功しました');

  } catch (err) {
    console.error('[イベント] Handle Event Error:', err);
    try {
      await lineClient.replyMessage(event.replyToken, { type: 'text', text: '内部処理でエラーが発生しました。' });
    } catch (replyErr) {
      console.error('[イベント] エラー通知の返信にも失敗しました:', replyErr);
    }
  }
}

// --- 在庫検索 ---
async function handleInventory(keyword) {
  console.log(`[在庫] handleInventory開始: キーワード="${keyword}"`);
  // ... (在庫機能は省略)
  return `在庫機能は現在デバッグのため停止中です。`;
}

// --- レシピ検索 ---
async function handleRecipe(keyword) {
  console.log(`[レシピ] handleRecipe開始: キーワード="${keyword}"`);
  if (!keyword) {
    console.log('[レシピ] キーワードが空です');
    return '料理名を指定してください。';
  }
  try {
    const file = await findRecipeFile(keyword);
    if (!file) {
      console.log('[レシピ] ファイルが見つかりませんでした');
      return '該当するレシピが見つかりませんでした。';
    }
    console.log(`[レシピ] ファイル発見: ${file.name}`);

    const content = await getFileContent(file.id);
    if (!content) {
      console.log('[レシピ] ファイル内容が空でした');
      return `【${file.name}】\n\n(本文を読めない形式です)\n${file.webViewLink}`;
    }
    console.log(`[レシピ] ファイル内容取得完了。文字数: ${content.length}`);

    const summary = await summarizeText(content);
    console.log(`[レシピ] AI要約完了`);

    return `【${file.name}】\n\n【AI要約】\n${summary}\n\nリンク:\n${file.webViewLink}`;
  } catch (err) {
    console.error('[レシピ] Recipe Error:', err.message, err.stack);
    return 'レシピの検索・要約中にエラーが発生しました。';
  }
}

async function findRecipeFile(keyword) {
  const query = `'${DRIVE_CONFIG.recipeFolderId}' in parents and name contains '${keyword}' and trashed = false`;
  console.log(`[Drive] findRecipeFile実行。クエリ: ${query}`);
  const response = await drive.files.list({
    q: query,
    fields: 'files(id, name, webViewLink)',
    pageSize: 1,
  });
  console.log(`[Drive] API応答: ${JSON.stringify(response.data)}`);
  return response.data.files[0];
}

async function getFileContent(fileId) {
  console.log(`[Drive] getFileContent実行。FileID: ${fileId}`);
  const response = await drive.files.export({ fileId, mimeType: 'text/plain' });
  console.log(`[Drive] export API応答ステータス: ${response.status}`);
  return response.data;
}

// --- AI要約 ---
async function summarizeText(text) {
    const prompt = `以下のレシピ内容を、重要な材料と手順のポイントがわかるように150字程度で簡潔に要約してください。\n\n---\n${text}`;
    console.log(`[VertexAI] summarizeText実行。プロンプト文字数: ${prompt.length}`);
    try {
        const result = await model_instance.generateContent(prompt);
        console.log('[VertexAI] generateContent API応答あり');
        const response = result.response;
        const summary = response.candidates[0].content.parts[0].text;
        console.log(`[VertexAI] 要約取得成功`);
        return summary;
    } catch (err) {
        console.error('[VertexAI] Summarize Error:', err);
        throw new Error('AIによる要約に失敗しました。');
    }
}
