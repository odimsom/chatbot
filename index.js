const express = require('express');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3005;

// In-memory state: Map<phone, { step: string, lastActivity: number, timeoutId: NodeJS.Timeout, lead: object }>
const userStates = new Map();
const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

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

function clearUserState(phone) {
    const state = userStates.get(phone);
    if (state && state.timeoutId) {
        clearTimeout(state.timeoutId);
    }
    userStates.delete(phone);
}

function getUserState(phone) {
    if (!userStates.has(phone)) {
        return { step: STEPS.STEP_0, lead: {} };
    }
    return userStates.get(phone);
}

function saveUserState(phone, stateData) {
    const existing = userStates.get(phone);
    if (existing && existing.timeoutId) {
        clearTimeout(existing.timeoutId);
    }
    
    const timeoutId = setTimeout(() => {
        clearUserState(phone);
    }, TIMEOUT_MS);

    userStates.set(phone, {
        ...stateData,
        lastActivity: Date.now(),
        timeoutId
    });
}

function isValidEmail(email) {
    return email.includes('@') && email.includes('.');
}

app.post('/chat', (req, res) => {
    let { phone, message, fromMe } = req.body;
    
    // VALIDACIONES GLOBALES
    if (fromMe === true) {
        return res.json({ reply: null });
    }

    if (!phone) {
        return res.status(400).json({ error: 'phone is required' });
    }
    
    if (phone.endsWith('@g.us')) {
        return res.json({ reply: "Este bot solo funciona en chats privados 😊" });
    }

    message = (message || '').trim();
    
    const currentState = getUserState(phone);
    let currentStep = currentState.step;
    let lead = currentState.lead || {};
    let reply = '';
    let responseLead = null;

    let nextStep = currentStep;

    const menuPrincipal = "👋 Hola! Soy el asistente de *Synset Solutions*.\n" +
                          "Construimos tecnología que organiza y acelera tu negocio 🚀\n\n" +
                          "¿Qué deseas hacer hoy?\n" +
                          "1️⃣ Conocer nuestros servicios\n" +
                          "2️⃣ Ver sectores que atendemos\n" +
                          "3️⃣ Preguntas frecuentes\n" +
                          "4️⃣ Hablar con un asesor";

    // PROCESS STEPS
    switch (currentStep) {
        case STEPS.STEP_0:
            reply = menuPrincipal;
            nextStep = STEPS.STEP_1;
            break;

        case STEPS.STEP_1:
            if (message === '1') {
                reply = "🛠️ *Nuestros Servicios*\n\n" +
                        "✅ *Control operativo* — Inventario y ventas con menos errores\n" +
                        "⚡ *Flujos automatizados* — Tareas repetitivas que se ejecutan solas\n" +
                        "📊 *Tableros de decisión* — Tus KPIs en una sola vista\n" +
                        "🤖 *Asistentes 24/7* — Atención y seguimiento sin pausa\n\n" +
                        "¿Te gustaría agendar una auditoría gratuita?\n" +
                        "1️⃣ Sí, quiero agendar\n" +
                        "2️⃣ Volver al menú";
                nextStep = STEPS.STEP_SERVICIOS;
            } else if (message === '2') {
                reply = "🏪 *Sectores que atendemos*\n\n" +
                        "🛒 *Retail, supermercados y minimarkets*\n" +
                        "Control de inventario, ventas y cuadres diarios.\n\n" +
                        "🏢 *Empresas de servicios y operación multiárea*\n" +
                        "Estandarización de procesos y visibilidad de indicadores.\n\n" +
                        "¿Quieres saber cómo podemos ayudar a tu negocio específico?\n" +
                        "1️⃣ Sí, quiero hablar con un asesor\n" +
                        "2️⃣ Volver al menú";
                nextStep = STEPS.STEP_SECTORES;
            } else if (message === '3') {
                reply = "❓ *Preguntas Frecuentes*\n\n" +
                        "*¿Trabajan con empresas pequeñas?*\n" +
                        "Sí, trabajamos desde negocios locales hasta operaciones nacionales.\n\n" +
                        "*¿No sé qué software necesito?*\n" +
                        "No hay problema, en una sesión remota analizamos tu operación y te damos un plan claro.\n\n" +
                        "*¿Qué pasa si el sistema falla?*\n" +
                        "Priorizamos continuidad operativa. Tienes soporte directo sin intermediarios.\n\n" +
                        "*¿Cuánto tiempo tarda la implementación?*\n" +
                        "Depende del alcance, pero trabajamos con metodología ágil para resultados rápidos.\n\n" +
                        "¿Quieres una auditoría gratuita?\n" +
                        "1️⃣ Sí, agendar ahora\n" +
                        "2️⃣ Volver al menú";
                nextStep = STEPS.STEP_FAQ;
            } else if (message === '4') {
                reply = "¡Genial! Vamos a conectarte con un asesor 🙌\n\n" +
                        "¿Cuál es tu nombre?";
                nextStep = STEPS.STEP_LEAD_NOMBRE;
            } else {
                reply = menuPrincipal;
                nextStep = STEPS.STEP_1;
            }
            break;

        case STEPS.STEP_SERVICIOS:
        case STEPS.STEP_SECTORES:
        case STEPS.STEP_FAQ:
            if (message === '1') {
                reply = "¡Genial! Vamos a conectarte con un asesor 🙌\n\n" +
                        "¿Cuál es tu nombre?";
                nextStep = STEPS.STEP_LEAD_NOMBRE;
            } else if (message === '2') {
                reply = menuPrincipal;
                nextStep = STEPS.STEP_1;
            } else {
                if (currentStep === STEPS.STEP_SERVICIOS) {
                    reply = "¿Te gustaría agendar una auditoría gratuita?\n1️⃣ Sí, quiero agendar\n2️⃣ Volver al menú";
                } else if (currentStep === STEPS.STEP_SECTORES) {
                    reply = "¿Quieres saber cómo podemos ayudar a tu negocio específico?\n1️⃣ Sí, quiero hablar con un asesor\n2️⃣ Volver al menú";
                } else if (currentStep === STEPS.STEP_FAQ) {
                    reply = "¿Quieres una auditoría gratuita?\n1️⃣ Sí, agendar ahora\n2️⃣ Volver al menú";
                }
                nextStep = currentStep;
            }
            break;

        case STEPS.STEP_LEAD_NOMBRE:
            if (!message) {
                reply = "¿Cuál es tu nombre?";
                nextStep = STEPS.STEP_LEAD_NOMBRE;
            } else {
                lead.nombre = message;
                reply = `Gracias, ${lead.nombre}! 😊\n¿Cuál es tu correo electrónico?`;
                nextStep = STEPS.STEP_LEAD_CORREO;
            }
            break;

        case STEPS.STEP_LEAD_CORREO:
            if (isValidEmail(message)) {
                lead.email = message;
                reply = "Casi listo! ¿Cuál es el principal desafío operativo de tu negocio?\n(Ej: control de inventario, cuadres de caja, atención al cliente, etc.)";
                nextStep = STEPS.STEP_LEAD_DESAFIO;
            } else {
                reply = "Por favor ingresa un correo válido (ejemplo: tucorreo@gmail.com)";
                nextStep = STEPS.STEP_LEAD_CORREO;
            }
            break;

        case STEPS.STEP_LEAD_DESAFIO:
            if (!message) {
                reply = "¿Cuál es el principal desafío operativo de tu negocio?\n(Ej: control de inventario, cuadres de caja, atención al cliente, etc.)";
                nextStep = STEPS.STEP_LEAD_DESAFIO;
            } else {
                lead.desafio = message;
                reply = `✅ *Perfecto ${lead.nombre}!*\n\n` +
                        `Hemos recibido tu información:\n` +
                        `📧 ${lead.email}\n` +
                        `💼 Desafío: ${lead.desafio}\n\n` +
                        `Un asesor de Synset Solutions te contactará pronto.\n\n` +
                        `También puedes agendar directamente aquí:\n` +
                        `📅 https://calendly.com/synsetsolutions\n\n` +
                        `¡Gracias por contactarnos! 🚀`;
                
                lead.phone = phone; 
                responseLead = { ...lead }; 
                clearUserState(phone);
                nextStep = null; 
            }
            break;

        default:
            reply = menuPrincipal;
            nextStep = STEPS.STEP_1;
            break;
    }

    if (nextStep) {
        saveUserState(phone, { step: nextStep, lead });
    }

    const responsePayload = { reply };
    if (responseLead) {
        responsePayload.lead = responseLead;
    }

    return res.json(responsePayload);
});

app.listen(PORT, () => {
    console.log(`Synset Solutions Chatbot Service is running on port ${PORT}`);
});
