const stateService = require('../services/stateService');

const TZ = 'America/Santo_Domingo';

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const MENU_PRINCIPAL = {
    text: "👋 Hola! Soy el asistente de *Synset Solutions*.\nOptimizamos tu negocio con tecnología 🚀\n\n¿Qué deseas hacer?",
    buttons: [
        { id: "1", text: "🛠️ Servicios" },
        { id: "2", text: "🏢 Sectores" },
        { id: "3", text: "❓ FAQ" },
        { id: "4", text: "👤 Hablar con asesor" }
    ]
};
const MENU_TEXT_FALLBACK = 
    "👋 Hola! Soy el asistente de *Synset Solutions*.\nOptimizamos tu negocio con tecnología 🚀\n\n" +
    "1️⃣ Servicios\n2️⃣ Sectores\n3️⃣ Preguntas frecuentes\n4️⃣ Hablar con un asesor";

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
    const text = "📅 *Elige el horario que mejor te convenga:*";
    const buttons = slots.map((slot, i) => ({
        id: (i + 1).toString(),
        text: formatSlot(slot)
    }));
    return { text, buttons };
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
    // Interceptor global para convertir botones a texto (Bypass restricción de Meta en NOWEB)
    const originalJson = res.json.bind(res);
    res.json = (data) => {
        if (data && data.buttons && data.buttons.length > 0) {
            const numMap = { "1": "1️⃣", "2": "2️⃣", "3": "3️⃣", "4": "4️⃣", "5": "5️⃣", "6": "6️⃣" };
            const blist = data.buttons.map(b => `${numMap[b.id] || (b.id + '.')} ${b.text}`).join('\n');
            data.reply = `${data.reply}\n\n*(Responde con el número de la opción)*\n${blist}`;
            delete data.buttons; // Eliminar la key hace que n8n vaya por la rama 'False' de 'Tiene botones?'
        }
        return originalJson(data);
    };

    try {
        const { phone, message, fromMe, messageId } = req.body;

        if (fromMe === true) return res.json({ reply: null });
        if (await stateService.isDuplicate(messageId)) return res.json({ reply: null });
        if (!phone) return res.status(400).json({ error: 'phone is required' });

        // Grupos: solo responder si el bot fue mencionado
        const isGroup = phone.endsWith('@g.us');
        if (isGroup) {
            if (req.body.isGroupMention) {
                return res.json({
                    reply: "🤖 Hola! Soy el asistente de *Synset Solutions*. Solo puedo atender conversaciones privadas.\nEscríbeme directo para ayudarte. 😊"
                });
            }
            return res.json({ reply: null });
        }
        if (await stateService.isInHumanMode(phone)) return res.json({ reply: null });

        const message_text = (message || '').trim();
        if (!message_text) return res.json({ reply: null });

        // ── Cooldown: usuario ya agendado ─────────────────────────────────────
        if (await stateService.isInCooldown(phone)) {
            const currentState = await stateService.getUserState(phone);
            const currentStep = currentState.step;
            const input = message_text.toLowerCase();

            // Submenús propios del usuario agendado
            if (currentStep === stateService.STEPS.STEP_SCHEDULED_MENU) {
                return handleScheduledMenu(phone, input, currentState, res);
            }
            if (currentStep === stateService.STEPS.STEP_REAGENDAR) {
                return handleReagendar(phone, input, currentState, res);
            }
            if (currentStep === stateService.STEPS.STEP_CONFIRM_UPDATE) {
                return handleConfirmUpdate(phone, input, currentState, res);
            }

            // STEP_0 o sin estado → saludo personalizado
            if (!currentStep || currentStep === stateService.STEPS.STEP_0) {
                const savedLead = await stateService.getLeadData(phone);
                const nombre = savedLead?.nombre || 'amigo/a';
                await stateService.saveUserState(phone, { step: stateService.STEPS.STEP_SCHEDULED_MENU, lead: {} });
                const greeting = savedLead && savedLead.nombre 
                    ? `¡Hola ${savedLead.nombre}! 👋 Veo que tienes una gestión pendiente con nosotros.\n\n¿Qué deseas hacer?\n1️⃣ Ver menú principal\n2️⃣ Reagendar cita\n3️⃣ Actualizar datos / Nuevo reto\n4️⃣ Hablar con un asesor`
                    : `¡Hola! 👋 Veo que tienes una gestión pendiente con nosotros.\n\n¿Qué deseas hacer?\n1️⃣ Ver menú principal\n2️⃣ Reagendar cita\n3️⃣ Actualizar datos / Nuevo reto\n4️⃣ Hablar con un asesor`;
                
                return res.json({ reply: greeting });
            }

            // Cualquier otro step (STEP_1, STEP_SERVICIOS, etc.): dejar navegar normalmente
            // el bloque principal del switch lo maneja — no bloqueamos la navegación
        }
        // ─────────────────────────────────────────────────────────────────────

        const currentState = await stateService.getUserState(phone);
        let currentStep = currentState.step;
        let lead = currentState.lead || {};
        let reply = '';
        let buttons = [];
        let responseLead = null;
        let nextStep = currentStep;

        const input = message_text.toLowerCase();

        const isOption1 = input === '1' || input === '1.' || input === 'uno';
        const isOption2 = input === '2' || input === '2.' || input === 'dos';
        const isOption3 = input === '3' || input === '3.' || input === 'tres';
        const isOption4 = input === '4' || input === '4.' || input === 'cuatro';

        const STEPS = stateService.STEPS;

        switch (currentStep) {
            case STEPS.STEP_0: {
                const savedLead = await stateService.getLeadData(phone);
                if (savedLead && savedLead.nombre) {
                    reply = `¡Hola de nuevo, ${savedLead.nombre}! 👋 ¿Qué deseas hacer hoy?`;
                    buttons = [
                        { id: "1", text: "🚀 Menú Principal" },
                        { id: "4", text: "👤 Hablar con asesor" },
                        { id: "3", text: "📝 Actualizar Datos" }
                    ];
                    nextStep = STEPS.STEP_RESUME_LEAD;
                } else {
                    reply = MENU_PRINCIPAL.text;
                    buttons = MENU_PRINCIPAL.buttons;
                    nextStep = STEPS.STEP_1;
                }
                break;
            }
            
            case STEPS.STEP_RESUME_LEAD:
                if (isOption1) {
                    reply = MENU_PRINCIPAL.text;
                    buttons = MENU_PRINCIPAL.buttons;
                    nextStep = STEPS.STEP_1;
                } else if (isOption3) {
                    reply = "¡Genial! Vamos a actualizar tus datos 🙌\n\n¿Cuál es tu nombre?";
                    nextStep = STEPS.STEP_LEAD_NOMBRE;
                } else if (isOption4) {
                    // Si ya tenemos datos, ir directo al asesor
                    await stateService.setHumanMode(phone);
                    await stateService.clearUserState(phone);
                    reply = `Perfecto ${lead.nombre || ''}. Te conecto con un asesor ahora mismo. 🚀`;
                    nextStep = null;
                } else {
                    reply = "Elige una opción válida:";
                    buttons = [
                        { id: "1", text: "🚀 Menú Principal" },
                        { id: "4", text: "👤 Hablar con asesor" },
                        { id: "3", text: "📝 Actualizar Datos" }
                    ];
                }
                break;

            case STEPS.STEP_1:
                if (isOption1) {
                    reply = "🛠️ *Nuestros Servicios*\n\n✅ Control operativo\n⚡ Automatización\n📊 Tableros de KPIs\n🤖 Chatbots 24/7";
                    buttons = [
                        { id: "1", text: "📅 Agendar Auditoría" },
                        { id: "2", text: "🔙 Volver" }
                    ];
                    nextStep = STEPS.STEP_SERVICIOS;
                } else if (isOption2) {
                    reply = "🏪 *Sectores que atendemos*\n\n🛒 Retail y minimarkets\n🏢 Empresas de servicios";
                    buttons = [
                        { id: "1", text: "👤 Hablar con asesor" },
                        { id: "2", text: "🔙 Volver" }
                    ];
                    nextStep = STEPS.STEP_SECTORES;
                } else if (isOption3) {
                    reply = "❓ *Preguntas Frecuentes*\n\n*¿Empresas pequeñas?* Sí.\n*¿Software?* Te asesoramos.\n*¿Soporte?* Directo.\n*¿Tiempo?* Ágil.";
                    buttons = [
                        { id: "1", text: "📅 Agendar Auditoría" },
                        { id: "2", text: "🔙 Volver" }
                    ];
                    nextStep = STEPS.STEP_FAQ;
                } else if (isOption4) {
                    const savedLead = await stateService.getLeadData(phone);
                    if (savedLead && savedLead.nombre) {
                        await stateService.setHumanMode(phone);
                        await stateService.clearUserState(phone);
                        reply = `¡Excelente ${savedLead.nombre}! Te paso con un asesor en este momento. 🚀`;
                        nextStep = null;
                    } else {
                        reply = "¡Genial! Vamos a conectarte con un asesor 🙌\n\n¿Cuál es tu nombre?";
                        nextStep = STEPS.STEP_LEAD_NOMBRE;
                    }
                } else {
                    reply = `No entendí tu respuesta 🤔\n\n${MENU_PRINCIPAL.text}`;
                    buttons = MENU_PRINCIPAL.buttons;
                    nextStep = STEPS.STEP_1;
                }
                break;

            case STEPS.STEP_SERVICIOS:
            case STEPS.STEP_SECTORES:
            case STEPS.STEP_FAQ:
                if (isOption1) {
                    const savedLead = await stateService.getLeadData(phone);
                    if (savedLead && savedLead.nombre) {
                        await stateService.setHumanMode(phone);
                        await stateService.clearUserState(phone);
                        reply = `¡Perfecto ${savedLead.nombre}! Un asesor tomará tu caso ahora. 🚀`;
                        nextStep = null;
                    } else {
                        reply = "¡Genial! Vamos a conectarte con un asesor 🙌\n\n¿Cuál es tu nombre?";
                        nextStep = STEPS.STEP_LEAD_NOMBRE;
                    }
                } else if (isOption2) {
                    reply = MENU_PRINCIPAL.text;
                    buttons = MENU_PRINCIPAL.buttons;
                    nextStep = STEPS.STEP_1;
                } else {
                    reply = "Por favor elige una opción válida:";
                    buttons = [
                        { id: "1", text: "✅ Sí, contactar" },
                        { id: "2", text: "🔙 Volver" }
                    ];
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
                    reply = `Gracias, ${lead.nombre}! 😊\n¿Cuál es tu correo electrónico? 📧\n\n*(Escribe *Volver* si quieres corregir tu nombre)*`;
                    nextStep = STEPS.STEP_LEAD_CORREO;
                }
                break;

            case STEPS.STEP_LEAD_CORREO:
                if (message_text.toLowerCase() === 'volver') {
                    reply = "¿Cuál es tu nombre? 👤";
                    nextStep = STEPS.STEP_LEAD_NOMBRE;
                    break;
                }

                if (isValidEmail(message_text)) {
                    lead.email = message_text;
                    reply = "¡Casi listo! ¿En qué área específica necesitas más ayuda? 🚀";
                    buttons = [
                        { id: "1", text: "💰 Ventas/Inventario" },
                        { id: "2", text: "⚡ Automatización" },
                        { id: "3", text: "📊 KPIs/Tableros" },
                        { id: "4", text: "🤖 Chatbots" },
                        { id: "5", text: "❓ Otro" }
                    ];
                    nextStep = STEPS.STEP_LEAD_DESAFIO;
                } else {
                    reply = "Por favor ingresa un correo electrónico válido (ej: tucorreo@gmail.com)";
                    nextStep = STEPS.STEP_LEAD_CORREO;
                }
                break;

            case STEPS.STEP_LEAD_DESAFIO: {
                if (message_text.toLowerCase() === 'volver') {
                    reply = "¿Cuál es tu correo electrónico? 📧\n\n*(Escribe *Volver* si quieres corregir tu nombre)*";
                    nextStep = STEPS.STEP_LEAD_CORREO;
                    break;
                }

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
                    reply = "Por favor selecciona una opción válida:";
                    buttons = [
                        { id: "1", text: "💰 Ventas/Inventario" },
                        { id: "2", text: "⚡ Automatización" },
                        { id: "3", text: "📊 KPIs/Tableros" },
                        { id: "4", text: "🤖 Chatbots" },
                        { id: "5", text: "❓ Otro" }
                    ];
                    nextStep = STEPS.STEP_LEAD_DESAFIO;
                    break;
                }

                lead.phone = phone;

                if (isOp5) {
                    // Caso manual: NO agendar, NO llamar webhook de n8n
                    // El asesor contactará manualmente
                    reply =
                        `✅ *Gracias ${lead.nombre}!* Hemos recibido tu información.\n\n` +
                        `Como tu caso es particular, un asesor revisará tu solicitud y se pondrá en contacto contigo por este medio.\n\n` +
                        `⏳ Te contactaremos pronto. 🙌`;

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
                        ? lead._slots.map(iso => new Date(iso))
                        : [];
                    const slotResp = buildSlotMessage(slots);
                    reply = "Por favor elige una opción válida:\n" + slotResp.text;
                    buttons = slotResp.buttons;
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
                reply = MENU_PRINCIPAL.text;
                buttons = MENU_PRINCIPAL.buttons;
                nextStep = STEPS.STEP_1;
                break;
        }

        if (nextStep) {
            await stateService.saveUserState(phone, { step: nextStep, lead });
        }

        const responsePayload = { reply };
        if (buttons && buttons.length > 0) responsePayload.buttons = buttons;
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
    const isOption4 = input === '4' || input === '4.' || input === 'cuatro';

    if (isOption1) {
        // Mostrar menú principal
        await stateService.saveUserState(phone, { step: stateService.STEPS.STEP_1, lead: {} });
        return res.json({ 
            reply: "Entendido. Para cancelar tu cita escríbenos aquí mismo o selecciona una opción del menú.\n\n" + MENU_PRINCIPAL.text,
            buttons: MENU_PRINCIPAL.buttons
        });
    }

    if (isOption2) {
        // Iniciar reagendamiento
        const slots = generateSlots(3);
        const lead = currentState.lead || {};
        lead._slots = slots.map(formatSlotISO);
        await stateService.saveUserState(phone, { step: stateService.STEPS.STEP_REAGENDAR, lead });

        const slotResp = buildSlotMessage(slots);
        return res.json({
            reply: "📅 *Reagendar mi cita*\n\nEstos son los próximos horarios disponibles:",
            buttons: slotResp.buttons
        });
    }

    if (isOption3) {
        // ¿Actualizar nombre/correo?
        await stateService.saveUserState(phone, { step: stateService.STEPS.STEP_CONFIRM_UPDATE, lead: currentState.lead || {} });
        return res.json({
            reply: "¿Deseas actualizar tu nombre y correo electrónico? 👤",
            buttons: [
                { id: "1", text: "✅ Sí, actualizar" },
                { id: "2", text: "❌ No, solo el reto" }
            ]
        });
    }

    if (isOption4) {
        // Pausar bot y esperar por humano
        await stateService.setHumanMode(phone);
        await stateService.clearUserState(phone);
        return res.json({
            reply: "Entendido. He pasado tu consulta a un asesor para que te atienda personalmente. Puedes escribir tus dudas o cambios aquí mismo. 🚀"
        });
    }

    // Opción no reconocida
    return res.json({
        reply: "No entendí tu respuesta 🤔. Por favor elige una opción del menú:",
        buttons: [
            { id: "1", text: "🚀 Menú Principal" },
            { id: "2", text: "📅 Reagendar cita" },
            { id: "3", text: "📝 Actualizar datos" },
            { id: "4", text: "👤 Hablar con asesor" }
        ]
    });
}

async function handleConfirmUpdate(phone, input, currentState, res) {
    const isOption1 = input === '1' || input === '1.' || input === 'uno' || input === 'si' || input === 'sí';
    const isOption2 = input === '2' || input === '2.' || input === 'dos' || input === 'no';

    if (isOption1) {
        // Reiniciar flujo de lead desde el nombre
        await stateService.saveUserState(phone, { step: stateService.STEPS.STEP_LEAD_NOMBRE, lead: {} });
        return res.json({ reply: "¡Genial! Vamos a actualizar tus datos 🙌\n\n¿Cuál es tu nombre?" });
    }

    if (isOption2) {
        // Ir directo al desafío (reto)
        await stateService.saveUserState(phone, { step: stateService.STEPS.STEP_LEAD_DESAFIO, lead: currentState.lead || {} });
        return res.json({
            reply: "Entendido, mantenemos los datos actuales. ✅\n\n¿En qué área específica necesitas más ayuda hoy? 🚀",
            buttons: [
                { id: "1", text: "💰 Ventas/Inventario" },
                { id: "2", text: "⚡ Automatización" },
                { id: "3", text: "📊 KPIs/Tableros" },
                { id: "4", text: "🤖 Chatbots" },
                { id: "5", text: "❓ Otro" }
            ]
        });
    }

    return res.json({
        reply: "Por favor selecciona una opción válida:",
        buttons: [
            { id: "1", text: "✅ Sí, actualizar" },
            { id: "2", text: "❌ No, solo el reto" }
        ]
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
        const slotResp = buildSlotMessage(lead._slots ? lead._slots.map(iso => new Date(iso)) : []);
        return res.json({
            reply: "Por favor selecciona una opción válida:",
            buttons: slotResp.buttons
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
