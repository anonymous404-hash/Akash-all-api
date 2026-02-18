import os
import re
import time
import json
import requests
from datetime import datetime, timedelta
from flask import Flask, request, Response, url_for
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

COPYRIGHT_HANDLE = os.getenv("COPYRIGHT_HANDLE", "@AkashExploits")
COPYRIGHT_NOTICE = "👉🏻 " + COPYRIGHT_HANDLE

# -------------------------
# API KEYS DATABASE
# -------------------------
API_KEYS = {
    "AKASH_PARMA": {
        "name": "Premium User",
        "expiry": "2030-03-30",
        "status": "active",
        "daily_limit": 1000000,      # लगभग असीमित
        "used_today": 0,
        "total_used": 0
    },
    "AKASH_PAID30DAYS": {
        "name": "Paid User",
        "expiry": "2026-03-20",
        "status": "active",
        "daily_limit": 1000000,
        "used_today": 0,
        "total_used": 0
    },
    "AKASH_FREE": {
        "name": "Free Trial",
        "expiry": "2026-02-20",
        "status": "active",
        "daily_limit": 50,
        "used_today": 0,
        "total_used": 0
    }
}

# दैनिक रीसेट के लिए अंतिम दिन ट्रैक करें
LAST_RESET_DAY = datetime.now().date()

# -------------------------
# Type Handlers
# -------------------------
def handle_pak_type(term):
    """Pakistan database handler"""
    def is_mobile(value: str) -> bool:
        return bool(re.fullmatch(r"92\d{9,12}", (value or "").strip()))
    
    def is_cnic(value: str) -> bool:
        return bool(re.fullmatch(r"\d{13}", (value or "").strip()))
    
    def classify_query(value: str):
        v = value.strip()
        if is_mobile(v):
            return "mobile", v
        if is_cnic(v):
            return "cnic", v
        raise ValueError("Invalid query. Use mobile with 92... or CNIC (13 digits)")
    
    def fetch_upstream(query_value: str):
        if not ALLOW_UPSTREAM:
            raise PermissionError("Upstream fetching disabled.")
        
        # Rate limiting
        now = time.time()
        elapsed = now - LAST_CALL["ts"]
        if elapsed < MIN_INTERVAL:
            time.sleep(MIN_INTERVAL - elapsed)
        LAST_CALL["ts"] = time.time()
        
        session = requests.Session()
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": TARGET_BASE.rstrip("/") + "/",
            "Accept-Language": "en-US,en;q=0.9",
        }
        url = TARGET_BASE.rstrip("/") + TARGET_PATH
        data = {"search_query": query_value}
        resp = session.post(url, headers=headers, data=data, timeout=20)
        resp.raise_for_status()
        return resp.text
    
    def parse_table(html: str):
        soup = BeautifulSoup(html, "html.parser")
        table = soup.find("table", {"class": "api-response"}) or soup.find("table")
        if not table:
            return []
        tbody = table.find("tbody")
        if not tbody:
            return []
        results = []
        for tr in tbody.find_all("tr"):
            cols = [td.get_text(strip=True) for td in tr.find_all("td")]
            if len(cols) >= 4:
                results.append({
                    "mobile": cols[0],
                    "name": cols[1],
                    "cnic": cols[2],
                    "address": cols[3]
                })
        return results
    
    # Validate term format
    try:
        qtype, normalized = classify_query(term)
    except ValueError as e:
        return {"error": str(e)}, None
    
    # Fetch data
    try:
        html = fetch_upstream(normalized)
        results = parse_table(html)
        return results, {"query_type": qtype, "normalized": normalized}
    except Exception as e:
        return {"error": f"Fetch failed: {str(e)}"}, None

# -------------------------
# Helper Functions
# -------------------------
def reset_daily_usage_if_needed():
    """Reset daily usage counters"""
    global LAST_RESET_DAY
    today = datetime.now().date()
    if today > LAST_RESET_DAY:
        for key_data in API_KEYS.values():
            key_data["used_today"] = 0
        LAST_RESET_DAY = today

def validate_api_key(api_key: str):
    """Validate API key, check expiry and daily limit"""
    if not api_key:
        return False, {"error": "API Key missing! Use ?key=YOUR_KEY"}
    
    reset_daily_usage_if_needed()
    
    key_data = API_KEYS.get(api_key)
    if not key_data:
        return False, {"error": "Invalid API Key! Access Denied."}
    
    # Check expiry
    expiry_date = datetime.strptime(key_data["expiry"], "%Y-%m-%d")
    today = datetime.now()
    
    if today > expiry_date:
        return False, {"error": f"API Key expired on {key_data['expiry']}"}
    
    # Check daily limit
    if key_data["used_today"] >= key_data["daily_limit"]:
        return False, {
            "error": "Daily limit exceeded",
            "limit": key_data["daily_limit"],
            "used_today": key_data["used_today"]
        }
    
    # Calculate days remaining
    days_remaining = (expiry_date - today).days
    
    key_info = {
        "key_name": key_data["name"],
        "expiry_date": key_data["expiry"],
        "days_remaining": days_remaining,
        "status": "Active",
        "daily_limit": key_data["daily_limit"],
        "used_today": key_data["used_today"],
        "remaining_today": key_data["daily_limit"] - key_data["used_today"]
    }
    
    return True, key_info

def increment_usage(api_key: str):
    """Increment usage counter for the key"""
    if api_key in API_KEYS:
        API_KEYS[api_key]["used_today"] += 1
        API_KEYS[api_key]["total_used"] += 1

