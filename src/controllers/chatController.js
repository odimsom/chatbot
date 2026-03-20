const stateService = require('../services/stateService');

const TZ = 'America/Santo_Domingo';

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

const DIAS = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

/**
 * Convierte una fecha UTC a fecha local en la zona horaria configurada.
 */
function toLocalDate(date) {
    return new Date(date.toLocaleString('en-US', { timeZone: TZ }));
}

/**
 * Avanza un slot hasta el próximo horario hábil (Lun-Vie, 9am-5pm).
 */
function nextBusinessHour(date) {
    const slot = new Date(date);
    slot.setMinutes(0, 0, 0);

    for (let i = 0; i < 300; i++) {
        const local = toLocalDate(slot);
        const day = local.getDay();   // 0=Dom, 6=Sab
        const hour = local.getHours();

        if (day >= 1 && day <= 5 && hour >= 9 && hour < 17) {
            return slot;
        }

        // Avanzar una hora
        slot.setTime(slot.getTime() + 60 * 60 * 1000);

        // Si ya pasó las 5pm, saltar al día siguiente 9am
        const localAfter = toLocalDate(slot);
        if (localAfter.getHours() >= 17 || localAfter.getHours() < 9) {
            slot.setTime(slot.getTime()); // mantener como base
            // Buscar siguiente día hábil a las 9am
            const base = new Date(slot);
            base.setHours(base.getHours() + 1); // seguir buscando en loop
            slot.setTime(base.getTime());
        }
    }
    return slot;
}

/**
 * Genera N slots hábiles próximos a partir de ahora.
 */
function generateSlots(count = 3) {
    const slots = [];
    let cursor = new Date();
    cursor.setMinutes(0, 0, 0);
    cursor.setTime(cursor.getTime() + 60 * 60 * 1000); // empezar en siguiente hora

    for (let i = 0; i < count; i++) {
        cursor = nextBusinessHour(cursor);
        slots.push(new Date(cursor));
        cursor.setTime(cursor.getTime() + 60 * 60 * 1000); // siguiente slot
    }
    return slots;
}

/**
 * Formatea un slot como texto amigable.
 */
function formatSlot(date) {
    const local = toLocalDate(date);
    return `${DIAS[local.getDay()]} ${local.getDate()} de ${MESES[local.getMonth()]} a las ${local.getHours()}:00`;
}

/**
 * Formatea un slot como ISO string para n8n.
 */
function formatSlotISO(date) {
    return date.toISOString();
}

/**
 * Construye el mensaje de selección de slots.
 */
