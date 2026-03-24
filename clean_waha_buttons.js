const fs = require('fs');
const path = 'synset-chatbot-v8-telegram.json';

try {
  const v8 = JSON.parse(fs.readFileSync(path, 'utf-8'));

  // Remove offending nodes
  v8.nodes = v8.nodes.filter(n => n.name !== "Tiene botones?" && n.name !== "Enviar Botones WAHA");

  // Re-route Es Telegram? [false] to Enviar Texto WAHA
  if (v8.connections["Es Telegram?"] && v8.connections["Es Telegram?"].main) {
    v8.connections["Es Telegram?"].main[1] = [{ "node": "Enviar Texto WAHA", "type": "main", "index": 0 }];
  }

  // Ensure Enviar Texto WAHA connects to Respond to Webhook
  if (!v8.connections["Enviar Texto WAHA"]) {
    v8.connections["Enviar Texto WAHA"] = { "main": [[{ "node": "Respond to Webhook", "type": "main", "index": 0 }]] };
  }

  // Remove references from deleted nodes
  delete v8.connections["Tiene botones?"];
  delete v8.connections["Enviar Botones WAHA"];

  fs.writeFileSync(path, JSON.stringify(v8, null, 2));
  console.log("Successfully cleaned WAHA buttons out of v8.");
} catch (error) {
  console.error(error);
}
