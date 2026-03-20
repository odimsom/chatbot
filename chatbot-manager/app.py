import os
import redis
import json
import requests
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from functools import wraps
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "synset-manager-secret-12345")

# Config
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
CHATBOT_API_URL = os.getenv("CHATBOT_API_URL", "https://chatbot.synsetsolutions.com")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")
N8N_MANAGER_WEBHOOK = os.getenv("N8N_MANAGER_WEBHOOK", "")
MANAGER_USER = os.getenv("MANAGER_USER", "admin")
MANAGER_PASSWORD = os.getenv("MANAGER_PASSWORD", "synset2026")

r = redis.from_url(REDIS_URL, decode_responses=True)

# Auth Decorator
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "logged_in" not in session:
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated_function

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        user = request.form.get("username")
        password = request.form.get("password")
        if user == MANAGER_USER and password == MANAGER_PASSWORD:
            session["logged_in"] = True
            return redirect(url_for("index"))
        return render_template("login.html", error="Credenciales incorrectas")
    return render_template("login.html")

@app.route("/logout")
def logout():
    session.pop("logged_in", None)
    return redirect(url_for("login"))

@app.route("/favicon.ico")
def favicon():
    return redirect("https://img.icons8.com/plasticine/100/bot.png")

@app.route("/")
@login_required
def index():
    # Scan for leads to get numbers
    keys = r.keys("lead:*")
    leads = []
    for k in keys:
        phone = k.split(":")[1]
        data = r.get(k)
        lead_info = json.loads(data) if data else {}
        
        # Check human mode
        is_human = r.exists(f"human:{phone}")
        
        leads.append({
            "phone": phone,
            "name": lead_info.get("nombre", "Usuario"),
            "email": lead_info.get("email", "-"),
            "status": "HUMANO" if is_human else "BOT",
            "is_human": bool(is_human)
        })
    
    return render_template("index.html", leads=leads)

@app.route("/toggle", methods=["POST"])
@login_required
def toggle():
    data = request.json
    phone = data.get("phone")
    current_status = data.get("current_status") # "BOT" or "HUMANO"
    
    command = "!humano" if current_status == "BOT" else "!bot"
    
    try:
        # Notify n8n if configured
        if N8N_MANAGER_WEBHOOK:
            try:
                requests.post(N8N_MANAGER_WEBHOOK, json={
                    "phone": phone,
                    "command": command,
                    "mode": "human" if command == "!humano" else "bot",
                    "source": "manager"
                }, timeout=2)
            except: pass

        resp = requests.post(
            f"{CHATBOT_API_URL}/command",
            headers={"Content-Type": "application/json", "Authorization": ADMIN_TOKEN},
            json={"command": command, "phone": phone},
            timeout=5
        )
        return jsonify({"success": resp.status_code == 200, "new_status": "HUMANO" if command == "!humano" else "BOT"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == "__main__":
    port = int(os.getenv("FLASK_PORT", 8089))
    app.run(host="0.0.0.0", port=port)
