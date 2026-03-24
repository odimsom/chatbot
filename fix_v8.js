const fs = require('fs');
const fn = 'synset-chatbot-v8-telegram.json';

try {
  const v8 = JSON.parse(fs.readFileSync(fn, 'utf-8'));

  // 1. Añadir el parámetro 'source' a Chatbot API
  const chatbotAPI = v8.nodes.find(n => n.name === 'Chatbot API');
  if (chatbotAPI) {
    const params = chatbotAPI.parameters.bodyParameters.parameters;
    if (!params.find(p => p.name === 'source')) {
      params.push({ name: 'source', value: '={{ $json.source || "whatsapp" }}' });
    }
  }

  // 2. Modificar Enviar Texto WAHA para que use el $json actual
  const txtWAHA = v8.nodes.find(n => n.name === 'Enviar Texto WAHA');
  if (txtWAHA) {
    const params = txtWAHA.parameters.bodyParameters.parameters;
    const chatParam = params.find(p => p.name === 'chatId');
    if (chatParam) {
      chatParam.value = '={{ $json.phone }}'; // Ya no depende estáticamente del nodo de Filtrar
    }
  }

  // 3. Modificar Enviar Telegram API para que use $json.phone
  const tgAPI = v8.nodes.find(n => n.name === 'Enviar Telegram API');
  if (tgAPI && tgAPI.parameters.jsonBody) {
    tgAPI.parameters.jsonBody = tgAPI.parameters.jsonBody.replace(/\$\('Normalizar Telegram'\)\.item\.json\.phone/g, '$json.phone');
  }

  fs.writeFileSync(fn, JSON.stringify(v8, null, 2));
  console.log("Fixed Chatbot API body params and Enviar Texto WAHA references.");
} catch (error) {
  console.error(error);
}