def get_key_details(api_key: str):
    """Get current key details"""
    key_data = API_KEYS[api_key]
    expiry_date = datetime.strptime(key_data["expiry"], "%Y-%m-%d")
    days_remaining = (expiry_date - datetime.now()).days
    return {
        "key_name": key_data["name"],
        "expiry_date": key_data["expiry"],
        "days_remaining": days_remaining,
        "status": "Active",
        "daily_limit": key_data["daily_limit"],
        "used_today": key_data["used_today"],
        "remaining_today": key_data["daily_limit"] - key_data["used_today"]
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
# Main Unified Endpoint
# -------------------------
@app.route("/api", methods=["GET"])
def unified_api():
    """Unified API endpoint with type parameter"""
    # Get parameters
    api_key = request.args.get("key")
    req_type = request.args.get("type", "").upper()
    term = request.args.get("term")
    pretty = request.args.get("pretty") in ("1", "true", "True")
    
    # Validate required parameters
    if not api_key:
        return respond_json({
            "success": False,
            "error": "Missing API key parameter"
        }, pretty=pretty, status=400)
    
    if not req_type:
        return respond_json({
            "success": False,
            "error": "Missing type parameter"
        }, pretty=pretty, status=400)
    
    if not term:
        return respond_json({
            "success": False,
            "error": "Missing term parameter"
        }, pretty=pretty, status=400)
    
    # Validate API key
    is_valid, key_result = validate_api_key(api_key)
    if not is_valid:
        return respond_json({
            "success": False,
            **key_result
        }, pretty=pretty, status=401)
    
    # Increment usage
    increment_usage(api_key)
    
    # Route based on type
    if req_type == "PAK":
        results, extra = handle_pak_type(term)
        
        if isinstance(results, dict) and "error" in results:
            return respond_json({
                "success": False,
                "error": results["error"],
                "key_details": get_key_details(api_key)
            }, pretty=pretty, status=400)
        
        return respond_json({
            "success": True,
            "type": "PAK",
            "query": term,
            "query_type": extra.get("query_type") if extra else None,
            "normalized": extra.get("normalized") if extra else None,
            "results_count": len(results) if results else 0,
            "data": results if results else [],
            "key_details": get_key_details(api_key),
            "developer": COPYRIGHT_HANDLE,
            "copyright": COPYRIGHT_NOTICE
        }, pretty=pretty)
    
    elif req_type == "PHONE":
        # यहाँ आप Zephrex PHONE API कॉल कर सकते हैं
        return respond_json({
            "success": False,
            "error": "PHONE type not implemented yet",
            "key_details": get_key_details(api_key)
        }, pretty=pretty, status=501)
    
    elif req_type == "FAMILY":
        # Ration card family details
        return respond_json({
            "success": False,
            "error": "FAMILY type not implemented yet",
            "key_details": get_key_details(api_key)
        }, pretty=pretty, status=501)
    
    elif req_type == "AADHAAR":
        # Aadhaar lookup
        return respond_json({
            "success": False,
            "error": "AADHAAR type not implemented yet",
            "key_details": get_key_details(api_key)
        }, pretty=pretty, status=501)
    
    elif req_type == "UPI":
        # UPI lookup
        return respond_json({
            "success": False,
            "error": "UPI type not implemented yet",
            "key_details": get_key_details(api_key)
        }, pretty=pretty, status=501)
    
    elif req_type == "TG_NUM":
        # Telegram number lookup
        return respond_json({
            "success": False,
            "error": "TG_NUM type not implemented yet",
            "key_details": get_key_details(api_key)
        }, pretty=pretty, status=501)
    
    else:
        return respond_json({
            "success": False,
            "error": f"Unsupported type: {req_type}",
            "supported_types": ["PAK", "PHONE", "FAMILY", "AADHAAR", "UPI", "TG_NUM"],
            "key_details": get_key_details(api_key)
        }, pretty=pretty, status=400)

# -------------------------
# Additional Routes
# -------------------------
@app.route("/", methods=["GET"])
def home():
    return f"""
    <h2>🔐 {COPYRIGHT_HANDLE} - UNIVERSAL API</h2>
    <p>Unified API with Key Authentication & Daily Limits</p>
    <p>Use: <code>/api?key=YOUR_KEY&type=TYPE&term=VALUE</code></p>
    <p><b>Supported Types:</b> PAK, PHONE, FAMILY, AADHAAR, UPI, TG_NUM</p>
    <p><b>Example PAK:</b> <code>/api?key=AKASH_PARMA&type=PAK&term=923001234567</code></p>
    <p>📞 For API Key: Contact @AkashExploits on Telegram</p>
    """

@app.route("/api/keys", methods=["GET"])
def list_keys():
    """List all API keys (admin only)"""
    admin_key = request.args.get("admin")
    if admin_key != os.getenv("ADMIN_SECRET", "ADMIN_SECRET_KEY"):
        return respond_json({"error": "Unauthorized"}, status=403)
    
    public_keys = {}
    for k, v in API_KEYS.items():
        public_keys[k] = {
            "name": v["name"],
            "expiry": v["expiry"],
            "status": v["status"],
            "daily_limit": v["daily_limit"]
        }
    
    return respond_json({
        "total_keys": len(API_KEYS),
        "keys": public_keys
    }, pretty=True)

@app.route("/health", methods=["GET"])
def health():
    return respond_json({
        "status": "operational",
        "service": "Universal API",
        "developer": COPYRIGHT_HANDLE,
        "keys_active": len([k for k in API_KEYS.values() if k["status"] == "active"]),
        "copyright": COPYRIGHT_NOTICE
    })

# -------------------------
# Vercel Handler
# -------------------------
if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    print(f"🚀 {COPYRIGHT_HANDLE} Universal API Starting...")
    print(f"📡 Mode: LIVE | Keys: {len(API_KEYS)} | Types: PAK, PHONE, FAMILY, AADHAAR, UPI, TG_NUM")
    app.run(host="0.0.0.0", port=port, debug=False)
