// index.js
const functions = require("@google-cloud/functions-framework");
const { GoogleAuth } = require("google-auth-library");

// ---- 設定（環境変数に無ければデフォルト） ----
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
const LOCATION = process.env.GEMINI_LOCATION || "asia-northeast1";
const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash-002";

// Cloud Run が与えるプロジェクトID
const PROJECT_ID =
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.PROJECT_ID ||  // 予備
  "";

// 共通ログ
const log = (...a) => console.log(...a);
const error = (...a) => console.error(...a);

// ---- Vertex でテキスト生成 ----
async function askGemini(prompt) {
  if (!PROJECT_ID) throw new Error("PROJECT_ID not found (GOOGLE_CLOUD_PROJECT).");
  const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
  const client = await auth.getClient();

  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }]}],
    generationConfig: { maxOutputTokens: 256 }
  };

  const res = await client.request({ url, method: "POST", data: body });
  const cands = res.data?.candidates || [];
  const text = cands[0]?.content?.parts?.[0]?.text || "";
  return text.trim();
}

// ---- LINE 返信 ----
async function replyLine(replyToken, messageText) {
  if (!LINE_TOKEN) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is empty.");
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${LINE_TOKEN}`
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text: messageText }]
    })
  });
  const body = await res.text();
  if (!res.ok) {
    error("Reply API:", res.status, body);
  } else {
    log("Reply API:", res.status, body);
  }
}

// ---- Webhook ----
functions.http("webhook", async (req, res) => {
  // LINE の接続確認などで使う
  if (req.method !== "POST") { res.status(200).send("ok"); return; }

  try {
    const events = req.body?.events || [];
    for (const ev of events) {
      const text = ev.message?.text || "";
      log("incoming-text:", text);

      let out = text; // 既定はエコー
      if (text.toLowerCase().startsWith("ai:")) {
        const q = text.slice(3).trim();
        try {
          out = await askGemini(q);
          if (!out) out = "(空の応答)";
        } catch (e) {
          error("gemini-error", e?.response?.data || e);
          out = "（Geminiへの接続でエラーが発生しました）";
        }
      }
      await replyLine(ev.replyToken, out);
    }
    res.status(200).send("OK");
  } catch (e) {
    error("handler-error", e);
    res.status(200).send("OK");
  }
});
