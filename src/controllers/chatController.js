const stateService = require('../services/stateService');

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const MENU_PRINCIPAL =
    "👋 Hola! Soy el asistente de *Synset Solutions*.\n" +
    "Optimizamos tu negocio con tecnología 🚀\n\n" +
    "¿Qué deseas hacer?\n" +
    "1️⃣ Servicios\n" +
    "2️⃣ Sectores\n" +
    "3️⃣ Preguntas frecuentes\n" +
    "4️⃣ Hablar con un asesor";

async function sendLeadWebhook(phone, lead) {
    if (!process.env.WEBHOOK_URL) return;
    try {
        await fetch(process.env.WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(lead)
        });
        console.log(JSON.stringify({ type: 'webhook_sent', phone }));
    } catch (err) {
        console.error(JSON.stringify({ type: 'webhook_error', phone, error: err.message }));
    }
}

async function handleChat(req, res) {
    try {
        const { phone, message, fromMe, messageId } = req.body;

        if (fromMe === true) return res.json({ reply: null });
        if (await stateService.isDuplicate(messageId)) return res.json({ reply: null });
        if (!phone) return res.status(400).json({ error: 'phone is required' });
        if (phone.endsWith('@g.us')) return res.json({ reply: null });
        if (phone.endsWith('@lid')) return res.json({ reply: null });
        if (await stateService.isInHumanMode(phone)) return res.json({ reply: null });
        if (await stateService.isInCooldown(phone)) return res.json({ reply: null });

        const message_text = (message || '').trim();
        if (!message_text) return res.json({ reply: null });

        const currentState = await stateService.getUserState(phone);
        let currentStep = currentState.step;
        let lead = currentState.lead || {};
        let reply = '';
        let responseLead = null;
        let nextStep = currentStep;

        const input = message_text.toLowerCase();
        
        const isOption1 = input === '1' || input === '1.' || input === 'uno';
        const isOption2 = input === '2' || input === '2.' || input === 'dos';
        const isOption3 = input === '3' || input === '3.' || input === 'tres';
        const isOption4 = input === '4' || input === '4.' || input === 'cuatro';

        const STEPS = stateService.STEPS;

        switch (currentStep) {
            case STEPS.STEP_0:
                reply = MENU_PRINCIPAL;
                nextStep = STEPS.STEP_1;
                break;

            case STEPS.STEP_1:
                if (isOption1) {
                    reply =
                        "🛠️ *Nuestros Servicios*\n\n" +
                        "✅ *Control operativo*\n" +
                        "⚡ *Automatización*\n" +
                        "📊 *Tableros de KPIs*\n" +
                        "🤖 *Chatbots 24/7*\n\n" +
                        "¿Agendamos una auditoría gratuita?\n" +
                        "1️⃣ Sí, agendar\n" +
                        "2️⃣ Volver";
                    nextStep = STEPS.STEP_SERVICIOS;
                } else if (isOption2) {
                    reply =
                        "🏪 *Sectores que atendemos*\n\n" +
                        "🛒 *Retail y minimarkets*\n" +
                        "🏢 *Empresas de servicios*\n\n" +
                        "¿Hablamos sobre tu negocio?\n" +
                        "1️⃣ Sí, hablar con asesor\n" +
                        "2️⃣ Volver";
                    nextStep = STEPS.STEP_SECTORES;
                } else if (isOption3) {
                    reply =
                        "❓ *Preguntas Frecuentes*\n\n" +
                        "*¿Empresas pequeñas?* Sí, de todo tamaño.\n" +
                        "*¿Qué software necesito?* Te asesoramos gratis.\n" +
                        "*¿Soporte?* Directo y sin intermediarios.\n" +
                        "*¿Tiempo de implementación?* Ágil y rápido.\n\n" +
                        "¿Agendamos una auditoría gratuita?\n" +
                        "1️⃣ Sí, agendar\n" +
                        "2️⃣ Volver";
                    nextStep = STEPS.STEP_FAQ;
                } else if (isOption4) {
                    reply = "¡Genial! Vamos a conectarte con un asesor 🙌\n\n¿Cuál es tu nombre?";
                    nextStep = STEPS.STEP_LEAD_NOMBRE;
                } else {
                    reply = `No entendí tu respuesta 🤔\n\n${MENU_PRINCIPAL}`;
                    nextStep = STEPS.STEP_1;
                }
                break;

            case STEPS.STEP_SERVICIOS:
            case STEPS.STEP_SECTORES:
            case STEPS.STEP_FAQ:
                if (isOption1) {
                    reply = "¡Genial! Vamos a conectarte con un asesor 🙌\n\n¿Cuál es tu nombre?";
                    nextStep = STEPS.STEP_LEAD_NOMBRE;
                } else if (isOption2) {
                    reply = MENU_PRINCIPAL;
                    nextStep = STEPS.STEP_1;
                } else {
                    if (currentStep === STEPS.STEP_SERVICIOS)
                        reply = "No entendí tu respuesta 🤔\n\n¿Agendamos una auditoría gratuita?\n1️⃣ Sí, agendar\n2️⃣ Volver";
                    else if (currentStep === STEPS.STEP_SECTORES)
                        reply = "No entendí tu respuesta 🤔\n\n¿Hablamos sobre tu negocio?\n1️⃣ Sí, hablar con asesor\n2️⃣ Volver";
                    else if (currentStep === STEPS.STEP_FAQ)
                        reply = "No entendí tu respuesta 🤔\n\n¿Agendamos una auditoría gratuita?\n1️⃣ Sí, agendar\n2️⃣ Volver";
                    nextStep = currentStep;
                }
                break;

            case STEPS.STEP_LEAD_NOMBRE:
                if (!message_text) {
                    reply = "¿Cuál es tu nombre?";
                    nextStep = STEPS.STEP_LEAD_NOMBRE;
                } else if (message_text.length > 50) {
                    reply = "Por favor ingresa solo tu nombre (máximo 50 caracteres) 😊";
                    nextStep = STEPS.STEP_LEAD_NOMBRE;
                } else if (message_text.split(' ').length > 5) {
                    reply = "Eso parece demasiado largo para un nombre 😅 ¿Cuál es tu nombre?";
                    nextStep = STEPS.STEP_LEAD_NOMBRE;
                } else {
                    lead.nombre = message_text;
                    reply = `Gracias, ${lead.nombre}! 😊\n¿Cuál es tu correo electrónico?`;
                    nextStep = STEPS.STEP_LEAD_CORREO;
                }
                break;

            case STEPS.STEP_LEAD_CORREO:
                if (isValidEmail(message_text)) {
                    lead.email = message_text;
                    reply = "Casi listo! ¿Cuál es el principal desafío operativo de tu negocio?\n(Ej: control de caja, ventas, etc.)";
                    nextStep = STEPS.STEP_LEAD_DESAFIO;
                } else {
                    reply = "Por favor ingresa un correo electrónico válido (ej: tucorreo@gmail.com)";
                    nextStep = STEPS.STEP_LEAD_CORREO;
                }
                break;

            case STEPS.STEP_LEAD_DESAFIO:
                if (!message_text) {
                    reply = "¿Cuál es el principal desafío operativo de tu negocio?";
                    nextStep = STEPS.STEP_LEAD_DESAFIO;
                } else if (message_text.length > 300) {
                    reply = "Por favor resume tu desafío en menos palabras 😊 (máximo 300 caracteres)";
                    nextStep = STEPS.STEP_LEAD_DESAFIO;
                } else {
                    lead.desafio = message_text;
                    lead.phone = phone;
                    reply =
                        `✅ *Perfecto ${lead.nombre}!*\n\n` +
                        `Hemos recibido tu info:\n` +
                        `📧 ${lead.email}\n` +
                        `💼 Desafío: ${lead.desafio}\n\n` +
                        `⏳ Estamos buscando el espacio más cercano en nuestra agenda...\n` +
                        `En unos segundos recibirás la confirmación automática de tu auditoría gratuita. 🚀`;
                    responseLead = { ...lead };

                    console.log(JSON.stringify({ type: 'lead_captured', phone, lead }));

                    await sendLeadWebhook(phone, lead);

                    await stateService.setCooldown(phone);
                    await stateService.clearUserState(phone);
                    nextStep = null;
                }
                break;

            default:
                reply = MENU_PRINCIPAL;
                nextStep = STEPS.STEP_1;
                break;
        }

        if (nextStep) {
            await stateService.saveUserState(phone, { step: nextStep, lead });
        }

        const responsePayload = { reply };
        if (responseLead) responsePayload.lead = responseLead;
        return res.json(responsePayload);

    } catch (err) {
        console.error(JSON.stringify({ type: 'unhandled_error', error: err.message, stack: err.stack }));
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}

module.exports = {
    handleChat
};
