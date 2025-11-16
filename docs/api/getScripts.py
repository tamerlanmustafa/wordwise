import os
from pathlib import Path
import requests
from dotenv import load_dotenv

# load repo root .env (docs/api -> docs -> repo root)
ROOT = Path(__file__).resolve().parents[3]
load_dotenv(ROOT / ".env")

USER_ID = os.getenv("USER_ID")
TOKEN = os.getenv("TOKEN")
SCRIPTS_URL = os.getenv("SCRIPTS_URL")

if not (USER_ID and TOKEN and SCRIPTS_URL):
    raise SystemExit("Missing USER_ID, TOKEN or SCRIPTS_URL in .env")

def fetch_scripts(params: dict = None):
    # adjust names ('user_id','token') to match the external API spec if needed
    params = params or {"user_id": USER_ID, "token": TOKEN}
    r = requests.get(SCRIPTS_URL, params=params, timeout=15)
    r.raise_for_status()
    return r

if __name__ == "__main__":
    resp = fetch_scripts()
    print("status:", resp.status_code)
    # try json, otherwise print text
    try:
        print(resp.json())
    except Exception:
        print(resp.text)