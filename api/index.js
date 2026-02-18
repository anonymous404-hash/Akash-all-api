// api/index.js
// Universal Proxy API with Auto Failover & Your Branding

// ==================== Configuration ====================

// Your own API keys (internal) – अब तीन कुंजियाँ
const YOUR_KEYS = {
  "AKASH_PARMA": {
    name: "Premium Key",
    expiry_date: "2030-03-30",
    status: "Active",
    daily_limit: 999999,         // असीमित (बहुत बड़ी संख्या)
    used_today: 0,
    total_used: 0
  },
  "AKASH_PAID30DAYS": {
    name: "Paid 30 Days Key",
    expiry_date: "2026-03-20",   // 30 दिन (आज 18 Feb से)
    status: "Active",
    daily_limit: 1000,
    used_today: 0,
    total_used: 0
  },
  "AKASH_FREETRIAL": {
    name: "Free Trial Key",
    expiry_date: "2026-02-20",   // 2 दिन
    status: "Active",
    daily_limit: 10,
    used_today: 0,
    total_used: 0
  }
};

// External API keys (for Zephrex) – वही रहेंगे
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

// Allowed types
const ALLOWED_TYPES = ['PHONE', 'FAMILY', 'AADHAAR', 'UPI', 'TG_NUM'];

// ==================== Helper Functions ====================

function getExternalKeysForType(type) {
  return EXTERNAL_KEYS[type.toUpperCase()] || [];
}

function validateAadhaar(term) {
  return /^\d{12}$/.test(term);
}

function validatePhone(term) {
  return /^\d{10}$/.test(term);
}

function validateUPI(term) {
  return /^[a-zA-Z0-9._-]+@[a-zA-Z0-9]+$/.test(term);
}

function validateTGNum(term) {
  return term && term.length > 0;
}

function validateTerm(type, term) {
  switch(type.toUpperCase()) {
    case 'AADHAAR': return validateAadhaar(term);
    case 'PHONE': return validatePhone(term);
    case 'UPI': return validateUPI(term);
    case 'TG_NUM': return validateTGNum(term);
    default: return true;
  }
}

// दिनों की गणना करने का हेल्पर
function getDaysRemaining(expiryDateStr) {
  const today = new Date();
  const expiry = new Date(expiryDateStr);
  const diffTime = expiry - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays > 0 ? diffDays : 0;
}

// ==================== Main Handler ====================

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Use GET.' });
  }

  const { key, type, term } = req.query;

  // Validate required parameters
  if (!key) return res.status(400).json({ success: false, error: 'Missing API key' });
  if (!type) return res.status(400).json({ success: false, error: 'Missing type parameter' });
  if (!term) return res.status(400).json({ success: false, error: 'Missing term parameter' });

  // Validate type
  if (!ALLOWED_TYPES.includes(type.toUpperCase())) {
    return res.status(400).json({ 
      success: false, 
      error: `Invalid type. Allowed: ${ALLOWED_TYPES.join(', ')}` 
    });
  }

  // Validate term format
  if (!validateTerm(type, term)) {
    let errorMsg = 'Invalid term format';
    if (type.toUpperCase() === 'AADHAAR') errorMsg = 'Aadhaar must be 12 digits';
    else if (type.toUpperCase() === 'PHONE') errorMsg = 'Phone number must be 10 digits';
    else if (type.toUpperCase() === 'UPI') errorMsg = 'Invalid UPI ID format';
    return res.status(400).json({ success: false, error: errorMsg });
  }

  // Validate YOUR API key
  const keyData = YOUR_KEYS[key];
  if (!keyData) {
    return res.status(403).json({ success: false, error: 'Invalid API key' });
  }

  // Check expiry
  const today = new Date();
  const expiry = new Date(keyData.expiry_date);
  if (today > expiry) {
    return res.status(403).json({ 
      success: false, 
      error: 'API key expired',
      key_details: { expiry_date: keyData.expiry_date, status: 'Expired' }
    });
  }

  // Daily limit check – अब बहुत बड़ी लिमिट है, लेकिन फिर भी चेक करें
  if (keyData.used_today >= keyData.daily_limit) {
    return res.status(429).json({ 
      success: false, 
      error: 'Daily limit exceeded (unlikely, but if you see this, contact support)' 
    });
  }

  // Increment usage
  keyData.used_today++;
  keyData.total_used++;

  // Get external keys for this type, sorted by priority
  const externalKeys = getExternalKeysForType(type).sort((a, b) => a.priority - b.priority);
  
  if (externalKeys.length === 0) {
    return res.status(500).json({ 
      success: false, 
      error: `No external API configured for type: ${type}` 
    });
  }

  let lastError = null;
  let responseData = null;

  // Try each external key in order until one works
  for (const extKey of externalKeys) {
    const externalUrl = `${EXTERNAL_BASE_URL}?key=${extKey.key}&type=${encodeURIComponent(type)}&term=${encodeURIComponent(term)}`;
    
    try {
      console.log(`[Proxy] Trying ${type} with key ${extKey.key}...`);
      const response = await fetch(externalUrl);
      
      if (response.ok) {
        responseData = await response.json();
        console.log(`[Proxy] Success with key ${extKey.key}`);
        break;
      } else {
        const errorText = await response.text();
        lastError = { status: response.status, body: errorText };
        console.log(`[Proxy] Failed with key ${extKey.key}: ${response.status}`);
      }
    } catch (error) {
      lastError = error.message;
      console.log(`[Proxy] Error with key ${extKey.key}:`, error.message);
    }
  }

  // If no external key worked, return error
  if (!responseData) {
    return res.status(503).json({ 
      success: false, 
      error: 'All external APIs failed',
      details: lastError,
      key_details: {
        expiry_date: keyData.expiry_date,
        days_remaining: getDaysRemaining(keyData.expiry_date),
        status: keyData.status,
        used_today: keyData.used_today,
        remaining_today: keyData.daily_limit - keyData.used_today
      }
    });
  }

  // Enrich response with YOUR branding
  const enrichedResponse = {
    ...responseData,
    key_details: {
      expiry_date: keyData.expiry_date,
      days_remaining: getDaysRemaining(keyData.expiry_date),
      status: keyData.status,
      used_today: keyData.used_today,
      remaining_today: keyData.daily_limit - keyData.used_today
    },
    cached: false,
    proxyUsed: true,
    api_developer: "@AkashExploits",
    BUY_API: "@AkashExploits",
    SUPPORT: "@AkashExploits",
    owner: "https://t.me/AkashExploits \n BUY INSTANT CHEAP PRICE",
    powered_by: "@AkashExploits",
    source: "@AkashExploits"
  };

  return res.json(enrichedResponse);
};
