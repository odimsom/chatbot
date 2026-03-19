const stateService = require('../services/stateService');

async function handleCommand(req, res) {
    const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
    if (ADMIN_TOKEN && req.headers.authorization !== ADMIN_TOKEN) {
        console.warn(JSON.stringify({ type: 'auth_failed', endpoint: '/command', ip: req.ip }));
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { command, phone } = req.body;
    if (!command || !phone) {
        return res.status(400).json({ error: 'command and phone are required' });
    }
    const cmd = command.trim().toLowerCase();
    
    if (cmd === '!humano') {
        await stateService.setHumanMode(phone);
        await stateService.clearUserState(phone);
        console.log(JSON.stringify({ type: 'human_mode_enabled', phone }));
        return res.json({ ok: true, mode: 'human', phone });
    }
    
    if (cmd === '!bot') {
        await stateService.clearHumanMode(phone);
        await stateService.clearCooldown(phone);
        await stateService.clearUserState(phone);
        console.log(JSON.stringify({ type: 'human_mode_disabled', phone }));
        return res.json({ ok: true, mode: 'bot', phone });
    }
    
    return res.status(400).json({ error: 'Unknown command' });
}

module.exports = {
    handleCommand
};
