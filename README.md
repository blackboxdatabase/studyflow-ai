# StudyFlow AI

An AI-powered study assistant for understanding concepts, learning programming, preparing for exams and asking questions by voice. Answers are formatted as readable study material, with headings, lists, tables and code blocks, not raw Markdown.

**Live demo:** https://studyflow-ai-t6eq.onrender.com
The demo runs on a free plan, so the first load after a quiet period can take up to a minute.

## Features

- **Chat workspace** with a collapsible sidebar, suggested prompts and a composer that grows for long questions (Enter to send, Shift+Enter for a new line).
- **Formatted answers**: headings, bold text, ordered and unordered lists, tables that scroll sideways on small screens, syntax-highlighted code with a copy button, blockquotes, formulas, links and dividers.
- **Voice input**: speak your question and it appears as text. Chrome, Edge and Safari transcribe live as you talk. Other browsers record and transcribe on the server.
- **Listen to responses** read aloud with the browser's speech synthesis.
- **Conversation history** saved in the browser, with rename, delete, search (Ctrl/Cmd+K) and export to Markdown.
- **Saved responses** you can bookmark and revisit.
- **Light and dark themes** that follow your system setting and remember your choice.
- **Responsive and accessible**: works on desktop, tablet and mobile, with keyboard navigation and visible focus states.

## Tech stack

- Frontend: HTML, CSS and vanilla JavaScript (no framework, no build step)
- Backend: Python and Flask
- AI: [Groq](https://groq.com) API for chat answers and speech-to-text
- Hosting: any Python host. A `render.yaml` for [Render](https://render.com) is included.

## Project structure

```
.
├── app.py              Flask server and Groq integration
├── templates/
│   └── index.html      Main page
├── static/
│   ├── style.css       Styles and design system
│   └── script.js       Chat logic, Markdown rendering, voice input
├── requirements.txt    Python dependencies
├── Procfile            Production start command
├── render.yaml         Render deployment blueprint
├── .env                Your secrets (not committed)
└── .gitignore
```

## Run locally

You need Python 3.10 or newer and a free [Groq API key](https://console.groq.com/keys).

1. Create a `.env` file in the project root:

   ```
   GROQ_API_KEY=your_key_here
   GROQ_MODEL=openai/gpt-oss-20b
   ```

2. Create and activate a virtual environment, then install the dependencies.

   Windows (PowerShell):
   ```powershell
   python -m venv venv
   .\venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   ```

   macOS and Linux:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

3. Start the app:

   ```
   python app.py
   ```

4. Open http://127.0.0.1:5000.

## Configuration

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `GROQ_API_KEY` | Yes | none | Your Groq API key |
| `GROQ_MODEL` | No | `openai/gpt-oss-20b` | Model used for answers |
| `GROQ_STT_MODEL` | No | `whisper-large-v3-turbo` | Model used for the voice fallback |
| `PORT` | No | `5000` | Port for local runs |
| `FLASK_DEBUG` | No | off | Set to `1` for debug mode on your own machine |

Keep `.env` private. It is listed in `.gitignore` and must never be committed. On a host such as Render, set these values in the service's environment settings instead of uploading the file.

## API

| Method | Route | Description |
|---|---|---|
| `GET` | `/` | Serves the chat interface |
| `POST` | `/api/chat` | Body `{"message": "question"}`, returns `{"answer": "AI response"}` |
| `POST` | `/api/transcribe` | Multipart form with an `audio` file, returns `{"text": "..."}` |

Errors are returned as `{"error": "message"}` with a suitable status code, and the interface shows them in the chat.

## Deploy for free on Render

1. Push this project to a GitHub repository. Do not include `.env`.
2. On [render.com](https://render.com), choose **New → Blueprint** and select the repository.
3. Paste your `GROQ_API_KEY` when asked, then apply.
4. After this, every push to `main` redeploys automatically.

Free instances sleep after about 15 minutes without traffic, and the next visit wakes them.

## Browser support

- **Chat and formatting:** all current browsers.
- **Voice input:** needs a microphone and a secure (`https`) page, or `localhost`. Live transcription works in Chrome, Edge and Safari. Other browsers use the recording fallback.
- **Listening to responses:** depends on the speech voices your browser provides.

## Limitations

- Each question is sent to the model on its own, so follow-up questions do not include earlier messages. Adding conversation history to `/api/chat` would fix this.
- Conversation history and saved responses live in your browser's local storage. They are not shared between devices and are lost if you clear site data.
- Formulas are shown as readable text-based maths, not fully typeset.
- AI answers can be wrong. Check important facts against your course material.

## Security notes

- The API key stays on the server and is never sent to the browser.
- Responses are rendered through a Markdown renderer with an allow-list sanitiser. Raw HTML in an answer is displayed as text, and only `http`, `https` and `mailto` links are active.
