"""StudyFlow AI - Flask backend.

GET  /          serves the chat interface
POST /api/chat  {"message": "question"}  ->  {"answer": "AI response"}

The Groq API key and model are read from the .env file, never from the frontend.
"""
import os

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b").strip()
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

MAX_MESSAGE_CHARS = 8000
REQUEST_TIMEOUT = 90  # seconds

SYSTEM_PROMPT = (
    "You are StudyFlow AI, an academic learning assistant for students. "
    "Help them understand concepts, learn programming, prepare for exams and work through problems. "
    "Explain clearly and accurately, starting with a short direct answer and then adding detail. "
    "Format every reply in Markdown so it reads like well-designed study material: use short headings "
    "for sections, bold for key terms, ordered or unordered lists for steps and points, tables for "
    "comparisons, and fenced code blocks with a language tag for code. "
    "Use simple examples, and say so honestly when you are unsure."
)

app = Flask(__name__)


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/api/chat")
def chat():
    data = request.get_json(silent=True) or {}
    message = data.get("message")

    if not isinstance(message, str) or not message.strip():
        return jsonify({"error": "Please enter a question."}), 400
    if len(message) > MAX_MESSAGE_CHARS:
        return jsonify({"error": f"Your message is too long (limit {MAX_MESSAGE_CHARS} characters)."}), 400
    if not GROQ_API_KEY:
        app.logger.error("GROQ_API_KEY is not set. Add it to the .env file.")
        return jsonify({"error": "The server is not configured with an API key yet."}), 500

    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": message.strip()},
        ],
        "temperature": 0.6,
        "max_tokens": 4096,
    }

    try:
        resp = requests.post(
            GROQ_URL,
            headers={"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
            json=payload,
            timeout=REQUEST_TIMEOUT,
        )
    except requests.Timeout:
        return jsonify({"error": "The AI service took too long to respond. Please try again."}), 504
    except requests.RequestException:
        app.logger.exception("Could not reach Groq")
        return jsonify({"error": "Could not reach the AI service. Please try again."}), 502

    if resp.status_code != 200:
        app.logger.error("Groq returned %s: %s", resp.status_code, resp.text[:500])
        if resp.status_code in (401, 403):
            msg = "The AI service rejected the API key. Check GROQ_API_KEY in the .env file."
        elif resp.status_code == 429:
            msg = "The AI service is busy or the rate limit was reached. Please try again shortly."
        else:
            msg = "The AI service returned an error. Please try again."
        return jsonify({"error": msg}), 502

    try:
        answer = (resp.json()["choices"][0]["message"].get("content") or "").strip()
    except (ValueError, KeyError, IndexError, TypeError):
        app.logger.error("Unexpected Groq response: %s", resp.text[:500])
        answer = ""

    if not answer:
        return jsonify({"error": "The AI service returned an empty answer. Please try again."}), 502

    return jsonify({"answer": answer})


if __name__ == "__main__":
    # Local development only. In production the app is started by gunicorn (see Procfile).
    app.run(debug=os.getenv("FLASK_DEBUG") == "1", port=int(os.getenv("PORT", "5000")))
