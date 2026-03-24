const fs = require('fs');

const inputFile = 'synset-chatbot-v7-flow.json';
const outputFile = 'synset-chatbot-v8-telegram.json';
const token = "8777787094:AAHihy3ExiYVGJI0pl93cJK8oFkUCwz9v_o";

try {
  const v7 = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
  v7.name = "Synset - WAHA + Telegram v8.0";

  v7.nodes.push({
    "parameters": { "httpMethod": "POST", "path": "telegram", "responseMode": "lastNode", "options": {} },
    "name": "Webhook Telegram", "type": "n8n-nodes-base.webhook", "typeVersion": 1, "position": [220, 820]
  });

  const codeTg = `const results = [];
const tk = "${token}";

for (const item of $input.all()) {
  const update = item.json.body || item.json;
  let phone, messageText;
  
  if (update.callback_query) {
    phone = "tg_" + update.callback_query.from.id;
    messageText = update.callback_query.data;
    
    // Telegram requiere responder a los callbacks para quitar el spinner del botón
    if (update.callback_query.id) {
       try {
         const https = require('https');
         https.get(\`https://api.telegram.org/bot\${tk}/answerCallbackQuery?callback_query_id=\${update.callback_query.id}\`).on('error', () => {});
       } catch(e) {}
    }
  } else if (update.message) {
    phone = "tg_" + update.message.from.id;
    messageText = update.message.text;
  } else continue;

  if (!messageText) continue;

  results.push({
    json: {
      phone: phone,
      message: messageText,
      fromMe: false,
      messageId: "tg_msg_" + Date.now() + Math.floor(Math.random()*100),
      source: "telegram"
    }
  });
}
return results;`;

  v7.nodes.push({
    "parameters": { "jsCode": codeTg },
    "name": "Normalizar Telegram", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [440, 820]
  });

  v7.nodes.push({
    "parameters": {
      "conditions": {
        "options": {},
        "conditions": [{ "id": "tg-check", "leftValue": "={{ $json.source }}", "rightValue": "telegram", "operator": { "type": "string", "operation": "equals" } }],
        "combinator": "and"
      }
    },
    "name": "Es Telegram?", "type": "n8n-nodes-base.if", "typeVersion": 2, "position": [1100, 60]
  });

  v7.nodes.push({
    "parameters": {
      "method": "POST",
      "url": `https://api.telegram.org/bot${token}/sendMessage`,
      "sendBody": true,
      "specifyBody": "json",
      "jsonBody": "={{ JSON.stringify({ chat_id: String($('Normalizar Telegram').item.json.phone).replace('tg_', ''), text: $json.reply, parse_mode: 'Markdown', ...($json.buttons && $json.buttons.length > 0 ? { reply_markup: { inline_keyboard: $json.buttons.map(b => [{ text: b.text, callback_data: String(b.id) }]) } } : {}) }) }}",
      "options": {}
    },
    "name": "Enviar Telegram API", "type": "n8n-nodes-base.httpRequest", "typeVersion": 3, "position": [1320, -100]
  });

  v7.connections["Webhook Telegram"] = { "main": [[{ "node": "Normalizar Telegram", "type": "main", "index": 0 }]] };
  v7.connections["Normalizar Telegram"] = { "main": [[{ "node": "Chatbot API", "type": "main", "index": 0 }]] };

  // Re-route Tiene reply? 
  // v7 original branch 0 was [Tiene botones?, Hay lead?]
  v7.connections["Tiene reply?"]["main"][0] = [
    { "node": "Es Telegram?", "type": "main", "index": 0 },
    { "node": "Hay lead?", "type": "main", "index": 0 }
  ];

  v7.connections["Es Telegram?"] = {
    "main": [
      [{ "node": "Enviar Telegram API", "type": "main", "index": 0 }],
      [{ "node": "Tiene botones?", "type": "main", "index": 0 }]
    ]
  };

  v7.connections["Enviar Telegram API"] = { "main": [[{ "node": "Respond to Webhook", "type": "main", "index": 0 }]] };

  fs.writeFileSync(outputFile, JSON.stringify(v7, null, 2));
  console.log('Successfully generated ' + outputFile);
} catch (error) {
  console.error("Error generating v8:", error);
}
