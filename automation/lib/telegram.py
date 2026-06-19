import os

import requests

API_BASE = "https://api.telegram.org"


def send(text):
    """Send a Telegram message. Returns True on success, False otherwise —
    never raises, so a missing/misconfigured bot doesn't fail the workflow.
    """
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        print("[telegram] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — skipping send.")
        print(f"[telegram] would have sent:\n{text}")
        return False

    try:
        res = requests.post(
            f"{API_BASE}/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown", "disable_web_page_preview": True},
            timeout=10,
        )
        if not res.ok:
            print(f"[telegram] send failed: HTTP {res.status_code} {res.text}")
            return False
        return True
    except requests.RequestException as exc:
        print(f"[telegram] send failed: {exc}")
        return False
