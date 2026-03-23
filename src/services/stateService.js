const redisClient = require("../config/redis");

const TIMEOUT_SEC = 30 * 60; // 30 min inactividad
const COOLDOWN_SEC = 24 * 60 * 60; // 24h post-lead
const DEDUP_SEC = 5 * 60; // 5 minutos deduplicación

const PREFIXES = {
  STATE: "state:",
  HUMAN: "human:",
  COOLDOWN: "cooldown:",
  MSG: "msg:",
  LEAD: "lead:",
};

const STEPS = {
  STEP_0: "STEP_0",
  STEP_1: "STEP_1",
  STEP_SERVICIOS: "STEP_SERVICIOS",
  STEP_SECTORES: "STEP_SECTORES",
  STEP_FAQ: "STEP_FAQ",
  STEP_LEAD_NOMBRE: "STEP_LEAD_NOMBRE",
  STEP_LEAD_CORREO: "STEP_LEAD_CORREO",
  STEP_LEAD_DESAFIO: "STEP_LEAD_DESAFIO",
  STEP_LEAD_SLOT: "STEP_LEAD_SLOT",
  STEP_SCHEDULED_MENU: "STEP_SCHEDULED_MENU",
  STEP_REAGENDAR: "STEP_REAGENDAR",
  STEP_CONFIRM_UPDATE: "STEP_CONFIRM_UPDATE",
  STEP_RESUME_LEAD: "STEP_RESUME_LEAD",
  STEP_RESUME_ADVISOR: "STEP_RESUME_ADVISOR",
};

async function isDuplicate(messageId) {
  if (!messageId) return false;
  const key = PREFIXES.MSG + messageId;
  const exists = await redisClient.get(key);
  if (exists) return true;
  await redisClient.set(key, "1", { EX: DEDUP_SEC });
  return false;
}

async function clearUserState(phone) {
  await redisClient.del(PREFIXES.STATE + phone);
}

async function getUserState(phone) {
  const data = await redisClient.get(PREFIXES.STATE + phone);
  if (!data) return { step: STEPS.STEP_0, lead: {} };
  try {
    return JSON.parse(data);
  } catch {
    return { step: STEPS.STEP_0, lead: {} };
  }
}

async function saveUserState(phone, stateData) {
  const payload = { ...stateData, lastActivity: Date.now() };
  await redisClient.set(PREFIXES.STATE + phone, JSON.stringify(payload), {
    EX: TIMEOUT_SEC,
  });
}

async function isInCooldown(phone) {
  const exists = await redisClient.exists(PREFIXES.COOLDOWN + phone);
  return exists === 1;
}

async function setCooldown(phone) {
  await redisClient.set(PREFIXES.COOLDOWN + phone, "1", { EX: COOLDOWN_SEC });
}

async function isInHumanMode(phone) {
  const exists = await redisClient.exists(PREFIXES.HUMAN + phone);
  return exists === 1;
}

async function setHumanMode(phone) {
  await redisClient.set(PREFIXES.HUMAN + phone, "1");
}

async function clearHumanMode(phone) {
  await redisClient.del(PREFIXES.HUMAN + phone);
}

async function clearCooldown(phone) {
  await redisClient.del(PREFIXES.COOLDOWN + phone);
}

// Guardar lead persistente (sobrevive cooldown para saludos personalizados)
async function saveLeadData(phone, lead) {
  await redisClient.set(PREFIXES.LEAD + phone, JSON.stringify(lead), {
    EX: 7 * 24 * 60 * 60,
  }); // 7 días
}

// Recuperar lead para saludos personalizados durante cooldown
async function getLeadData(phone) {
  const data = await redisClient.get(PREFIXES.LEAD + phone);
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

module.exports = {
  STEPS,
  isDuplicate,
  clearUserState,
  getUserState,
  saveUserState,
  isInCooldown,
  setCooldown,
  isInHumanMode,
  setHumanMode,
  clearHumanMode,
  clearCooldown,
  saveLeadData,
  getLeadData,
};
