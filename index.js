const express = require("express");
const rateLimit = require("express-rate-limit");
const chatController = require("./src/controllers/chatController");
const commandController = require("./src/controllers/commandController");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3005;

// Rate Limiting general
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 60, // Limite de 60 peticiones por minuto por IP
  message: { error: "Too many requests" },
});

app.use("/chat", limiter);

// Endpoints
app.post("/command", commandController.handleCommand);
app.post("/chat", chatController.handleChat);

app.listen(PORT, () => {
  console.log(
    JSON.stringify({ type: "server_start", port: PORT, status: "running" }),
  );
  console.log(process.env.ADMIN_TOKEN);
});
