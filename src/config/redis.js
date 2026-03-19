const { createClient } = require('redis');

const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://redis:6379'
});

redisClient.on('error', err => console.error(JSON.stringify({ type: 'redis_error', error: err.message })));
redisClient.connect().catch(err => console.error(JSON.stringify({ type: 'redis_connect_error', error: err.message })));

module.exports = redisClient;
