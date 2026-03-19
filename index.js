const express = require('express');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3005;
const TIMEOUT_MS = 30 * 60 * 1000; // 30 min inactividad
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h post-lead

// Estados de conversación
const userStates = new Map();

// Modo humano: Map<phone, timestamp> — mientras exista, bot callado
const humanMode = new Map();

// Cooldown post-lead: Map<phone, timestamp>
const leadCooldown = new Map();

// Deduplicación de mensajes
const processedMessages = new Map();
const DEDUP_TTL = 60 * 1000;

const STEPS = {
    STEP_0: 'STEP_0',
    STEP_1: 'STEP_1',
    STEP_SERVICIOS: 'STEP_SERVICIOS',
    STEP_SECTORES: 'STEP_SECTORES',
    STEP_FAQ: 'STEP_FAQ',
    STEP_LEAD_NOMBRE: 'STEP_LEAD_NOMBRE',
    STEP_LEAD_CORREO: 'STEP_LEAD_CORREO',
    STEP_LEAD_DESAFIO: 'STEP_LEAD_DESAFIO'
};

function isDuplicate(messageId) {
    if (!messageId) return false;
    if (processedMessages.has(messageId)) return true;
    processedMessages.set(messageId, Date.now());
    for (const [id, ts] of processedMessages.entries()) {
        if (Date.now() - ts > DEDUP_TTL) processedMessages.delete(id);
    }
    return false;
}

function clearUserState(phone) {
    const state = userStates.get(phone);
    if (state?.timeoutId) clearTimeout(state.timeoutId);
    userStates.delete(phone);
}

function getUserState(phone) {
    return userStates.get(phone) || { step: STEPS.STEP_0, lead: {} };
}

function saveUserState(phone, stateData) {
    const existing = userStates.get(phone);
    if (existing?.timeoutId) clearTimeout(existing.timeoutId);
    const timeoutId = setTimeout(() => clearUserState(phone), TIMEOUT_MS);
    userStates.set(phone, { ...stateData, lastActivity: Date.now(), timeoutId });
}

function isValidEmail(email) {
    return email.includes('@') && email.includes('.');
}

function isInCooldown(phone) {
    const ts = leadCooldown.get(phone);
    if (!ts) return false;
    if (Date.now() - ts > COOLDOWN_MS) {
        leadCooldown.delete(phone);
        return false;
    }
    return true;
}

function isInHumanMode(phone) {
    return humanMode.has(phone);
}

// ── Comandos del asesor ──────────────────────────────────────────
// POST /command  { command: '!humano' | '!bot', phone: 'número@c.us' }
app.post('/command', (req, res) => {
    const { command, phone } = req.body;
    if (!command || !phone) {
        return res.status(400).json({ error: 'command and phone are required' });
    }
    const cmd = command.trim().toLowerCase();
    if (cmd === '!humano') {
        humanMode.set(phone, Date.now());
        clearUserState(phone);
        return res.json({ ok: true, mode: 'human', phone });
    }
    if (cmd === '!bot') {
        humanMode.delete(phone);
        leadCooldown.delete(phone);
        clearUserState(phone);
        return res.json({ ok: true, mode: 'bot', phone });
    }
    return res.status(400).json({ error: 'Unknown command' });
});

