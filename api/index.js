import os
import re
import time
import json
import requests
from datetime import datetime, timedelta
from flask import Flask, request, Response
from bs4 import BeautifulSoup

app = Flask(__name__)

# -------------------------
# Config
# -------------------------
TARGET_BASE = os.getenv("TARGET_BASE", "https://pakistandatabase.com")
TARGET_PATH = os.getenv("TARGET_PATH", "/databases/sim.php")
ALLOW_UPSTREAM = True
MIN_INTERVAL = float(os.getenv("MIN_INTERVAL", "1.0"))
LAST_CALL = {"ts": 0.0}

# External Zephrex API
ZEPHREX_BASE = "https://www.zephrexdigital.site/api"

# External keys with priority (failover ke liye)
EXTERNAL_KEYS = {
    "PHONE": [
        {"key": "ZEPH-7M7CD", "priority": 1},
        {"key": "ZEPH-QW2T3", "priority": 2}
    ],
    "FAMILY": [
        {"key": "ZEPH-CYW71", "priority": 1}
    ],
    "AADHAAR": [
        {"key": "ZEPH-7M7CD", "priority": 1}
    ],
    "UPI": [
        {"key": "ZEPH-71OAV", "priority": 1}
    ],
    "TG_NUM": [
        {"key": "ZEPH-U3UD0", "priority": 1},
        {"key": "ZEPH-Y7ND7", "priority": 2}
    ]
}

# Allowed types
ALLOWED_TYPES = ['PAK', 'PHONE', 'FAMILY', 'AADHAAR', 'UPI', 'TG_NUM']

COPYRIGHT_HANDLE = os.getenv("COPYRIGHT_HANDLE", "@AkashExploits")
COPYRIGHT_NOTICE = "👉🏻 " + COPYRIGHT_HANDLE

# -------------------------
# API Keys Database
# -------------------------
API_KEYS = {
    "AKASH_PARMA": {
        "name": "Premium User",
        "expiry": "2030-03-30",
        "status": "active",
        "daily_limit": 9999999,      # effectively unlimited
        "used_today": 0,
        "total_used": 0
    },
    "AKASH_PAID30DAYS": {
        "name": "Paid User",
        "expiry": "2026-03-20",
        "status": "active",
        "daily_limit": 9999999,
        "used_today": 0,
        "total_used": 0
    },
    "AKASH_FREE": {
        "name": "Free Trial",
        "expiry": "2026-02-20",
        "status": "active",
        "daily_limit": 10,
        "used_today": 0,
        "total_used": 0
    }
}

LAST_RESET_DAY = datetime.now().date()

# -------------------------
# Helper Functions
# -------------------------
def reset_daily_usage_if_needed():
    global LAST_RESET_DAY
    today = datetime.now().date()
    if today > LAST_RESET_DAY:
        for key_data in API_KEYS.values():
            key_data["used_today"] = 0
        LAST_RESET_DAY = today

def validate_api_key(api_key):
    if not api_key:
        return False, {"error": "API Key missing!"}
    reset_daily_usage_if_needed()
    key_data = API_KEYS.get(api_key)
    if not key_data:
        return False, {"error": "Invalid API Key"}
    expiry = datetime.strptime(key_data["expiry"], "%Y-%m-%d")
    if datetime.now() > expiry:
        return False, {"error": f"Key expired on {key_data['expiry']}"}
    if key_data["used_today"] >= key_data["daily_limit"]:
        return False, {"error": "Daily limit exceeded"}
    days = (expiry - datetime.now()).days
    key_info = {
        "key_name": key_data["name"],
        "expiry_date": key_data["expiry"],
        "days_remaining": days,
        "status": "Active",
        "daily_limit": key_data["daily_limit"],
        "used_today": key_data["used_today"],
        "remaining_today": key_data["daily_limit"] - key_data["used_today"]
    }
    return True, key_info

def increment_usage(api_key):
    if api_key in API_KEYS:
        API_KEYS[api_key]["used_today"] += 1
        API_KEYS[api_key]["total_used"] += 1

def get_key_details(api_key):
    k = API_KEYS[api_key]
    expiry = datetime.strptime(k["expiry"], "%Y-%m-%d")
    days = (expiry - datetime.now()).days
    return {
        "key_name": k["name"],
        "expiry_date": k["expiry"],
        "days_remaining": days,
        "status": "Active",
        "daily_limit": k["daily_limit"],
        "used_today": k["used_today"],
        "remaining_today": k["daily_limit"] - k["used_today"]
    }

def respond_json(obj, pretty=False, status=200):
    if pretty:
        text = json.dumps(obj, indent=2, ensure_ascii=False)
        return Response(text, mimetype="application/json; charset=utf-8", status=status)
    return Response(
        json.dumps(obj, ensure_ascii=False),
        mimetype="application/json; charset=utf-8",
        status=status
    )