function buildSlotMessage(slots) {
    let msg = "📅 *Elige el horario que mejor te convenga:*\n\n";
    slots.forEach((slot, i) => {
        msg += `${i + 1}️⃣ ${formatSlot(slot)}\n`;
    });
    msg += "\nResponde con el número de tu preferencia.";
    return msg;
}

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

        const message_text = (message || '').trim();
        if (!message_text) return res.json({ reply: null });

        // ── Cooldown: usuario ya agendado ─────────────────────────────────────
        if (await stateService.isInCooldown(phone)) {
            const currentState = await stateService.getUserState(phone);
            const currentStep = currentState.step;
            const input = message_text.toLowerCase();

            // Si ya está en el submenú de agendado, seguir manejando esas opciones
            if (currentStep === stateService.STEPS.STEP_SCHEDULED_MENU) {
                return handleScheduledMenu(phone, input, currentState, res);
            }
            if (currentStep === stateService.STEPS.STEP_REAGENDAR) {
                return handleReagendar(phone, input, currentState, res);
            }

            // Primera vez que escribe estando en cooldown → saludo personalizado
            const savedLead = await stateService.getLeadData(phone);
            const nombre = savedLead?.nombre || 'amigo/a';

            await stateService.saveUserState(phone, { step: stateService.STEPS.STEP_SCHEDULED_MENU, lead: currentState.lead || {} });

            return res.json({
                reply:
                    `Hola ${nombre}! 😊 ¿En qué puedo ayudarte hoy?\n\n` +
                    `1️⃣ Ver menú principal\n` +
                    `2️⃣ Reagendar mi cita\n` +
                    `3️⃣ Actualizar datos de mi cita`
            });
        }
        // ─────────────────────────────────────────────────────────────────────

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
                    reply = "Casi listo! ¿En qué área específica necesitas más ayuda?\n\n" +
                            "1️⃣ Control de ventas e inventario\n" +
                            "2️⃣ Automatizar flujos de trabajo\n" +
                            "3️⃣ Creación de Tableros (KPIs)\n" +
                            "4️⃣ Chatbots y Asistentes\n" +
                            "5️⃣ Otro distinto";
                    nextStep = STEPS.STEP_LEAD_DESAFIO;
                } else {
                    reply = "Por favor ingresa un correo electrónico válido (ej: tucorreo@gmail.com)";
                    nextStep = STEPS.STEP_LEAD_CORREO;
                }
                break;

            case STEPS.STEP_LEAD_DESAFIO: {
                const isOp1 = input === '1' || input === '1.' || input === 'uno';
                const isOp2 = input === '2' || input === '2.' || input === 'dos';
                const isOp3 = input === '3' || input === '3.' || input === 'tres';
                const isOp4 = input === '4' || input === '4.' || input === 'cuatro';
                const isOp5 = input === '5' || input === '5.' || input === 'cinco';

                if (isOp1) lead.desafio = "Control de ventas e inventario";
                else if (isOp2) lead.desafio = "Automatizar flujos de trabajo";
                else if (isOp3) lead.desafio = "Creación de Tableros (KPIs)";
                else if (isOp4) lead.desafio = "Chatbots y Asistentes";
                else if (isOp5) lead.desafio = "Otro distinto";
                else {
                    reply = "Por favor selecciona una opción válida (1 al 5) 👇\n\n" +
                            "1️⃣ Control de ventas e inventario\n" +
                            "2️⃣ Automatizar flujos de trabajo\n" +
                            "3️⃣ Creación de Tableros (KPIs)\n" +
                            "4️⃣ Chatbots y Asistentes\n" +
                            "5️⃣ Otro distinto";
                    nextStep = STEPS.STEP_LEAD_DESAFIO;
                    break;
                }

                lead.phone = phone;

                if (isOp5) {
                    // Caso manual: no agendar, solo registrar
                    lead.requiresManualReview = true;
                    lead.source = 'whatsapp';
                    responseLead = { ...lead };

                    reply =
                        `✅ *Gracias ${lead.nombre}!* Hemos recibido tu información.\n\n` +
                        `Como tu caso es particular, un asesor revisará tu solicitud y se pondrá en contacto contigo. 🚀`;

                    await sendLeadWebhook(phone, lead);
                    await stateService.saveLeadData(phone, lead);
                    await stateService.setCooldown(phone);
                    await stateService.clearUserState(phone);
                    nextStep = null;
                } else {
                    // Generar slots disponibles y preguntar
                    const slots = generateSlots(3);
                    lead._slots = slots.map(formatSlotISO); // guardar en estado para usarlos después

                    reply = buildSlotMessage(slots);
                    nextStep = STEPS.STEP_LEAD_SLOT;
                }
                break;
            }

            case STEPS.STEP_LEAD_SLOT: {
                const slotIndex = isOption1 ? 0 : isOption2 ? 1 : isOption3 ? 2 : -1;

                if (slotIndex === -1 || !lead._slots || !lead._slots[slotIndex]) {
                    const slots = lead._slots
                        ? lead._slots.map(iso => formatSlot(new Date(iso)))
                        : [];
                    reply = "Por favor selecciona una opción válida:\n" +
                        (slots.length > 0
                            ? slots.map((s, i) => `${i+1}️⃣ ${s}`).join('\n')
                            : "1️⃣, 2️⃣ o 3️⃣");
                    nextStep = STEPS.STEP_LEAD_SLOT;
                    break;
                }

                const chosenISO = lead._slots[slotIndex];
                const chosenText = formatSlot(new Date(chosenISO));

                // Limpiar slots del lead antes de enviarlo
                const { _slots, ...cleanLead } = lead;
                cleanLead.slotChosen = chosenISO;
                cleanLead.source = 'whatsapp';

                reply =
                    `✅ *¡Perfecto ${cleanLead.nombre}!*\n\n` +
                    `Recibimos tu solicitud para el:\n📅 ${chosenText}\n\n` +
                    `Un asesor confirmará tu cita y recibirás los detalles en unos momentos. 🚀`;

                responseLead = { ...cleanLead };
                console.log(JSON.stringify({ type: 'lead_captured', phone, lead: cleanLead }));

                await sendLeadWebhook(phone, cleanLead);
                await stateService.saveLeadData(phone, cleanLead);
                await stateService.setCooldown(phone);
                await stateService.clearUserState(phone);
                nextStep = null;
                break;
            }

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

