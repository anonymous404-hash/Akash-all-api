// api/index.js
// Universal Proxy API with Auto Failover & Your Final Branding

// ==================== Configuration ====================

// Your own API keys (internal)
const YOUR_KEYS = {
  "AKASH_PARMA": {
    name: "Premium Key",
    expiry_date: "2030-03-30",
    status: "Active",
    daily_limit: 999999,         
    used_today: 0,
    total_used: 0
  },
  "AKASH_PAID30DAYS": {
    name: "Paid 30 Days Key",
    expiry_date: "2026-03-20",   
    status: "Active",
    daily_limit: 1000,
    used_today: 0,
    total_used: 0
  },
  "AKASH_FREETRIAL": {
    name: "Free Trial Key",
    expiry_date: "2026-02-20",   
    status: "Active",
    daily_limit: 100,
    used_today: 0,
    total_used: 0
  }
};

// External API keys (for Zephrex)
const EXTERNAL_KEYS = {
  PHONE: [
    { key: "ZEPH-7M7CD", priority: 1 },
    { key: "ZEPH-QW2T3", priority: 2 }
  ],
  FAMILY: [
    { key: "ZEPH-CYW71", priority: 1 }
  ],
  AADHAAR: [
    { key: "ZEPH-7M7CD", priority: 1 }
  ],
  UPI: [
    { key: "ZEPH-71OAV", priority: 1 }
  ],
  TG_NUM: [
    { key: "ZEPH-U3UD0", priority: 1 },
    { key: "ZEPH-Y7ND7", priority: 2 }
  ]
};

const EXTERNAL_BASE_URL = "https://www.zephrexdigital.site/api";
const ALLOWED_TYPES = ['PHONE', 'FAMILY', 'AADHAAR', 'UPI', 'TG_NUM'];

// ==================== Helper Functions ====================

function getExternalKeysForType(type) {
  return EXTERNAL_KEYS[type.toUpperCase()] || [];
}

function validateAadhaar(term) { return /^\d{12}$/.test(term); }
function validatePhone(term) { return /^\d{10}$/.test(term); }
function validateUPI(term) { return /^[a-zA-Z0-9._-]+@[a-zA-Z0-9]+$/.test(term); }
function validateTGNum(term) { return term && term.length > 0; }

function validateTerm(type, term) {
  switch(type.toUpperCase()) {
    case 'AADHAAR': return validateAadhaar(term);
    case 'PHONE': return validatePhone(term);
    case 'UPI': return validateUPI(term);
    case 'TG_NUM': return validateTGNum(term);
    default: return true;
  }
}

function getDaysRemaining(expiryDateStr) {
  const today = new Date();
  const expiry = new Date(expiryDateStr);
  const diffTime = expiry - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays > 0 ? diffDays : 0;
}

// ==================== Main Handler ====================

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Use GET.' });
  }

  const { key, type, term } = req.query;

  if (!key || !type || !term) {
    return res.status(400).json({ success: false, error: 'Missing parameters' });
  }

  if (!ALLOWED_TYPES.includes(type.toUpperCase())) {
    return res.status(400).json({ success: false, error: 'Invalid type' });
  }

  if (!validateTerm(type, term)) {
    return res.status(400).json({ success: false, error: 'Invalid term format' });
  }

  const keyData = YOUR_KEYS[key];
  if (!keyData) return res.status(403).json({ success: false, error: 'Invalid API key' });

  const today = new Date();
  const expiry = new Date(keyData.expiry_date);
  if (today > expiry) {
    return res.status(403).json({ success: false, error: 'API key expired' });
  }

  keyData.used_today++;
  keyData.total_used++;

  const externalKeys = getExternalKeysForType(type).sort((a, b) => a.priority - b.priority);
  
  let lastError = null;
  let responseData = null;

  for (const extKey of externalKeys) {
    const externalUrl = `${EXTERNAL_BASE_URL}?key=${extKey.key}&type=${encodeURIComponent(type)}&term=${encodeURIComponent(term)}`;
    try {
      const response = await fetch(externalUrl);
      if (response.ok) {
        responseData = await response.json();
        break;
      }
    } catch (error) { lastError = error.message; }
  }

  if (!responseData) {
    return res.status(503).json({ success: false, error: 'All external APIs failed' });
  }

  // --- RE-BRANDING LOGIC ---
  // Purane handles ko delete karna
  delete responseData.BUY_API;
  delete responseData.SUPPORT;
  delete responseData.api_developer;
  delete responseData.owner;
  delete responseData.source;

  // Enriched response with YOUR NEW branding
  const enrichedResponse = {
    ...responseData,
    key_details: {
      expiry_date: keyData.expiry_date,
      days_remaining: getDaysRemaining(keyData.expiry_date),
      status: keyData.status,
      used_today: keyData.used_today,
      remaining_today: keyData.daily_limit - keyData.used_today
    },
    api_developer: "@Akash_Exploits_bot",
    BUY_API: "@Akash_Exploits_bot",
    SUPPORT: "@Akash_Exploits_bot",
    owner: "https://t.me/Akash_Exploits_bot \n BUY INSTANT CHEAP PRICE",
    powered_by: "@Akash_Exploits_bot",
    source: "@Akash_Exploits_bot"
  };

  return res.json(enrichedResponse);
};