# -------------------------
# PAK Type Handler
# -------------------------
def handle_pak(term):
    # Validation
    if not re.fullmatch(r"92\d{9,12}|\d{13}", term.strip()):
        return {"error": "Invalid format. Use 92... or 13-digit CNIC"}, None
    is_mobile = term.startswith("92")
    # Rate limit
    now = time.time()
    elapsed = now - LAST_CALL["ts"]
    if elapsed < MIN_INTERVAL:
        time.sleep(MIN_INTERVAL - elapsed)
    LAST_CALL["ts"] = time.time()
    # Fetch
    url = TARGET_BASE.rstrip("/") + TARGET_PATH
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": TARGET_BASE.rstrip("/") + "/",
        "Accept-Language": "en-US,en;q=0.9",
    }
    try:
        resp = requests.post(url, headers=headers, data={"search_query": term}, timeout=20)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        table = soup.find("table")
        if not table:
            return [], {"query_type": "mobile" if is_mobile else "cnic"}
        results = []
        for tr in table.find_all("tr")[1:]:  # skip header
            cols = [td.get_text(strip=True) for td in tr.find_all("td")]
            if len(cols) >= 4:
                results.append({
                    "mobile": cols[0],
                    "name": cols[1],
                    "cnic": cols[2],
                    "address": cols[3]
                })
        return results, {"query_type": "mobile" if is_mobile else "cnic"}
    except Exception as e:
        return {"error": f"PAK fetch failed: {str(e)}"}, None

# -------------------------
# Zephrex Proxy Handler (for other types)
# -------------------------
def fetch_zephrex(api_type, term):
    """Try multiple external keys in priority order"""
    keys = EXTERNAL_KEYS.get(api_type, [])
    if not keys:
        return {"error": f"No external keys configured for {api_type}"}, None
    # Sort by priority
    keys.sort(key=lambda x: x["priority"])
    last_error = None
    for key_info in keys:
        ext_key = key_info["key"]
        url = f"{ZEPHREX_BASE}?key={ext_key}&type={api_type}&term={requests.utils.quote(term)}"
        try:
            resp = requests.get(url, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                # Zephrex returns {"status":true,"data":...} or {"status":true,"data":{}}
                if data.get("status") is True:
                    return data.get("data", {}), None
                else:
                    last_error = "Zephrex returned error"
            else:
                last_error = f"HTTP {resp.status_code}"
        except Exception as e:
            last_error = str(e)
    return {"error": f"All external APIs failed: {last_error}"}, None

# -------------------------
# Unified API Endpoint
# -------------------------
@app.route("/api", methods=["GET"])
def unified_api():
    key = request.args.get("key")
    req_type = request.args.get("type", "").upper()
    term = request.args.get("term")
    pretty = request.args.get("pretty") in ("1", "true", "True")

    # Basic validation
    if not key:
        return respond_json({"success": False, "error": "Missing key"}, pretty, 400)
    if not req_type:
        return respond_json({"success": False, "error": "Missing type"}, pretty, 400)
    if not term:
        return respond_json({"success": False, "error": "Missing term"}, pretty, 400)
    if req_type not in ALLOWED_TYPES:
        return respond_json({
            "success": False,
            "error": f"Invalid type. Supported: {', '.join(ALLOWED_TYPES)}"
        }, pretty, 400)

    # Validate key and limits
    valid, key_info = validate_api_key(key)
    if not valid:
        return respond_json({"success": False, **key_info}, pretty, 401)

    # Increment usage (after validation)
    increment_usage(key)

    # Route to appropriate handler
    if req_type == "PAK":
        result, extra = handle_pak(term)
        if isinstance(result, dict) and "error" in result:
            return respond_json({
                "success": False,
                "error": result["error"],
                "key_details": get_key_details(key)
            }, pretty, 400)
        # result is list of dicts
        return respond_json({
            "success": True,
            "developer": COPYRIGHT_HANDLE,
            "key_details": get_key_details(key),
            "query": term,
            "query_type": extra.get("query_type") if extra else None,
            "results_count": len(result),
            "data": result,
            "copyright": COPYRIGHT_NOTICE
        }, pretty)

    else:
        # For other types, use Zephrex proxy
        data, error = fetch_zephrex(req_type, term)
        if error or isinstance(data, dict) and "error" in data:
            return respond_json({
                "success": False,
                "error": error or data.get("error", "Unknown error"),
                "key_details": get_key_details(key)
            }, pretty, 500 if not error else 400)
        # Successful response
        return respond_json({
            "success": True,
            "developer": COPYRIGHT_HANDLE,
            "key_details": get_key_details(key),
            "type": req_type,
            "query": term,
            "data": data,
            "copyright": COPYRIGHT_NOTICE
        }, pretty)

# -------------------------
# Other Routes (optional)
# -------------------------
@app.route("/", methods=["GET"])
def home():
    return f"""
    <h2>🔐 {COPYRIGHT_HANDLE} - UNIVERSAL API</h2>
    <p>Unified API with Key Auth & Daily Limits</p>
    <p>Use: <code>/api?key=YOUR_KEY&type=TYPE&term=VALUE</code></p>
    <p><b>Supported Types:</b> {', '.join(ALLOWED_TYPES)}</p>
    <p>📞 For API Key: Contact @AkashExploits on Telegram</p>
    """

@app.route("/health", methods=["GET"])
def health():
    return respond_json({
        "status": "operational",
        "developer": COPYRIGHT_HANDLE,
        "keys_active": len([k for k in API_KEYS.values() if k["status"] == "active"]),
        "copyright": COPYRIGHT_NOTICE
    })

# -------------------------
# Vercel Handler
# -------------------------
if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