// ── Chat principal ───────────────────────────────────────────────
app.post('/chat', (req, res) => {
    const { phone, message, fromMe, messageId } = req.body;

    // 1. Ignorar mensajes propios
    if (fromMe === true) return res.json({ reply: null });

    // 2. Deduplicación
    if (isDuplicate(messageId)) return res.json({ reply: null });

    // 3. Phone requerido
    if (!phone) return res.status(400).json({ error: 'phone is required' });

    // 4. Ignorar grupos (@g.us)
    if (phone.endsWith('@g.us')) return res.json({ reply: null });

    // 5. Modo humano activo — bot callado
    if (isInHumanMode(phone)) return res.json({ reply: null });

    // 6. Cooldown 24h post-lead
    if (isInCooldown(phone)) return res.json({ reply: null });

    // 7. Ignorar mensajes sin texto (stickers, imágenes, etc.)
    const message_text = (message || '').trim();
    if (!message_text) return res.json({ reply: null });

    const currentState = getUserState(phone);
    let currentStep = currentState.step;
    let lead = currentState.lead || {};
    let reply = '';
    let responseLead = null;
    let nextStep = currentStep;

    const menuPrincipal =
        "👋 Hola! Soy el asistente de *Synset Solutions*.\n" +
        "Optimizamos tu negocio con tecnología 🚀\n\n" +
        "¿Qué deseas hacer?\n" +
        "1️⃣ Servicios\n" +
        "2️⃣ Sectores\n" +
        "3️⃣ Preguntas frecuentes\n" +
        "4️⃣ Hablar con un asesor";

    switch (currentStep) {
        case STEPS.STEP_0:
            reply = menuPrincipal;
            nextStep = STEPS.STEP_1;
            break;

        case STEPS.STEP_1:
            if (message_text === '1') {
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
            } else if (message_text === '2') {
                reply =
                    "🏪 *Sectores que atendemos*\n\n" +
                    "🛒 *Retail y minimarkets*\n" +
                    "🏢 *Empresas de servicios*\n\n" +
                    "¿Hablamos sobre tu negocio?\n" +
                    "1️⃣ Sí, hablar con asesor\n" +
                    "2️⃣ Volver";
                nextStep = STEPS.STEP_SECTORES;
            } else if (message_text === '3') {
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
            } else if (message_text === '4') {
                reply = "¡Genial! Vamos a conectarte con un asesor 🙌\n\n¿Cuál es tu nombre?";
                nextStep = STEPS.STEP_LEAD_NOMBRE;
            } else {
                reply = menuPrincipal;
                nextStep = STEPS.STEP_1;
            }
            break;

        case STEPS.STEP_SERVICIOS:
        case STEPS.STEP_SECTORES:
        case STEPS.STEP_FAQ:
            if (message_text === '1') {
                reply = "¡Genial! Vamos a conectarte con un asesor 🙌\n\n¿Cuál es tu nombre?";
                nextStep = STEPS.STEP_LEAD_NOMBRE;
            } else if (message_text === '2') {
                reply = menuPrincipal;
                nextStep = STEPS.STEP_1;
            } else {
                if (currentStep === STEPS.STEP_SERVICIOS)
                    reply = "¿Agendamos una auditoría gratuita?\n1️⃣ Sí, agendar\n2️⃣ Volver";
                else if (currentStep === STEPS.STEP_SECTORES)
                    reply = "¿Hablamos sobre tu negocio?\n1️⃣ Sí, hablar con asesor\n2️⃣ Volver";
                else if (currentStep === STEPS.STEP_FAQ)
                    reply = "¿Agendamos una auditoría gratuita?\n1️⃣ Sí, agendar\n2️⃣ Volver";
                nextStep = currentStep;
            }
            break;

        case STEPS.STEP_LEAD_NOMBRE:
            if (!message_text) {
                reply = "¿Cuál es tu nombre?";
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
                reply = "Por favor ingresa un correo válido (ej: tucorreo@gmail.com)";
                nextStep = STEPS.STEP_LEAD_CORREO;
            }
            break;

        case STEPS.STEP_LEAD_DESAFIO:
            if (!message_text) {
                reply = "¿Cuál es el principal desafío operativo de tu negocio?";
                nextStep = STEPS.STEP_LEAD_DESAFIO;
            } else {
                lead.desafio = message_text;
                lead.phone = phone;
                reply =
                    `✅ *Perfecto ${lead.nombre}!*\n\n` +
                    `Hemos recibido tu info:\n` +
                    `📧 ${lead.email}\n` +
                    `💼 Desafío: ${lead.desafio}\n\n` +
                    `Un asesor te contactará pronto.\n\n` +
                    `Puedes agendar aquí:\n` +
                    `📅 https://calendly.com/synsetsolutions\n\n` +
                    `¡Gracias! 🚀`;
                responseLead = { ...lead };

                // Silenciar bot 24h para este número
                leadCooldown.set(phone, Date.now());
                clearUserState(phone);
                nextStep = null;
            }
            break;

        default:
            reply = menuPrincipal;
            nextStep = STEPS.STEP_1;
            break;
    }

    if (nextStep) saveUserState(phone, { step: nextStep, lead });

    const responsePayload = { reply };
    if (responseLead) responsePayload.lead = responseLead;
    return res.json(responsePayload);
});

app.listen(PORT, () => {
    console.log(`Synset Solutions Chatbot Service running on port ${PORT}`);
});