// ── Submenú: usuario ya agendado ─────────────────────────────────────────────

async function handleScheduledMenu(phone, input, currentState, res) {
    const isOption1 = input === '1' || input === '1.' || input === 'uno';
    const isOption2 = input === '2' || input === '2.' || input === 'dos';
    const isOption3 = input === '3' || input === '3.' || input === 'tres';

    if (isOption1) {
        // Mostrar menú principal (pero dentro de cooldown, solo menú info)
        await stateService.clearUserState(phone);
        return res.json({ reply: MENU_PRINCIPAL });
    }

    if (isOption2) {
        // Iniciar reagendamiento
        const slots = generateSlots(3);
        const lead = currentState.lead || {};
        lead._slots = slots.map(formatSlotISO);
        await stateService.saveUserState(phone, { step: stateService.STEPS.STEP_REAGENDAR, lead });

        return res.json({
            reply:
                "📅 *Reagendar mi cita*\n\n" +
                "Estos son los próximos horarios disponibles:\n\n" +
                buildSlotMessage(slots)
        });
    }

    if (isOption3) {
        // Solicitar actualización de datos (manual)
        await stateService.saveUserState(phone, { step: stateService.STEPS.STEP_SCHEDULED_MENU, lead: currentState.lead });
        return res.json({
            reply:
                "✏️ Para actualizar los datos de tu cita escríbenos directamente aquí " +
                "o llámanos al *+1 (829) 693-2458* y con gusto te ayudamos. 🙌"
        });
    }

    // Opción no reconocida
    const savedLead = await stateService.getLeadData(phone);
    const nombre = savedLead?.nombre || 'amigo/a';
    return res.json({
        reply:
            `Hola ${nombre}! 😊 ¿En qué puedo ayudarte hoy?\n\n` +
            `1️⃣ Ver menú principal\n` +
            `2️⃣ Reagendar mi cita\n` +
            `3️⃣ Actualizar datos de mi cita`
    });
}

async function handleReagendar(phone, input, currentState, res) {
    const isOption1 = input === '1' || input === '1.' || input === 'uno';
    const isOption2 = input === '2' || input === '2.' || input === 'dos';
    const isOption3 = input === '3' || input === '3.' || input === 'tres';

    const lead = currentState.lead || {};
    const slotIndex = isOption1 ? 0 : isOption2 ? 1 : isOption3 ? 2 : -1;

    if (slotIndex === -1 || !lead._slots || !lead._slots[slotIndex]) {
        const slots = lead._slots
            ? lead._slots.map(iso => formatSlot(new Date(iso)))
            : [];
        return res.json({
            reply: "Por favor selecciona una opción válida:\n" +
                (slots.length > 0 ? slots.map((s, i) => `${i+1}️⃣ ${s}`).join('\n') : "1️⃣, 2️⃣ o 3️⃣")
        });
    }

    const chosenISO = lead._slots[slotIndex];
    const chosenText = formatSlot(new Date(chosenISO));
    const savedLead = await stateService.getLeadData(phone);
    const nombre = savedLead?.nombre || lead.nombre || 'amigo/a';

    const { _slots, ...cleanLead } = lead;
    cleanLead.slotChosen = chosenISO;
    cleanLead.source = 'whatsapp';
    cleanLead.isReschedule = true;

    // Enviar webhook de reagendamiento
    await sendLeadWebhook(phone, cleanLead);

    // Actualizar lead guardado con nuevo slot
    if (savedLead) {
        savedLead.slotChosen = chosenISO;
        await stateService.saveLeadData(phone, savedLead);
    }

    await stateService.saveUserState(phone, { step: stateService.STEPS.STEP_SCHEDULED_MENU, lead: {} });

    return res.json({
        reply:
            `✅ *¡Reagendado, ${nombre}!*\n\n` +
            `Tu nueva cita queda confirmada para:\n📅 ${chosenText}\n\n` +
            `Recibirás la confirmación en breve. 🚀`
    });
}

module.exports = {
    handleChat
};
