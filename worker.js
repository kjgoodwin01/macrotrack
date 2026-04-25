/**
 * MacroTrack Worker — Cloudflare Worker
 * Handles: Supabase sync, food search, barcode lookup,
 * AI photo scan, coach chat/report, meal plan generation,
 * push notifications, natural language food entry
 */

const ALLOWED_ORIGINS = [
  "https://macrotrack.live",
  "https://www.macrotrack.live",
  "https://kjgoodwin01.github.io",
  "http://localhost",
  "http://127.0.0.1",
  "capacitor://localhost",
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o));
  return {
    "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonRes(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function sb(env, method, path, body) {
  const prefer = method === "POST"
    ? "resolution=merge-duplicates,return=representation"
    : method === "PATCH"
    ? "return=representation"
    : "return=representation";
  const res = await fetch(env.SUPABASE_URL + "/rest/v1/" + path, {
    method: method,
    headers: {
      "Content-Type": "application/json",
      "apikey": env.SUPABASE_ANON_KEY,
      "Authorization": "Bearer " + env.SUPABASE_ANON_KEY,
      "Prefer": prefer,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch (e) { return { ok: res.ok, status: res.status, data: text }; }
}

// Service-role key variant — bypasses RLS for cross-user lookups
async function sbAdmin(env, method, path, body) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, status: 503, data: "No service role key" };
  const prefer = method === "POST"
    ? "resolution=merge-duplicates,return=representation"
    : "return=representation";
  const res = await fetch(env.SUPABASE_URL + "/rest/v1/" + path, {
    method: method,
    headers: {
      "Content-Type": "application/json",
      "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      "Prefer": prefer,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch (e) { return { ok: res.ok, status: res.status, data: text }; }
}

async function callClaude(apiKey, system, messages, maxTokens, model) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model || "claude-haiku-4-5-20251001",
        max_tokens: maxTokens || 800,
        system: system,
        messages: messages,
      }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error?.message || "Anthropic error" };
    const text = (data.content || []).find(b => b.type === "text")?.text || "";
    return { text };
  } catch (e) {
    return { error: "Failed to reach Anthropic API" };
  }
}

// ── Stripe helpers ────────────────────────────────────────────────────────

const STRIPE_PRO_PRICE_IDS = new Set([
  "price_1TLY3w2ezo0ehDtiQPdplUqg", // Pro Monthly
  "price_1TLY5K2ezo0ehDtiWQ9tTQTL", // Pro Annual
]);
const STRIPE_MAX_PRICE_IDS = new Set([
  "price_1TLY8Y2ezo0ehDtisIIKD8OW", // Max Monthly
  "price_1TLY8r2ezo0ehDtiWPZeKGmw", // Max Annual
]);

async function stripeApi(secretKey, method, path, params) {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method,
    headers: {
      "Authorization": "Basic " + btoa(secretKey + ":"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  const data = await res.json();
  return { ok: res.ok, data };
}

async function verifyStripeSignature(rawBody, sigHeader, secret) {
  const parts = sigHeader.split(",");
  const tPart = parts.find(p => p.startsWith("t="));
  const v1Part = parts.find(p => p.startsWith("v1="));
  if (!tPart || !v1Part) return false;
  const timestamp = tPart.slice(2);
  const sig = v1Part.slice(3);
  const payload = timestamp + "." + rawBody;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const computed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const hex = Array.from(new Uint8Array(computed)).map(b => b.toString(16).padStart(2, "0")).join("");
  return hex === sig;
}

async function getSubscriptionTier(env, deviceId, email) {
  if (!deviceId) return "free";
  const r = await sb(env, "GET", "profiles?device_id=eq." + encodeURIComponent(deviceId) + "&limit=1");
  if (r.data && r.data[0]) return r.data[0].subscription_status || "free";
  // Fallback: look up by email if device_id didn't match any profile
  if (email) {
    const byEmail = await sb(env, "GET", "profiles?email=eq." + encodeURIComponent(email.trim().toLowerCase()) + "&limit=1");
    if (byEmail.data && byEmail.data[0]) return byEmail.data[0].subscription_status || "free";
  }
  return "free";
}

function getMondayISO() {
  const now = new Date();
  const diff = now.getUTCDay() === 0 ? -6 : 1 - now.getUTCDay();
  const mon = new Date(now);
  mon.setUTCDate(mon.getUTCDate() + diff);
  return mon.toISOString().slice(0, 10);
}

async function getDailyUsage(env, deviceId, type) {
  const date = new Date().toISOString().slice(0, 10);
  const val = await env.CODES.get("usage:" + type + ":" + deviceId + ":" + date);
  return val ? parseInt(val) : 0;
}

async function incrementDailyUsage(env, deviceId, type) {
  const date = new Date().toISOString().slice(0, 10);
  const key = "usage:" + type + ":" + deviceId + ":" + date;
  const cur = await env.CODES.get(key);
  await env.CODES.put(key, String((cur ? parseInt(cur) : 0) + 1), { expirationTtl: 90000 });
}

async function getWeeklyUsage(env, deviceId, type) {
  const val = await env.CODES.get("usage:" + type + ":" + deviceId + ":" + getMondayISO());
  return val ? parseInt(val) : 0;
}

async function incrementWeeklyUsage(env, deviceId, type) {
  const key = "usage:" + type + ":" + deviceId + ":" + getMondayISO();
  const cur = await env.CODES.get(key);
  await env.CODES.put(key, String((cur ? parseInt(cur) : 0) + 1), { expirationTtl: 691200 }); // 8 days
}

// ── RevenueCat webhook ────────────────────────────────────────────────────
// Maps RC entitlement IDs → subscription_status tier
const RC_ENTITLEMENT_MAX = "max";
const RC_ENTITLEMENT_PRO = "pro";

async function handleRevenueCatWebhook(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  if (env.RC_WEBHOOK_AUTH && authHeader !== "Bearer " + env.RC_WEBHOOK_AUTH) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  let payload;
  try { payload = await request.json(); }
  catch (e) { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } }); }

  const event = payload.event;
  if (!event) return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });

  const appUserId = event.app_user_id;
  const aliases = event.aliases || [];
  const eventType = event.type;
  const entitlementIds = event.entitlement_ids || [];

  // Determine new tier
  let tier = "free";
  if (["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "NON_RENEWING_PURCHASE"].includes(eventType)) {
    if (entitlementIds.includes(RC_ENTITLEMENT_MAX)) tier = "max";
    else if (entitlementIds.includes(RC_ENTITLEMENT_PRO)) tier = "pro";
  }
  // CANCELLATION: still active until period end — keep tier
  // EXPIRATION / BILLING_ISSUE: downgrade to free
  if (eventType === "EXPIRATION" || eventType === "SUBSCRIBER_ALIAS") {
    tier = "free";
  }

  if (!appUserId) return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });

  // Update by app_user_id (= our device_id / Supabase auth UID)
  const allIds = [appUserId, ...aliases].filter(Boolean);
  for (const uid of allIds) {
    await sbAdmin(env, "PATCH", "profiles?device_id=eq." + encodeURIComponent(uid), {
      subscription_status: tier,
      rc_app_user_id: appUserId,
    });
  }

  console.log("[rc-webhook] event:", eventType, "appUserId:", appUserId, "tier:", tier);
  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });
}

async function handleStripeWebhook(request, env) {
  const rawBody = await request.text();
  const sigHeader = request.headers.get("stripe-signature") || "";
  if (!env.STRIPE_WEBHOOK_SECRET)
    return new Response(JSON.stringify({ error: "Not configured" }), { status: 500, headers: { "Content-Type": "application/json" } });
  const valid = await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!valid)
    return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 400, headers: { "Content-Type": "application/json" } });
  let event;
  try { event = JSON.parse(rawBody); } catch(e) {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const obj = event.data && event.data.object;
  if (!obj) return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });

  if (event.type === "checkout.session.completed") {
    const deviceId = obj.client_reference_id || (obj.metadata && obj.metadata.device_id);
    const customerId = obj.customer;
    const tier = (obj.metadata && obj.metadata.tier) || "pro";
    if (deviceId && customerId) {
      await sb(env, "PATCH", "profiles?device_id=eq." + encodeURIComponent(deviceId), {
        stripe_customer_id: customerId,
        subscription_status: tier,
      });
    }
  }

  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const customerId = obj.customer;
    const status = obj.status;
    const priceId = obj.items && obj.items.data && obj.items.data[0] && obj.items.data[0].price && obj.items.data[0].price.id;
    let tier = "free";
    if (status === "active" || status === "trialing") {
      if (STRIPE_MAX_PRICE_IDS.has(priceId)) tier = "max";
      else if (STRIPE_PRO_PRICE_IDS.has(priceId)) tier = "pro";
    }
    if (customerId) {
      await sb(env, "PATCH", "profiles?stripe_customer_id=eq." + encodeURIComponent(customerId), {
        subscription_status: tier,
      });
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });
}

// ── Search Orchestrator helpers ───────────────────────────────────────────
function getNutrientVal(nutrients, id) {
  const n = (nutrients || []).find(x => x.nutrientId === id || x.nutrientNumber === String(id));
  return Math.round(n && n.value ? n.value : 0);
}

// Comprehensive restaurant chain keyword list — lowercase substrings for partial matching
// e.g. "mcdonald" matches "McDonald's", "mcdonalds nuggets", "mcdonald's big mac", etc.
const CHAIN_KEYWORDS = [
  // Burgers
  "mcdonald","burger king","wendy's","five guys","shake shack","in-n-out",
  "whataburger","culver's","jack in the box","carl's jr","hardee's","hardee",
  "sonic drive-in","checkers","rally's","steak 'n shake","steak n shake","fatburger",
  "smashburger","burgerfi","habit burger","the habit","freddy's","fuddruckers",
  // Chicken
  "chick-fil-a","chick fil a","popeyes","kfc","raising cane","zaxby",
  "wingstop","bojangles","church's chicken","el pollo loco","slim chickens",
  "jollibee","dave's hot chicken","hattie b","golden chick","huey magoo",
  // Sandwiches & Subs
  "subway","jimmy john","jersey mike","firehouse subs","firehouse sub","quiznos",
  "potbelly","which wich","penn station","charley's","charleys","goodcents",
  "mr. hero","blimpie","togo's",
  // Mexican
  "chipotle","qdoba","moe's southwest","taco bell","del taco","taco bueno",
  "taco cabana","on the border","fuzzy's taco","freebirds","chronic tacos",
  "salsarita","tijuana flats","baja fresh","rubio's",
  // Pizza
  "pizza hut","domino's","papa john","little caesar","papa murphy",
  "sbarro","blaze pizza","mod pizza","pieology","round table pizza","marco's pizza",
  "cicis","cici's","godfather's pizza","hungry howie","jet's pizza",
  "east of chicago","donatos","ledo pizza","uno pizzeria","mellow mushroom",
  // Coffee, Bakery & Breakfast
  "starbucks","dunkin'","tim horton","panera bread","einstein bros","bruegger's",
  "caribou coffee","peet's coffee","dutch bros","biggby","scooter's coffee",
  "corner bakery cafe","la madeleine","first watch","waffle house","cracker barrel",
  "bob evans","village inn","ihop","denny's","huddle house","shoney's",
  // Casual & Family Dining
  "applebee's","chili's restaurant","tgi friday","olive garden","red lobster",
  "outback steakhouse","longhorn steakhouse","texas roadhouse","red robin",
  "cheesecake factory","ruby tuesday","buffalo wild wings","bdubs",
  "hooters","yard house","dave & buster","bahama breeze","seasons 52",
  "bonefish grill","carrabba","maggiano","joe's crab shack","bubba gump",
  "benihana","pf chang","p.f. chang","houlihan's",
  // Fine Dining Chains
  "capital grille","ruth's chris","morton's steakhouse","fleming's steakhouse",
  "mastro's","ocean prime","del frisco","sullivan's steakhouse",
  "black angus","lone star steakhouse","sizzler",
  // Fast Casual
  "sweetgreen","noodles & company","noodles and company","freshii",
  "tender greens","dig inn","honeygrow","lemonade restaurant",
  "just salad","salata","mcalister's deli","jason's deli",
  "zoes kitchen","zoës kitchen",
  // Asian Fast Casual
  "panda express","pei wei","manchu wok","genghis grill","bd's mongolian",
  // BBQ
  "dickey's bbq","famous dave's","smokey bones","mission bbq",
  "jim 'n nick","rodizio grill","4 rivers smokehouse","golden corral",
  "ryan's grill","hometown buffet",
  // Ice Cream & Dessert
  "dairy queen","baskin-robbins","baskin robbins","cold stone creamery","marble slab",
  "yogurtland","pinkberry","menchie's","tcby","rita's italian ice",
  "carvel","orange julius","insomnia cookies","krispy kreme","cinnabon",
  "nothing bundt cakes","great american cookies",
  // Smoothies & Juice
  "jamba juice","smoothie king","tropical smoothie","clean juice",
  "booster juice","robeks","nekter juice","pressed juicery",
  // Seafood
  "long john silver","captain d's","legal sea foods","bubba gump shrimp",
  // Convenience & Snacks
  "wawa","sheetz","auntie anne's","pretzelmaker","wetzel's pretzels",
  "hot dog on a stick","nathan's famous",
  // Wing Specialists
  "wing zone","wild wing cafe","anchor bar","pluckers",
  // Deli & Bakery
  "schlotzksy's","great harvest","paradise bakery",
  // Steak & Upscale
  "texas de brazil","fogo de chao","saltgrass","black bear diner","marie callender",
  // Other
  "taco john's","taco time","bad daddy's","smalls sliders",
];

// Returns true if the query appears to reference a restaurant or chain
function detectChain(q) {
  return CHAIN_KEYWORDS.some(c => q.includes(c));
}

async function callSearchOrchestrator(apiKey, query, candidates, recentFoods, isChain) {
  // Compact candidate format — single-letter keys to minimise prompt tokens
  const slim = candidates.map(c => ({
    n: c.description,
    b: c.brandOwner || "",
    cal: getNutrientVal(c.foodNutrients, 1008),
    p: getNutrientVal(c.foodNutrients, 1003),
    c: getNutrientVal(c.foodNutrients, 1005),
    f: getNutrientVal(c.foodNutrients, 1004),
  }));

  const candidateBlock = slim.length > 0
    ? `Candidates:${JSON.stringify(slim)}\n`
    : `No DB results — use your knowledge.\n`;

  // Personalisation: surface foods this user already knows and logs
  const recentBlock = Array.isArray(recentFoods) && recentFoods.length > 0
    ? `User frequently logs: ${JSON.stringify(recentFoods.slice(0, 10))}. If any closely match "${query}", place them at index 0-2.\n`
    : "";

  // Restaurant mode: tell Claude to use its knowledge of official published menu data
  const restaurantBlock = isChain
    ? `RESTAURANT QUERY: Use your knowledge of this chain's official published menu nutrition data. ` +
      `Return specific named menu items (e.g. "Big Mac", "Chicken Burrito Bowl"). ` +
      `For each item: total_cal/total_p/total_c/total_f are the whole-item values as published. ` +
      `Calculate cal100=(total_cal/item_grams)*100, same for p100/c100/f100. ` +
      `Primary serving must be the whole item e.g. {"label":"1 Big Mac (220g)","g":220}. ` +
      `source="ai_generated". Ignore DB candidates if they contradict known menu data.\n`
    : "";

  const result = await callClaude(
    apiKey,
    "Nutrition DB. Output raw JSON array only — no markdown, no text.",
    [{
      role: "user",
      content:
        `Query:"${query}"\n${candidateBlock}${recentBlock}${restaurantBlock}\n` +
        `Return exactly 8 objects. Rules:\n` +
        `[0]=best match for "${query}", accurate macros, Title Case name.\n` +
        `[1-7]=closely related variants — every item must be unmistakably about "${query}".\n` +
        `Discard any candidate unrelated to "${query}"; fill gaps from your knowledge instead.\n` +
        `cal100/p100/c100/f100=per 100g. source="ai_verified" if from candidates, "ai_generated" if new.\n` +
        `servings=array of 2-4 objects [{label,g}] with realistic human portions e.g. [{"label":"1 large egg","g":50},{"label":"2 eggs","g":100},{"label":"100g","g":100}].\n` +
        `[{"name":"","brand":"","cal100":0,"p100":0,"c100":0,"f100":0,"servings":[{"label":"100g","g":100}],"source":"ai_generated"}]`
    }],
    768,
    "claude-haiku-4-5-20251001"
  );

  if (result.error) {
    console.log(`[search-orchestrator] Claude error: ${result.error}`);
    return null;
  }

  try {
    const arr = JSON.parse(result.text.replace(/```json|```/g, "").trim());
    if (!Array.isArray(arr) || arr.length === 0) {
      console.log(`[search-orchestrator] Claude returned non-array or empty: ${result.text.slice(0, 200)}`);
      return null;
    }

    // Convert AI output back to USDA-compatible shape so client parseFood works unchanged
    const foods = arr.slice(0, 8).map((item, idx) => {
      const srvArr = Array.isArray(item.servings) && item.servings.length > 0 ? item.servings : null;
      const primary = srvArr ? srvArr[0] : null;
      return {
        fdcId: `ai-${idx}`,
        description: item.name || "Unknown Food",
        brandOwner: item.brand || "",
        dataType: item.source === "ai_generated" ? "AI Generated" : "AI Verified",
        foodNutrients: [
          { nutrientId: 1008, value: Number(item.cal100) || 0 },
          { nutrientId: 1003, value: Number(item.p100)   || 0 },
          { nutrientId: 1005, value: Number(item.c100)   || 0 },
          { nutrientId: 1004, value: Number(item.f100)   || 0 },
        ],
        // Primary serving drives the default size in FoodDetail
        servingSize: primary ? (Number(primary.g) || 100) : (Number(item.servingGrams) || 100),
        servingSizeUnit: "g",
        householdServingFullText: primary ? (primary.label || "100g") : (item.serving || "100g"),
        // Additional servings flow through foodPortions → parseFood → FoodDetail size picker
        foodPortions: srvArr
          ? srvArr.slice(1).filter(s => Number(s.g) > 0).map(s => ({
              portionDescription: s.label || (s.g + "g"),
              gramWeight: Number(s.g),
            }))
          : [],
        source: item.source || "ai_verified",
      };
    });

    return { foods };
  } catch (e) {
    return null;
  }
}

// ── Base64url helpers ─────────────────────────────────────────────────────
function b64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Uint8Array.from(atob(str), function(c) { return c.charCodeAt(0); });
}

function b64urlEncode(buf) {
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// ── VAPID JWT — creates the Authorization header for Web Push ────────────
// Fixes: EC private keys cannot be imported as "raw" in Web Crypto;
//        must use JWK format built from the raw private scalar + public point.
async function createVapidAuth(endpoint, publicKey, privateKey, subject) {
  const urlObj = new URL(endpoint);
  const audience = urlObj.protocol + "//" + urlObj.host;

  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const jwtPayload = { aud: audience, exp: now + 43200, sub: subject };

  function toBase64Url(str) {
    return btoa(str).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  }

  const headerB64 = toBase64Url(JSON.stringify(header));
  const payloadB64 = toBase64Url(JSON.stringify(jwtPayload));
  const unsigned = headerB64 + "." + payloadB64;

  // Decode keys: privateKey is 32-byte raw scalar; publicKey is 65-byte uncompressed point
  const privBytes = b64urlDecode(privateKey);
  const pubBytes = b64urlDecode(publicKey); // 0x04 || x(32) || y(32)

  // Build JWK — the only format Web Crypto supports for EC private key import
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: b64urlEncode(privBytes),
    x: b64urlEncode(pubBytes.slice(1, 33)),
    y: b64urlEncode(pubBytes.slice(33, 65)),
    key_ops: ["sign"],
    ext: true,
  };

  const cryptoKey = await crypto.subtle.importKey(
    "jwk", jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false, ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    cryptoKey,
    new TextEncoder().encode(unsigned)
  );

  const sigB64 = b64urlEncode(signatureBuffer);
  const jwt = unsigned + "." + sigB64;

  return "vapid t=" + jwt + ", k=" + publicKey;
}

// ── Web Push payload encryption (RFC 8291 aes128gcm) ─────────────────────
// Fixes: push services reject unencrypted payloads — must encrypt with the
//        subscriber's p256dh public key and auth secret before sending.
async function encryptWebPush(p256dhB64, authB64, payloadStr) {
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(payloadStr);

  const receiverPubBytes = b64urlDecode(p256dhB64);
  const authBytes = b64urlDecode(authB64);

  // Generate a random salt and an ephemeral ECDH sender key pair
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const senderKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true, ["deriveBits"]
  );

  // Import receiver's public key for ECDH
  const receiverKey = await crypto.subtle.importKey(
    "raw", receiverPubBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false, []
  );

  // ECDH shared secret (32 bytes)
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: receiverKey },
    senderKeyPair.privateKey, 256
  ));

  const senderPubBytes = new Uint8Array(
    await crypto.subtle.exportKey("raw", senderKeyPair.publicKey)
  );

  // HKDF-Extract: PRK = HMAC-SHA256(salt=auth, ikm=ecdhSecret)
  async function hkdfExtract(salt, ikm) {
    const key = await crypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", key, ikm));
  }

  // HKDF-Expand: T(i) chain
  async function hkdfExpand(prk, info, len) {
    const prkKey = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const out = new Uint8Array(len);
    let t = new Uint8Array(0);
    let offset = 0;
    for (let i = 1; offset < len; i++) {
      const block = new Uint8Array(t.length + info.length + 1);
      block.set(t);
      block.set(info, t.length);
      block[t.length + info.length] = i;
      t = new Uint8Array(await crypto.subtle.sign("HMAC", prkKey, block));
      out.set(t.slice(0, Math.min(t.length, len - offset)), offset);
      offset += t.length;
    }
    return out;
  }

  // RFC 8291: PRK_key = HKDF-Extract(auth, ecdh_secret)
  //           IKM     = HKDF-Expand(PRK_key, "WebPush: info\0" || recv_pub || send_pub, 32)
  const prkKey = await hkdfExtract(authBytes, ecdhSecret);
  const keyInfoStr = encoder.encode("WebPush: info\0");
  const keyInfo = new Uint8Array(keyInfoStr.length + receiverPubBytes.length + senderPubBytes.length);
  keyInfo.set(keyInfoStr);
  keyInfo.set(receiverPubBytes, keyInfoStr.length);
  keyInfo.set(senderPubBytes, keyInfoStr.length + receiverPubBytes.length);
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  // PRK_content = HKDF-Extract(salt, ikm)
  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, encoder.encode("Content-Encoding: nonce\0"), 12);

  // Pad + encrypt: plaintext || 0x02 (end-of-record delimiter)
  const padded = new Uint8Array(plaintext.length + 1);
  padded.set(plaintext);
  padded[plaintext.length] = 0x02;

  const cekKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, cekKey, padded)
  );

  // aes128gcm content: salt(16) | rs(4) | idlen(1) | sender_pub(65) | ciphertext
  const rs = 4096;
  const output = new Uint8Array(16 + 4 + 1 + senderPubBytes.length + ciphertext.length);
  output.set(salt, 0);
  output[16] = (rs >>> 24) & 0xff;
  output[17] = (rs >>> 16) & 0xff;
  output[18] = (rs >>> 8) & 0xff;
  output[19] = rs & 0xff;
  output[20] = senderPubBytes.length;
  output.set(senderPubBytes, 21);
  output.set(ciphertext, 21 + senderPubBytes.length);
  return output;
}

// ── Web Push sender ───────────────────────────────────────────────────────
async function sendWebPush(endpoint, p256dhKey, authKey, payload, vapidPublicKey, vapidPrivateKey, vapidSubject) {
  try {
    const vapidHeader = await createVapidAuth(endpoint, vapidPublicKey, vapidPrivateKey, vapidSubject);
    const encryptedBody = await encryptWebPush(p256dhKey, authKey, payload);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": vapidHeader,
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        "TTL": "86400",
        "Urgency": "normal",
      },
      body: encryptedBody,
    });
    return { ok: response.ok, status: response.status };
  } catch (e) {
    console.log("[sendWebPush] THREW:", e.message, e.stack);
    return { ok: false, status: 0, error: e.message };
  }
}

// ── APNs sender (native iOS push) ─────────────────────────────────────────
async function sendApnsPush(apnsToken, title, bodyText, env) {
  if (!env.APNS_PRIVATE_KEY || !env.APNS_KEY_ID || !env.APNS_TEAM_ID) {
    console.log("[sendApnsPush] Missing APNs credentials in env");
    return { ok: false, status: 0, error: "Missing APNs credentials" };
  }
  try {
    function toB64Url(str) {
      return btoa(str).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    }
    const headerB64 = toB64Url(JSON.stringify({ alg: "ES256", kid: env.APNS_KEY_ID }));
    const now = Math.floor(Date.now() / 1000);
    const payloadB64 = toB64Url(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: now }));
    const unsigned = headerB64 + "." + payloadB64;

    // Import the PKCS8 p8 key (stored with or without PEM headers)
    const b64 = env.APNS_PRIVATE_KEY.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
    const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey(
      "pkcs8", der,
      { name: "ECDSA", namedCurve: "P-256" },
      false, ["sign"]
    );
    const sigBuf = await crypto.subtle.sign(
      { name: "ECDSA", hash: { name: "SHA-256" } },
      cryptoKey,
      new TextEncoder().encode(unsigned)
    );
    const jwt = "bearer " + unsigned + "." + b64urlEncode(sigBuf);

    const apnsBody = JSON.stringify({ aps: { alert: { title, body: bodyText }, sound: "default" } });
    const response = await fetch("https://api.push.apple.com/3/device/" + apnsToken, {
      method: "POST",
      headers: {
        "Authorization": jwt,
        "apns-topic": "live.macrotrack.app",
        "apns-priority": "10",
        "apns-push-type": "alert",
        "Content-Type": "application/json",
      },
      body: apnsBody,
    });
    const respText = await response.text();
    console.log("[sendApnsPush] status:", response.status, "body:", respText);
    return { ok: response.ok, status: response.status };
  } catch (e) {
    console.log("[sendApnsPush] ERROR:", e.message);
    return { ok: false, status: 0, error: e.message };
  }
}

const COACH_SYSTEM = `You are a no-nonsense personal nutrition and fitness coach inside MacroTrack — a chat-based mobile app. Direct, honest, specific, motivating without being fake.

You have the user's complete data: goal (cut/bulk/maintain), target weight, calorie and macro targets, food logs for the past week, weight history, adherence patterns.

GOAL-SPECIFIC:
- CUTTING: 0.5-1 lb/week ideal. Protein 0.8-1g/lb. Flag if losing too fast (muscle loss risk).
- BULKING: 0.25-0.5 lb/week gain. 200-300 kcal surplus max. Protein 0.8-1g/lb.
- MAINTAINING: Hit targets consistently. Recomp is possible.

HOW TO COACH:
- Use their actual numbers. Not "eat more protein" but "you need 38g more — add 5oz chicken"
- Identify patterns in their logs
- Suggest specific foods when asked what to eat
- Write like you're texting. Short paragraphs, line breaks between ideas.
- DO NOT use markdown formatting. No asterisks, no bullet hyphens, no headers.
- Keep it concise. 3-5 short paragraphs max.
- Never repeat the same advice twice`;

function getCoachSystem(mode) {
  const base = `You are a personal nutrition and fitness coach inside MacroTrack — a chat-based mobile app. You have the user's complete data: goal, targets, food logs, weight history, adherence patterns.

GOAL-SPECIFIC:
- CUTTING: 0.5-1 lb/week ideal. Protein 0.8-1g/lb. Flag if losing too fast.
- BULKING: 0.25-0.5 lb/week gain. 200-300 kcal surplus max.
- MAINTAINING: Hit targets consistently. Recomp is possible.

CRITICAL FORMATTING RULES:
- This is a CHAT interface on a phone. Write like you're texting a friend.
- NEVER use asterisks, bold markers, bullet points, hyphens as list markers, or any markdown syntax. EVER.
- Write in short separate paragraphs. Each thought gets its own paragraph with a blank line between.
- When suggesting multiple foods, put each on its own line. Do not use dashes or bullets before them.
- Keep responses to 3-5 short paragraphs. No walls of text.
- Use plain numbers inline naturally: "You need 38g more protein — a 6oz chicken breast covers that."
- Sound like a real person texting, not a document or a report.

Always reference their actual numbers. Suggest specific foods with specific portions. Never repeat the same advice twice.`;

  if (mode === "tough") {
    return base + `\n\nPERSONALITY: TOUGH LOVE. Brutally honest, no sugarcoating. If they ate like crap, say it. Hold them accountable with blunt language. Challenge excuses. Push hard. You care, but you show it through honesty, not comfort.`;
  }
  if (mode === "supportive") {
    return base + `\n\nPERSONALITY: SUPPORTIVE. Lead with what they did well. Celebrate consistency and small wins. Frame setbacks as learning opportunities. Warm, positive language. When giving corrections, be gentle and solution-focused.`;
  }
  return base + `\n\nPERSONALITY: BALANCED. Direct but fair. Mix accountability with encouragement. Conversational tone like a text from a coach who respects you. Not harsh, not soft — just real.`;
}

export default {
  // ── Cron handler for scheduled push notifications ───────────────────
  async scheduled(event, env, ctx) {
    console.log("[scheduled] handler entered. cron:", event.cron, "scheduledTime:", event.scheduledTime);

    const now = new Date();
    const hour = now.getUTCHours();
    const day = now.getUTCDay();

    // EST offset: -4 during EDT (Mar-Nov), -5 during EST (Nov-Mar)
    const estOffset = -4;
    const estNow = new Date(now.getTime() + estOffset * 60 * 60 * 1000);
    const todayISO = estNow.toISOString().slice(0, 10);

    console.log("[scheduled] now UTC:", now.toISOString(), "hour:", hour, "day:", day, "todayISO:", todayISO);

    async function sendPush(sub, title, bodyText) {
      console.log("[sendPush] called for sub.id:", sub.id, "sub.device_id:", sub.device_id, "title:", title);
      if (!sub.endpoint) {
        console.log("[sendPush] SKIPPED — sub.endpoint is undefined for sub.id:", sub.id);
        return;
      }
      // APNs path — native iOS subscriptions stored as "apns://<token>"
      if (sub.endpoint.startsWith("apns://")) {
        const apnsToken = sub.endpoint.slice(7);
        console.log("[sendPush] APNs path for sub.id:", sub.id);
        const result = await sendApnsPush(apnsToken, title, bodyText, env);
        if (result.status === 410 || result.status === 400) {
          console.log("[sendPush] APNs token invalid, deleting sub.id:", sub.id);
          await sb(env, "DELETE", "push_subscriptions?id=eq." + sub.id);
        }
        return;
      }
      try {
        const pushPayload = JSON.stringify({
          title: title,
          body: bodyText,
          url: "https://macrotrack.live/app.html",
          icon: "https://macrotrack.live/app.htmlicon-192.png",
        });
        console.log("[sendPush] calling sendWebPush for sub.id:", sub.id);
        const result = await sendWebPush(
          sub.endpoint, sub.p256dh, sub.auth, pushPayload,
          env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY,
          env.VAPID_SUBJECT || "mailto:kjgoodwin01@gmail.com"
        );
        console.log("[sendPush] sendWebPush result for sub.id:", sub.id, "status:", result.status, "ok:", result.ok);
        if (result.status === 410 || result.status === 404) {
          console.log("[sendPush] subscription expired/gone, deleting sub.id:", sub.id);
          await sb(env, "DELETE", "push_subscriptions?id=eq." + sub.id);
        }
      } catch (e) {
        console.log("[sendPush] ERROR for sub.id:", sub.id, e.message);
      }
    }

    // ── Weekly report: Sunday 2 PM UTC = 10 AM EDT ──────────────────────
    console.log("[scheduled] checking weekly report block: day === 0 && hour === 14 →", day === 0 && hour === 14);
    if (day === 0 && hour === 14) {
      const subs = await sbAdmin(env, "GET", "push_subscriptions?notify_report=eq.true&limit=5000");
      console.log("[scheduled] weekly report subs count:", (subs.data || []).length, "subs.ok:", subs.ok);
      for (const sub of (subs.data || [])) {
        console.log("[scheduled] sending weekly report push to sub.id:", sub.id);
        await sendPush(sub, "Weekly Check-in Ready 📊", "Your coaching report is ready. See how your week went.");
      }
    }

    // ── Daily reminder: 4 PM UTC = 12 PM EDT ───────────────────────────
    console.log("[scheduled] checking daily reminder block: hour === 16 →", hour === 16);
    if (hour === 16) {
      const subs = await sbAdmin(env, "GET", "push_subscriptions?notify_reminder=eq.true&limit=5000");
      console.log("[scheduled] daily reminder subs count:", (subs.data || []).length, "subs.ok:", subs.ok);
      if (subs.data && subs.data.length > 0) {
        for (const sub of subs.data) {
          try {
            if (!sub.device_id) {
              console.log("[scheduled] daily reminder — sub.device_id is undefined for sub.id:", sub.id, "SKIPPING");
              continue;
            }
            const entries = await sbAdmin(env, "GET",
              "food_entries?device_id=eq." + encodeURIComponent(sub.device_id) +
              "&log_date=eq." + todayISO + "&limit=1"
            );
            const hasLogged = entries.data && entries.data.length > 0;
            console.log("[scheduled] daily reminder sub.id:", sub.id, "hasLogged:", hasLogged);
            if (!hasLogged) {
              console.log("[scheduled] sending daily reminder push to sub.id:", sub.id);
              await sendPush(sub, "Don't Forget to Log 💪", "You haven't logged any food today. Stay on track.");
            }
          } catch (e) {
            console.log("[scheduled] daily reminder ERROR for sub.id:", sub.id, e.message);
          }
        }
      }
    }

    // ── Protein gap: 9 PM UTC = 5 PM EDT ───────────────────────────────
    // Fires if user is under their personal protein goal for the day
    console.log("[scheduled] checking protein gap block: hour === 21 →", hour === 21);
    if (hour === 21) {
      const subs = await sbAdmin(env, "GET", "push_subscriptions?notify_correction=eq.true&limit=5000");
      console.log("[scheduled] protein gap subs count:", (subs.data || []).length, "subs.ok:", subs.ok);
      if (subs.data && subs.data.length > 0) {
        for (const sub of subs.data) {
          try {
            if (!sub.device_id) {
              console.log("[scheduled] protein gap — sub.device_id is undefined for sub.id:", sub.id, "SKIPPING");
              continue;
            }

            // Resolve personal protein goal from profile
            const profile = await sbAdmin(env, "GET",
              "profiles?device_id=eq." + encodeURIComponent(sub.device_id) + "&limit=1"
            );
            if (!profile.data || profile.data.length === 0) {
              console.log("[scheduled] protein gap — no profile for sub.id:", sub.id, "SKIPPING");
              continue;
            }
            const p = profile.data[0];
            const proteinGoal = Math.round(
              (p.protein > 0 ? p.protein : (p.target_weight || 0) * 0.9)
            );
            console.log("[scheduled] protein gap sub.id:", sub.id, "proteinGoal:", proteinGoal, "(from protein:", p.protein, "target_weight:", p.target_weight, ")");
            if (proteinGoal === 0) {
              console.log("[scheduled] protein gap — could not determine goal for sub.id:", sub.id, "SKIPPING");
              continue;
            }

            // Sum today's protein from food_entries
            const entries = await sbAdmin(env, "GET",
              "food_entries?device_id=eq." + encodeURIComponent(sub.device_id) +
              "&log_date=eq." + todayISO + "&limit=200"
            );
            const proteinLogged = !entries.data || entries.data.length === 0 ? 0 : Math.round(entries.data.reduce(function(sum, e) {
              return sum + (parseFloat(e.protein) || 0);
            }, 0));

            const gap = proteinGoal - proteinLogged;
            console.log("[scheduled] protein gap sub.id:", sub.id, "proteinLogged:", proteinLogged, "gap:", gap);

            if (gap > 0) {
              const msg = "You've had " + proteinLogged + "g of protein today. You still need " + gap + "g to hit your " + proteinGoal + "g goal!";
              console.log("[scheduled] sending protein gap push to sub.id:", sub.id);
              await sendPush(sub, "Protein Gap Alert 🎯", msg);
            }
          } catch (e) {
            console.log("[scheduled] protein gap ERROR for sub.id:", sub.id, e.message);
          }
        }
      }
    }

    console.log("[scheduled] handler complete.");
  },

  // ── Main request handler ────────────────────────────────────────────
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return jsonRes({ error: "Method not allowed" }, 405, cors);
    }

    // Stripe webhook must read raw body before JSON parse
    const reqUrl = new URL(request.url);
    if (reqUrl.pathname.endsWith("/stripe-webhook")) {
      return handleStripeWebhook(request, env);
    }
    if (reqUrl.pathname.endsWith("/rc-webhook")) {
      return handleRevenueCatWebhook(request, env);
    }

    let body;
    try { body = await request.json(); }
    catch (e) { return jsonRes({ error: "Invalid JSON" }, 400, cors); }

    const { type } = body;

    // ── INVITE CODE: Validate ────────────────────────────────────────────
    if (type === "validate_code") {
      const { code, deviceId } = body;
      if (!code || !deviceId) return jsonRes({ error: "Missing code or deviceId" }, 400, cors);

      const stored = await env.CODES.get(code.toUpperCase().trim());
      if (!stored) return jsonRes({ valid: false, reason: "Invalid code" }, 200, cors);

      let codeData;
      try { codeData = JSON.parse(stored); }
      catch (e) { return jsonRes({ valid: false, reason: "Invalid code" }, 200, cors); }

      if (codeData.used && codeData.deviceId !== deviceId) {
        return jsonRes({ valid: false, reason: "Code already used" }, 200, cors);
      }

      if (codeData.revoked) {
        return jsonRes({ valid: false, reason: "Access revoked" }, 200, cors);
      }

      codeData.used = true;
      codeData.deviceId = deviceId;
      codeData.usedAt = new Date().toISOString();
      await env.CODES.put(code.toUpperCase().trim(), JSON.stringify(codeData));

      return jsonRes({ valid: true, name: codeData.name || "" }, 200, cors);
    }

    // ── INVITE CODE: Check access ────────────────────────────────────────
    if (type === "check_access") {
      const { deviceId } = body;
      if (!deviceId) return jsonRes({ allowed: false }, 200, cors);

      const list = await env.CODES.list();
      for (const key of list.keys) {
        const stored = await env.CODES.get(key.name);
        if (!stored) continue;
        try {
          const codeData = JSON.parse(stored);
          if (codeData.deviceId === deviceId) {
            if (codeData.revoked) return jsonRes({ allowed: false, reason: "Access revoked" }, 200, cors);
            return jsonRes({ allowed: true }, 200, cors);
          }
        } catch (e) {}
      }
      return jsonRes({ allowed: false, reason: "No valid access code" }, 200, cors);
    }

    // ── SYNC: Load ────────────────────────────────────────────────────────
    if (type === "sync_load") {
      const { deviceId, email } = body;
      if (!deviceId) return jsonRes({ error: "Missing deviceId" }, 400, cors);
      const [profile, entries, wlog, workoutSessions] = await Promise.all([
        sbAdmin(env, "GET", "profiles?device_id=eq." + encodeURIComponent(deviceId) + "&limit=1"),
        sbAdmin(env, "GET", "food_entries?device_id=eq." + encodeURIComponent(deviceId) + "&order=log_date.asc&limit=500"),
        sbAdmin(env, "GET", "weight_log?device_id=eq." + encodeURIComponent(deviceId) + "&order=log_date.asc&limit=200"),
        sbAdmin(env, "GET", "workout_sessions?device_id=eq." + encodeURIComponent(deviceId) + "&order=log_date.asc&limit=500").catch(() => ({ data: [] })),
      ]);
      let profileRow = (profile.data && profile.data[0]) || null;
      let resolvedEntries = entries.data || [];
      let resolvedWlog = wlog.data || [];
      let resolvedWorkouts = workoutSessions.data || [];
      // If device_id lookup found nothing and we have an email, try email fallback
      // (handles cases where device_id shifted after auth migration)
      if (!profileRow && email) {
        const byEmail = await sbAdmin(env, "GET", "profiles?email=eq." + encodeURIComponent(email.trim().toLowerCase()) + "&limit=1");
        profileRow = (byEmail.data && byEmail.data[0]) || null;
        // Re-query all data under the resolved device_id — the original queries used the wrong id
        if (profileRow && profileRow.device_id !== deviceId) {
          const resolvedId = profileRow.device_id;
          const [re, rw, rws] = await Promise.all([
            sbAdmin(env, "GET", "food_entries?device_id=eq." + encodeURIComponent(resolvedId) + "&order=log_date.asc&limit=500"),
            sbAdmin(env, "GET", "weight_log?device_id=eq." + encodeURIComponent(resolvedId) + "&order=log_date.asc&limit=200"),
            sbAdmin(env, "GET", "workout_sessions?device_id=eq." + encodeURIComponent(resolvedId) + "&order=log_date.asc&limit=500").catch(() => ({ data: [] })),
          ]);
          resolvedEntries = re.data || [];
          resolvedWlog = rw.data || [];
          resolvedWorkouts = rws.data || [];
        }
      }
      return jsonRes({
        profile: profileRow,
        entries: resolvedEntries,
        wlog: resolvedWlog,
        workouts: resolvedWorkouts,
        workoutTemplates: (profileRow && profileRow.workout_templates) || [],
        subscription_status: (profileRow && profileRow.subscription_status) || "free",
      }, 200, cors);
    }

    // ── SYNC: Save profile ────────────────────────────────────────────────
    if (type === "sync_profile") {
      const { deviceId, name, goalType, targetWeight, calories, protein, carbs, fat, email } = body;
      if (!deviceId) return jsonRes({ error: "Missing deviceId" }, 400, cors);
      if (!name || !name.trim()) return jsonRes({ error: "Name is required" }, 400, cors);
      const profileData = {
        device_id: deviceId, name: name || "", goal_type: goalType || "cut",
        target_weight: targetWeight || null, calories: calories || 2100,
        protein: protein || 180, carbs: carbs || 210, fat: fat || 60,
        updated_at: new Date().toISOString(),
      };
      if (email) profileData.email = email.trim().toLowerCase();
      const result = await sb(env, "POST", "profiles", profileData);
      if (!result.ok) return jsonRes({ error: "Failed to save profile" }, 500, cors);
      return jsonRes({ ok: true }, 200, cors);
    }

    // ── SYNC: Add food entry ──────────────────────────────────────────────
    if (type === "sync_add_entry") {
      const { deviceId, entry, email } = body;
      if (!deviceId || !entry) return jsonRes({ error: "Missing data" }, 400, cors);
      // If device ID has no profile, fall back to email lookup (email is a stable identity)
      let resolvedDeviceId = deviceId;
      let profileCheck = await sbAdmin(env, "GET", "profiles?device_id=eq." + encodeURIComponent(deviceId) + "&limit=1");
      if ((!profileCheck.data || profileCheck.data.length === 0) && email) {
        // Device ID has no profile — look up by email and use that profile's device_id.
        // We cannot change the profile's device_id due to FK constraint from food_entries.
        const emailClean = email.trim().toLowerCase();
        const byEmail = await sbAdmin(env, "GET", "profiles?email=eq." + encodeURIComponent(emailClean) + "&limit=1");
        if (byEmail.data && byEmail.data.length > 0) {
          resolvedDeviceId = byEmail.data[0].device_id; // store entry under the existing profile
        } else {
          return jsonRes({ error: "Profile not found — complete onboarding first" }, 403, cors);
        }
      } else if (!profileCheck.data || profileCheck.data.length === 0) {
        return jsonRes({ error: "Profile not found — complete onboarding first" }, 403, cors);
      }
      const result = await sb(env, "POST", "food_entries", {
        device_id: resolvedDeviceId, log_date: entry.date, meal: entry.meal,
        name: entry.name, serving: entry.serving || "",
        cal: entry.cal || 0, protein: entry.p || 0, carbs: entry.c || 0, fat: entry.f || 0,
      });
      if (!result.ok) return jsonRes({ error: "Failed to save entry" }, 500, cors);
      const saved = result.data && result.data[0];
      return jsonRes({ ok: true, id: saved ? saved.id : null }, 200, cors);
    }

    // ── SYNC: Update food entry ──────────────────────────────────────────
    if (type === "sync_update_entry") {
      const { entryId, entry } = body;
      if (!entryId || !entry) return jsonRes({ error: "Missing data" }, 400, cors);
      const result = await sb(env, "PATCH",
        "food_entries?id=eq." + encodeURIComponent(entryId),
        {
          cal: entry.cal || 0,
          protein: entry.p || 0,
          carbs: entry.c || 0,
          fat: entry.f || 0,
        }
      );
      if (!result.ok) return jsonRes({ error: "Failed to update entry" }, 500, cors);
      return jsonRes({ ok: true }, 200, cors);
    }

    // ── SYNC: Delete food entry ───────────────────────────────────────────
    if (type === "sync_delete_entry") {
      const { deviceId, entryId } = body;
      if (!deviceId || !entryId) return jsonRes({ error: "Missing data" }, 400, cors);
      await sb(env, "DELETE", "food_entries?id=eq." + encodeURIComponent(entryId) + "&device_id=eq." + encodeURIComponent(deviceId));
      return jsonRes({ ok: true }, 200, cors);
    }

    // ── SYNC: Log weight ──────────────────────────────────────────────────
    if (type === "sync_log_weight") {
      const { deviceId, date, weight } = body;
      if (!deviceId || !date || !weight) return jsonRes({ error: "Missing data" }, 400, cors);
      const profileCheck = await sb(env, "GET", "profiles?device_id=eq." + encodeURIComponent(deviceId) + "&limit=1");
      if (!profileCheck.data || profileCheck.data.length === 0) {
        return jsonRes({ error: "Profile not found — complete onboarding first" }, 403, cors);
      }
      const result = await sb(env, "POST", "weight_log", {
        device_id: deviceId, log_date: date, weight: weight,
      });
      if (!result.ok) return jsonRes({ error: "Failed to save weight" }, 500, cors);
      return jsonRes({ ok: true }, 200, cors);
    }

    // ── SYNC: Workout session (upsert one day) ───────────────────────────
    if (type === "sync_workout") {
      const { deviceId, email, date, exercises } = body;
      if (!deviceId || !date || !Array.isArray(exercises)) return jsonRes({ error: "Missing data" }, 400, cors);
      // Resolve identity — same pattern as sync_add_entry
      let resolvedDeviceId = deviceId;
      let profileCheck = await sbAdmin(env, "GET", "profiles?device_id=eq." + encodeURIComponent(deviceId) + "&limit=1");
      if ((!profileCheck.data || profileCheck.data.length === 0) && email) {
        const emailClean = email.trim().toLowerCase();
        const byEmail = await sbAdmin(env, "GET", "profiles?email=eq." + encodeURIComponent(emailClean) + "&limit=1");
        if (byEmail.data && byEmail.data.length > 0) {
          resolvedDeviceId = byEmail.data[0].device_id;
        } else {
          return jsonRes({ error: "Profile not found — complete onboarding first" }, 403, cors);
        }
      } else if (!profileCheck.data || profileCheck.data.length === 0) {
        return jsonRes({ error: "Profile not found — complete onboarding first" }, 403, cors);
      }
      // Upsert: UNIQUE(device_id, log_date) means duplicate days are merged, never created
      const result = await sb(env, "POST", "workout_sessions", {
        device_id: resolvedDeviceId,
        log_date: date,
        exercises: exercises,
        updated_at: new Date().toISOString(),
      });
      if (!result.ok) return jsonRes({ error: "Failed to save workout" }, 500, cors);
      return jsonRes({ ok: true }, 200, cors);
    }

    // ── SYNC: Workout templates (save full array to profile) ─────────────
    if (type === "sync_workout_templates") {
      const { deviceId, templates } = body;
      if (!deviceId || !Array.isArray(templates)) return jsonRes({ error: "Missing data" }, 400, cors);
      const result = await sb(env, "PATCH",
        "profiles?device_id=eq." + encodeURIComponent(deviceId),
        { workout_templates: templates }
      );
      if (!result.ok) return jsonRes({ error: "Failed to save templates" }, 500, cors);
      return jsonRes({ ok: true }, 200, cors);
    }

    // ── FOOD SEARCH (V11 - AI ORCHESTRATED + KV CACHE) ───────────────────
    if (type === "usda_search") {
      const { query, recentFoods } = body;
      if (!query) return jsonRes({ error: "Missing query" }, 400, cors);

      const q = query.trim().toLowerCase();
      const qWords = q.split(/\s+/);
      const isChain = detectChain(q);

      // ── KV cache check — common foods ~50ms, chains cached 7 days ────────
      const cacheKey = "search:" + q;
      const cacheTtl = isChain ? 604800 : 86400; // 7 days for chains, 24h for generic
      try {
        const cached = await env.CODES.get(cacheKey);
        if (cached) {
          console.log(`[search-orchestrator] cache HIT "${q}" (chain=${isChain})`);
          return jsonRes({ foods: JSON.parse(cached), cached: true }, 200, cors);
        }
      } catch (e) {
        console.log(`[search-orchestrator] cache read error: ${e.message}`);
      }

      // Fetch from USDA (only if API key is configured) and OFF in parallel
      const usdaPromise = env.USDA_API_KEY
        ? fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(q)}&pageSize=8&api_key=${env.USDA_API_KEY}`)
            .then(r => {
              if (!r.ok) { console.log(`[search-orchestrator] USDA HTTP ${r.status}`); return {foods:[]}; }
              return r.json();
            }).catch(e => { console.log(`[search-orchestrator] USDA fetch error: ${e.message}`); return {foods:[]}; })
        : (console.log(`[search-orchestrator] USDA_API_KEY not set`), Promise.resolve({foods:[]}));

      const offPromise = fetch(
        `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=12&fields=product_name,brands,serving_size,serving_quantity,nutriments,code,unique_scans_n`,
        { headers: { "User-Agent": "MacroTrack App" } }
      ).then(r => r.ok ? r.json() : {products:[]}).catch(() => ({products:[]}));

      const [usdaRaw, offRaw] = await Promise.all([usdaPromise, offPromise]);

      // Diagnostic logging so we can see exactly what each source returns
      console.log(`[search-orchestrator] query="${q}" USDA foods=${usdaRaw.foods?.length ?? "err"} OFF products=${offRaw.products?.length ?? "err"}`);

      // Normalise both sources into a unified shape
      const combined = [];

      (offRaw.products || []).forEach(p => {
        if (!p.product_name || !p.nutriments) return;
        const n = p.nutriments;
        const cal = n["energy-kcal_100g"] || Math.round((n["energy_100g"] || 0) / 4.184);
        combined.push({
          fdcId: "off-" + p.code,
          description: p.product_name,
          brandOwner: p.brands || "",
          dataType: "Branded",
          foodNutrients: [
            { nutrientId: 1008, value: cal },
            { nutrientId: 1003, value: n.proteins_100g || 0 },
            { nutrientId: 1005, value: n.carbohydrates_100g || 0 },
            { nutrientId: 1004, value: n.fat_100g || 0 },
          ],
          servingSize: parseFloat(p.serving_quantity) || 100,
          servingSizeUnit: "g",
          source: "OFF",
          pop: parseInt(p.unique_scans_n) || 0,
        });
      });

      (usdaRaw.foods || []).forEach(f => {
        combined.push({ ...f, source: "USDA", pop: 0 });
      });

      console.log(`[search-orchestrator] query="${q}" combined after normalise=${combined.length}`);

      // Score, sort, and deduplicate — relevance only, no source bias
      const scored = combined.map(item => {
        const desc  = item.description.toLowerCase();
        const brand = (item.brandOwner || "").toLowerCase();
        let score = 0;

        // Exact or leading match is strongest signal
        if (desc === q)           score += 40000;
        if (desc.startsWith(q))   score += 20000;

        // Every query word present in name scores high; brand matches score less
        const nameMatches  = qWords.filter(w => desc.includes(w)).length;
        const brandMatches = qWords.filter(w => brand.includes(w)).length;
        score += nameMatches  * 8000;
        score += brandMatches * 2000;

        // Hard penalty for items with zero name-word overlap — likely irrelevant
        if (nameMatches === 0) score -= 30000;

        // Popularity signal from OFF (scans), but only when the item is relevant
        if (nameMatches > 0) score += Math.min((item.pop || 0) * 10, 5000);

        // Penalise legal-entity clutter in brand names and survey data
        if (brand.includes("llc") || brand.includes("inc") || brand.includes("operations")) score -= 3000;
        if (item.dataType === "Survey (FNDDS)") score -= 8000;

        return { ...item, _score: score };
      });
      scored.sort((a, b) => b._score - a._score);

      const seen = new Set();
      const candidates = [];
      for (const item of scored) {
        const nameParts = item.description.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/);
        const key = `${(item.brandOwner || "").toLowerCase().slice(0, 8)}|${nameParts.slice(0, 2).join("")}`;
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push(item);
        }
        if (candidates.length >= 8) break;
      }

      // Fallback: first 8 of the deterministic candidates
      const fallback = candidates.slice(0, 8).map(c => ({ ...c, source: c.source + "_fallback" }));

      // ── AI Orchestration (2.5s hard timeout) ─────────────────────────────
      // Run even with 0 candidates — AI can generate results from knowledge
      if (env.ANTHROPIC_API_KEY) {
        try {
          const aiResult = await Promise.race([
            callSearchOrchestrator(env.ANTHROPIC_API_KEY, q, candidates, recentFoods, isChain),
            new Promise((_, reject) => setTimeout(() => reject(new Error("ai_timeout")), 2500)),
          ]);

          if (aiResult && Array.isArray(aiResult.foods) && aiResult.foods.length > 0) {
            console.log(`[search-orchestrator] query="${q}" chain=${isChain} returned ${aiResult.foods.length} AI results, index-0="${aiResult.foods[0].description}"`);
            // Cache — chains for 7 days (menus rarely change), generic for 24h
            env.CODES.put(cacheKey, JSON.stringify(aiResult.foods), { expirationTtl: cacheTtl }).catch(() => {});
            return jsonRes({ foods: aiResult.foods }, 200, cors);
          }
        } catch (e) {
          console.log(`[search-orchestrator] query="${q}" fell back — reason: ${e.message}`);
        }
      }

      // Deterministic fallback
      console.log(`[search-orchestrator] query="${q}" using fallback (${fallback.length} results)`);
      return jsonRes({ foods: fallback }, 200, cors);
    }

    // ── BARCODE LOOKUP ────────────────────────────────────────────────────
    if (type === "barcode_lookup") {
      const { upc } = body;
      if (!upc) return jsonRes({ error: "Missing upc" }, 400, cors);

      // ── 1. Open Food Facts (3M+ products globally) ───────────────────────
      try {
        const r = await fetch("https://world.openfoodfacts.org/api/v0/product/" + encodeURIComponent(upc) + ".json",
          { headers: { "User-Agent": "MacroTrack/1.0 (https://macrotrack.live)" } });
        if (r.ok) {
          const d = await r.json();
          if (d.status === 1 && d.product) {
            const p = d.product;
            const n = p.nutriments || {};

            // Best available product name (English preferred)
            const productName = (p.product_name_en || p.product_name || p.abbreviated_product_name || "").trim() || "Unknown Product";

            // Brand: take first if comma-separated
            const brand = (p.brands || "").split(",")[0].trim();

            // Energy: prefer kcal/100g; fall back from kJ (1 kcal = 4.184 kJ)
            const kcal100 = Math.round(
              parseFloat(n["energy-kcal_100g"]) ||
              parseFloat(n["energy-kcal"])       ||
              (parseFloat(n["energy_100g"]) / 4.184) ||
              0
            );

            // Serving size: prefer numeric serving_quantity, then parse from serving_size string
            let servGrams = parseFloat(p.serving_quantity) || 0;
            if (!servGrams && p.serving_size) {
              const m = String(p.serving_size).match(/(\d+(?:\.\d+)?)/);
              if (m) servGrams = parseFloat(m[1]);
            }
            if (!servGrams) servGrams = 100;
            const servLabel = p.serving_size ? p.serving_size.trim() : (servGrams + "g");

            // Always include 100g as an extra reference serving
            const extraPortions = servGrams !== 100
              ? [{ portionDescription: "100g", gramWeight: 100 }]
              : [];

            return jsonRes({ foods: [{
              fdcId: "off-" + upc,
              description: productName,
              brandOwner: brand,
              dataType: "Branded",
              gtinUpc: upc,
              foodNutrients: [
                { nutrientId: 1008, value: kcal100 },
                { nutrientId: 1003, value: Math.round(parseFloat(n.proteins_100g)      || 0) },
                { nutrientId: 1005, value: Math.round(parseFloat(n.carbohydrates_100g) || 0) },
                { nutrientId: 1004, value: Math.round(parseFloat(n.fat_100g)           || 0) },
              ],
              servingSize: servGrams,
              servingSizeUnit: "g",
              householdServingFullText: servLabel,
              foodPortions: extraPortions,
            }]}, 200, cors);
          }
        }
      } catch (e) {}

      // ── 2. USDA FoodData Central (branded foods with GTINs) ─────────────
      try {
        const params = new URLSearchParams({ query: upc, pageSize: "5", api_key: env.USDA_API_KEY });
        const r = await fetch("https://api.nal.usda.gov/fdc/v1/foods/search?" + params.toString());
        if (r.ok) {
          const d = await r.json();
          const foods = d.foods || [];
          const match = foods.find(f => f.gtinUpc === upc) || foods[0];
          if (match) return jsonRes({ foods: [match] }, 200, cors);
        }
      } catch (e) {}

      // ── 3. AI fallback — Claude tries to identify from barcode digits ────
      try {
        const aiResult = await callClaude(env.ANTHROPIC_API_KEY,
          "You are a product nutrition database. Return ONLY valid JSON.",
          [{ role: "user", content: `Look up barcode/UPC "${upc}". If you recognise this product, return its nutrition facts as JSON:\n{"found":true,"name":"Product Name","brand":"Brand","serving":"1 serving (Xg)","servingGrams":X,"cal100":X,"p100":X,"c100":X,"f100":X}\nIf unknown, return {"found":false}.` }],
          200
        );
        if (!aiResult.error) {
          const txt = aiResult.text.replace(/```json|```/g, "").trim();
          const ai = JSON.parse(txt);
          if (ai.found && ai.name) {
            const sg = Number(ai.servingGrams) || 100;
            return jsonRes({ foods: [{
              fdcId: "ai-upc-" + upc,
              description: ai.name,
              brandOwner: ai.brand || "",
              dataType: "AI Identified",
              gtinUpc: upc,
              foodNutrients: [
                { nutrientId: 1008, value: Number(ai.cal100) || 0 },
                { nutrientId: 1003, value: Number(ai.p100)   || 0 },
                { nutrientId: 1005, value: Number(ai.c100)   || 0 },
                { nutrientId: 1004, value: Number(ai.f100)   || 0 },
              ],
              servingSize: sg,
              servingSizeUnit: "g",
              householdServingFullText: ai.serving || (sg + "g"),
              foodPortions: sg !== 100 ? [{ portionDescription: "100g", gramWeight: 100 }] : [],
            }]}, 200, cors);
          }
        }
      } catch (e) {}

      return jsonRes({ foods: [] }, 200, cors);
    }

    // ── BARCODE FROM IMAGE ────────────────────────────────────────────────
    if (type === "barcode_from_image") {
      const { imageBase64, mediaType } = body;
      if (!imageBase64) return jsonRes({ error: "Missing image" }, 400, cors);
      const result = await callClaude(env.ANTHROPIC_API_KEY,
        "You are a barcode reader. Find any barcode in the image. Return ONLY valid JSON: {\"upc\":\"digits\"} or {\"upc\":null}.",
        [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: imageBase64 } },
          { type: "text", text: "What is the barcode number? Return only JSON." }
        ]}], 150
      );
      if (result.error) return jsonRes({ error: result.error }, 502, cors);
      try {
        return jsonRes(JSON.parse(result.text.replace(/```json|```/g, "").trim()), 200, cors);
      } catch (e) {
        return jsonRes({ upc: null }, 200, cors);
      }
    }

    // ── IMAGE SCAN ────────────────────────────────────────────────────────
    if (type === "image_scan" || (!type && body.imageBase64)) {
      const { imageBase64, mediaType } = body;
      if (!imageBase64 || !mediaType) return jsonRes({ error: "Missing image data" }, 400, cors);
      const result = await callClaude(env.ANTHROPIC_API_KEY,
        "You are an expert sports nutritionist. Identify the specific dish by name (say Chicken Pot Pie not just chicken). Estimate portion. Use known nutritional data. Return ONLY valid JSON: {\"name\":\"Dish Name\",\"cal\":0,\"p\":0,\"c\":0,\"f\":0,\"confidence\":\"high/medium/low\",\"note\":\"assumptions\"}. All integers.",
        [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: "Identify this food and return nutrition JSON." }
        ]}], 400
      );
      if (result.error) return jsonRes({ error: result.error }, 502, cors);
      try {
        return jsonRes(JSON.parse(result.text.replace(/```json|```/g, "").trim()), 200, cors);
      } catch (e) {
        return jsonRes({ error: "Could not parse nutrition data" }, 500, cors);
      }
    }

    // ── NUTRITION LABEL SCAN ─────────────────────────────────────────────
    if (type === "label_scan") {
      const { imageBase64, mediaType } = body;
      if (!imageBase64 || !mediaType) return jsonRes({ error: "Missing image data" }, 400, cors);
      const result = await callClaude(
        env.ANTHROPIC_API_KEY,
        "You are reading a nutrition facts panel from a food package photo. Extract EXACTLY what is printed — do not estimate. Return ONLY valid JSON: {\"name\":\"product name\",\"serving\":\"serving description from label\",\"servingGrams\":100,\"cal\":0,\"p\":0,\"c\":0,\"f\":0,\"confidence\":\"high/medium/low\"}. All macro values are per serving as printed. Integers only. If the label is unreadable, set confidence to \"low\" and estimate.",
        [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: "Read the nutrition facts label. Return per-serving values exactly as printed." }
        ]}],
        300
      );
      if (result.error) return jsonRes({ error: result.error }, 502, cors);
      try {
        const data = JSON.parse(result.text.replace(/```json|```/g, "").trim());
        return jsonRes({ ...data, isLabel: true }, 200, cors);
      } catch (e) {
        return jsonRes({ error: "Could not read label" }, 500, cors);
      }
    }

    // ── MEAL PLAN ─────────────────────────────────────────────────────────
    if (type === "meal_plan") {
      const { days, calories, protein, carbs, fat, goalType, preferences, context, deviceId, email } = body;
      if (!days || !calories) return jsonRes({ error: "Missing plan parameters" }, 400, cors);
      const tier = await getSubscriptionTier(env, deviceId || "", email || "");
      if (tier === "free") return jsonRes({ error: "pro_required" }, 403, cors);
      if (tier === "pro") {
        const usage = await getWeeklyUsage(env, deviceId, "mealplan");
        if (usage >= 3) return jsonRes({ error: "weekly_limit_reached", limit: 3, used: usage }, 429, cors);
      }

      const prefText = preferences || "Use a variety of whole foods.";
      const contextText = context ? ("\n\nUSER DATA:\n" + context) : "";

      const jsonTemplate = '{"days":[{"day":"Day 1","totalCal":0,"totalProtein":0,"totalCarbs":0,"totalFat":0,"meals":{"Breakfast":[{"food":"name","amount":"Xg","cal":0,"p":0,"c":0,"f":0}],"Lunch":[],"Dinner":[],"Snack":[]}}]}';

      const userPrompt = "Create a " + days + "-day meal prep plan. Per day: " + calories + " kcal, " + protein + "g protein, " + carbs + "g carbs, " + fat + "g fat. Goal: " + goalType + ". Preferences: " + prefText + contextText + ". Every food item must have an exact gram weight (e.g. 180g, 85g). Use the user's recent food history to avoid repeating foods they've been eating. Scale recipe complexity to their cooking skill level. Each day within 50 kcal of target. Vary meals daily. All food amounts in grams only. Return ONLY JSON: " + jsonTemplate;

      try {
        const planRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 6000,
            system: "You are a professional meal prep nutritionist. Return only valid JSON. No markdown, no explanation, no text before or after the JSON.",
            messages: [{ role: "user", content: userPrompt }],
          }),
        });

        if (!planRes.ok) {
          const err = await planRes.json().catch(() => ({}));
          return jsonRes({ error: "AI error: " + (err.error?.message || planRes.status) }, 502, cors);
        }

        const planData = await planRes.json();
        const rawText = ((planData.content || []).find(b => b.type === "text") || {}).text || "";

        let jsonStr = rawText.replace(/```json|```/g, "").trim();
        const firstBrace = jsonStr.indexOf("{");
        const lastBrace = jsonStr.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1) {
          jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
        }

        const plan = JSON.parse(jsonStr);
        if (!plan.days || !Array.isArray(plan.days)) {
          return jsonRes({ error: "Invalid plan structure — try again" }, 500, cors);
        }

        // Recalculate day totals from actual item values — don't trust AI math
        plan.days.forEach(function(day) {
          var cal = 0, prot = 0, carbs = 0, fat = 0;
          Object.values(day.meals || {}).forEach(function(items) {
            (items || []).forEach(function(item) {
              cal   += parseFloat(item.cal) || 0;
              prot  += parseFloat(item.p)   || 0;
              carbs += parseFloat(item.c)   || 0;
              fat   += parseFloat(item.f)   || 0;
            });
          });
          day.totalCal     = Math.round(cal);
          day.totalProtein = Math.round(prot);
          day.totalCarbs   = Math.round(carbs);
          day.totalFat     = Math.round(fat);
        });

        // Strip cooking adjectives so "Grilled Chicken Breast" and "Chicken Breast"
        // consolidate into a single shopping list entry
        function normalizeFood(name) {
          return (name || "").toLowerCase()
            .replace(/\b(grilled|baked|roasted|steamed|boiled|raw|diced|sliced|chopped|cooked|fried|sauteed|sautéed|fresh|frozen|canned|plain|whole|lean|ground|shredded|minced|mashed)\b/g, "")
            .replace(/\s+/g, " ")
            .trim();
        }

        // totals: key = normalized name, value = { grams, displayName }
        const totals = {};
        plan.days.forEach(function(day) {
          Object.values(day.meals || {}).forEach(function(items) {
            (items || []).forEach(function(item) {
              const name = item.food;
              const grams = parseFloat(String(item.amount).replace(/[^0-9.]/g, "")) || 0;
              if (name && grams > 0) {
                const key = normalizeFood(name);
                if (totals[key]) {
                  totals[key].grams += grams;
                } else {
                  totals[key] = { grams, displayName: name };
                }
              }
            });
          });
        });

        function gramsToUS(grams, foodName) {
          const name = (foodName || "").toLowerCase();
          if (name.includes("oil") || name.includes("milk") || name.includes("sauce") || name.includes("broth")) {
            const cups = grams / 240;
            if (cups >= 1) return (Math.ceil(cups * 4) / 4).toFixed(2).replace(/\.?0+$/, "") + " cups";
            const tbsp = Math.ceil(grams / 15);
            return tbsp + " tbsp";
          }
          if (name.includes("egg")) {
            const count = Math.ceil(grams / 50);
            return count + " eggs";
          }
          if (name.includes("banana") || name.includes("apple") || name.includes("orange")) {
            const count = Math.ceil(grams / 120);
            return count + " " + foodName.toLowerCase() + (count > 1 ? "s" : "");
          }
          const lbs = grams / 453.592;
          if (lbs >= 1) {
            const rounded = Math.ceil(lbs * 4) / 4;
            return rounded.toFixed(2).replace(/\.?0+$/, "") + " lbs";
          }
          const oz = grams / 28.35;
          return Math.ceil(oz) + " oz";
        }

        function categorize(name) {
          const n = name.toLowerCase();
          if (n.includes("chicken") || n.includes("beef") || n.includes("turkey") || n.includes("salmon") ||
              n.includes("tuna") || n.includes("shrimp") || n.includes("tilapia") || n.includes("pork") ||
              n.includes("steak") || n.includes("protein powder") || n.includes("greek yogurt") ||
              n.includes("cottage cheese") || n.includes("tofu") || n.includes("tempeh") || n.includes("egg")) {
            return "Proteins";
          }
          if (n.includes("rice") || n.includes("oat") || n.includes("pasta") || n.includes("bread") ||
              n.includes("quinoa") || n.includes("potato") || n.includes("sweet potato") ||
              n.includes("tortilla") || n.includes("wrap") || n.includes("flour")) {
            return "Grains & Carbs";
          }
          if (n.includes("broccoli") || n.includes("spinach") || n.includes("kale") || n.includes("pepper") ||
              n.includes("tomato") || n.includes("onion") || n.includes("garlic") || n.includes("zucchini") ||
              n.includes("mushroom") || n.includes("carrot") || n.includes("celery") || n.includes("lettuce") ||
              n.includes("cucumber") || n.includes("asparagus") || n.includes("green bean") ||
              n.includes("banana") || n.includes("apple") || n.includes("berry") || n.includes("berries") ||
              n.includes("orange") || n.includes("grape") || n.includes("cherry") || n.includes("mango") ||
              n.includes("strawberry") || n.includes("blueberry") || n.includes("fruit")) {
            return "Fruits & Vegetables";
          }
          if (n.includes("milk") || n.includes("cheese") || n.includes("butter") || n.includes("cream") ||
              n.includes("yogurt") || n.includes("egg")) {
            return "Dairy & Eggs";
          }
          return "Other";
        }

        const shoppingList = { "Proteins": [], "Grains & Carbs": [], "Fruits & Vegetables": [], "Dairy & Eggs": [], "Other": [] };
        Object.keys(totals).forEach(function(key) {
          const { grams, displayName } = totals[key];
          const withBuffer = grams * 1.1;
          const qty = gramsToUS(withBuffer, displayName);
          const cat = categorize(displayName);
          shoppingList[cat].push({ item: displayName, qty: qty });
        });

        Object.keys(shoppingList).forEach(function(k) {
          if (shoppingList[k].length === 0) delete shoppingList[k];
        });

        plan.shoppingList = shoppingList;

        // Convert item.amount from raw grams to the most natural unit for
        // each food — purely a display change, the macro numbers are unchanged.
        function humanizeAmount(foodName, grams) {
          const n = (foodName || "").toLowerCase();

          // Whole eggs
          if (/\begg\b/.test(n) && !n.includes("egg white") && !n.includes("egg noodle") && !n.includes("egg substitute")) {
            const count = Math.max(1, Math.round(grams / 55));
            return count === 1 ? "1 whole egg" : count + " whole eggs";
          }
          // Egg whites
          if (n.includes("egg white")) {
            const count = Math.max(1, Math.round(grams / 33));
            return count === 1 ? "1 egg white" : count + " egg whites";
          }
          // Banana
          if (n.includes("banana")) {
            const count = Math.max(1, Math.round(grams / 118));
            return count === 1 ? "1 medium banana" : count + " bananas";
          }
          // Apple
          if (n.includes("apple") && !n.includes("applesauce") && !n.includes("apple juice") && !n.includes("apple cider")) {
            const count = Math.max(1, Math.round(grams / 182));
            return count === 1 ? "1 medium apple" : count + " apples";
          }
          // Orange
          if (n.includes("orange") && !n.includes("orange juice")) {
            const count = Math.max(1, Math.round(grams / 131));
            return count === 1 ? "1 orange" : count + " oranges";
          }
          // Bread / toast (not breadcrumbs or bread-based dishes)
          if ((n.includes("bread") || n.includes("toast")) && !n.includes("breadcrumb") && !n.includes("cornbread")) {
            const slices = Math.max(1, Math.round(grams / 32));
            return slices === 1 ? "1 slice" : slices + " slices";
          }
          // Tortilla / wrap
          if (n.includes("tortilla") || (n.includes("wrap") && !n.includes("saran") && !n.includes("plastic"))) {
            const count = Math.max(1, Math.round(grams / 45));
            return count === 1 ? "1 tortilla" : count + " tortillas";
          }
          // Rice cakes
          if (n.includes("rice cake")) {
            const count = Math.max(1, Math.round(grams / 9));
            return count === 1 ? "1 rice cake" : count + " rice cakes";
          }
          // Nut butters
          if (n.includes("peanut butter") || n.includes("almond butter") || n.includes("cashew butter") || n.includes("nut butter")) {
            const tbsp = Math.max(1, Math.round(grams / 16));
            return tbsp === 1 ? "1 tbsp" : tbsp + " tbsp";
          }
          // Oils
          if (n.includes("olive oil") || n.includes("coconut oil") || n.includes("avocado oil") || n.includes("vegetable oil")) {
            const tsp = Math.round(grams / 4.5);
            if (tsp <= 3) return tsp <= 1 ? "1 tsp" : tsp + " tsp";
            const tbsp = Math.max(1, Math.round(grams / 14));
            return tbsp === 1 ? "1 tbsp" : tbsp + " tbsp";
          }

          // Everything else stays in grams (chicken, rice, oats, fish, veggies, etc.)
          return Math.round(grams) + "g";
        }

        plan.days.forEach(function(day) {
          Object.values(day.meals || {}).forEach(function(items) {
            (items || []).forEach(function(item) {
              const grams = parseFloat(String(item.amount).replace(/[^0-9.]/g, "")) || 0;
              if (grams > 0) item.amount = humanizeAmount(item.food, grams);
            });
          });
        });

        if (tier === "pro" && deviceId) await incrementWeeklyUsage(env, deviceId, "mealplan");
        return jsonRes(plan, 200, cors);

      } catch (e) {
        return jsonRes({ error: "Could not generate plan: " + e.message }, 500, cors);
      }
    }

    // ── COACH REPORT ──────────────────────────────────────────────────────
    if (type === "coach_report") {
      const { context, prompt, coachMode, deviceId, email } = body;
      if (!context) return jsonRes({ error: "Missing context" }, 400, cors);
      const tier = await getSubscriptionTier(env, deviceId || "", email || "");
      if (tier === "free") return jsonRes({ error: "pro_required" }, 403, cors);
      const model = tier === "max" ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001";
      const system = getCoachSystem(coachMode);
      const result = await callClaude(env.ANTHROPIC_API_KEY, system,
        [{ role: "user", content: "My data:\n\n" + context + "\n\n" + (prompt || "Write a weekly check-in as 3-4 bullet points. Cover weight trend vs goal, calorie adherence, protein consistency, and one actionable focus for next week. Start each with an emoji.") }],
        600, model
      );
      if (result.error) return jsonRes({ error: result.error }, 502, cors);
      return jsonRes({ text: result.text }, 200, cors);
    }

    // ── COACH CHAT ────────────────────────────────────────────────────────
    if (type === "coach_chat") {
      const { context, messages, coachMode, deviceId, email } = body;
      if (!context || !messages) return jsonRes({ error: "Missing context or messages" }, 400, cors);
      const tier = await getSubscriptionTier(env, deviceId || "", email || "");
      if (tier === "free") return jsonRes({ error: "pro_required" }, 403, cors);
      if (tier === "pro") {
        const usage = await getDailyUsage(env, deviceId, "coach");
        if (usage >= 20) return jsonRes({ error: "daily_limit_reached", limit: 20, used: usage }, 429, cors);
      }
      const model = tier === "max" ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001";
      const system = getCoachSystem(coachMode);
      const claudeMessages = [
        { role: "user", content: "My current data:\n\n" + context },
        { role: "assistant", content: "Got it, I have your full data. What do you want to know?" },
      ].concat(messages);
      const result = await callClaude(env.ANTHROPIC_API_KEY, system, claudeMessages, 800, model);
      if (result.error) return jsonRes({ error: result.error }, 502, cors);
      if (tier === "pro") await incrementDailyUsage(env, deviceId, "coach");
      return jsonRes({ text: result.text }, 200, cors);
    }

    // ── WAITLIST: Status check ───────────────────────────────────────────
    if (type === "waitlist_status") {
      const { email } = body;
      if (!email) return jsonRes({ found: false }, 200, cors);

      const result = await sb(env, "GET", "waitlist?email=eq." + encodeURIComponent(email.toLowerCase().trim()) + "&limit=1");
      if (!result.data || result.data.length === 0) {
        return jsonRes({ found: false }, 200, cors);
      }

      const entry = result.data[0];
      const response = { found: true, status: entry.status };
      if (entry.status === "approved") {
        response.appUrl = "https://macrotrack.live/app.html";
      }
      return jsonRes(response, 200, cors);
    }

    // ── WAITLIST: Join ───────────────────────────────────────────────────
    if (type === "waitlist_join") {
      const { name, email, reason } = body;
      if (!name || !email) return jsonRes({ error: "Missing name or email" }, 400, cors);

      const existing = await sb(env, "GET", "waitlist?email=eq." + encodeURIComponent(email) + "&limit=1");
      if (existing.data && existing.data.length > 0) {
        return jsonRes({ error: "already_exists" }, 200, cors);
      }

      const result = await sb(env, "POST", "waitlist", {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        reason: reason || null,
        status: "pending",
      });

      if (!result.ok) return jsonRes({ error: "Failed to save" }, 500, cors);
      return jsonRes({ ok: true }, 200, cors);
    }

    // ── ADMIN: Lookup user ───────────────────────────────────────────────
    if (type === "admin_lookup_user") {
      const { query, adminKey } = body;
      if (adminKey !== "MACROTRACK_ADMIN_2026") return jsonRes({ error: "Unauthorized" }, 401, cors);
      if (!query) return jsonRes({ ok: false }, 400, cors);
      const isEmail = query.includes("@");
      const path = isEmail
        ? "profiles?email=eq." + encodeURIComponent(query.toLowerCase().trim()) + "&limit=1"
        : "profiles?device_id=eq." + encodeURIComponent(query.trim()) + "&limit=1";
      const r = await sb(env, "GET", path);
      if (!r.data || r.data.length === 0) return jsonRes({ ok: false }, 200, cors);
      return jsonRes({ ok: true, user: r.data[0] }, 200, cors);
    }

    // ── ADMIN: Set subscription ──────────────────────────────────────────
    if (type === "admin_set_subscription") {
      const { deviceId, status, adminKey } = body;
      if (adminKey !== "MACROTRACK_ADMIN_2026") return jsonRes({ error: "Unauthorized" }, 401, cors);
      if (!deviceId || !["free","pro","max"].includes(status)) return jsonRes({ error: "Invalid" }, 400, cors);
      const r = await sb(env, "PATCH", "profiles?device_id=eq." + encodeURIComponent(deviceId), {
        subscription_status: status,
      });
      if (!r.ok) return jsonRes({ error: "Failed to update" }, 500, cors);
      return jsonRes({ ok: true }, 200, cors);
    }

    // ── ADMIN: List all subscribers ──────────────────────────────────────
    if (type === "admin_list_subscribers") {
      const { adminKey } = body;
      if (adminKey !== "MACROTRACK_ADMIN_2026") return jsonRes({ error: "Unauthorized" }, 401, cors);
      const r = await sb(env, "GET", "profiles?order=subscription_status.desc,updated_at.desc&limit=500");
      return jsonRes({ ok: true, users: r.data || [] }, 200, cors);
    }

    // ── WAITLIST: List (admin) ────────────────────────────────────────────
    if (type === "waitlist_list") {
      const { adminKey } = body;
      if (adminKey !== "MACROTRACK_ADMIN_2026") return jsonRes({ error: "Unauthorized" }, 401, cors);

      const result = await sb(env, "GET", "waitlist?order=created_at.desc&limit=500");
      if (!result.ok) return jsonRes({ error: "Failed to load" }, 500, cors);
      return jsonRes({ waitlist: result.data || [] }, 200, cors);
    }

    // ── WAITLIST: Approve ─────────────────────────────────────────────────
    if (type === "waitlist_approve") {
      const { id, email, name, adminKey } = body;
      if (adminKey !== "MACROTRACK_ADMIN_2026") return jsonRes({ error: "Unauthorized" }, 401, cors);
      if (!id || !email || !name) return jsonRes({ error: "Missing data" }, 400, cors);

      const code = name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6) +
        Math.random().toString(36).slice(2, 6).toUpperCase();

      await env.CODES.put(code, JSON.stringify({
        name: name, used: false, email: email, createdAt: new Date().toISOString(),
      }));

      await sb(env, "PATCH", "waitlist?id=eq." + encodeURIComponent(id), {
        status: "approved", invite_code: code, approved_at: new Date().toISOString(),
      });

      if (env.RESEND_API_KEY) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + env.RESEND_API_KEY },
          body: JSON.stringify({
            from: "MacroTrack <noreply@macrotrack.live>",
            to: [email],
            subject: "Your MacroTrack invite is here 🎉",
            html: `<div style="font-family:'DM Sans',Arial,sans-serif;max-width:520px;margin:0 auto;background:#08080f;color:#f0f0fa;padding:40px 32px;border-radius:16px;"><div style="font-family:Georgia,serif;font-size:28px;letter-spacing:4px;margin-bottom:6px;">MACRO<span style="color:#6366f1;">TRACK</span></div><div style="font-size:11px;color:#5a5a7a;letter-spacing:2px;text-transform:uppercase;margin-bottom:32px;">Private Beta</div><p style="font-size:16px;line-height:1.7;color:#a0a0c0;margin-bottom:24px;">Hey ${name}, your application was approved. You're in. 🎉</p><div style="background:#0d0d1a;border:1px solid rgba(99,102,241,0.3);border-radius:14px;padding:24px;text-align:center;margin-bottom:28px;"><div style="font-size:12px;color:#5a5a7a;text-transform:uppercase;letter-spacing:2px;margin-bottom:12px;">Your Invite Code</div><div style="font-family:'Courier New',monospace;font-size:32px;font-weight:700;letter-spacing:6px;color:#6366f1;">${code}</div><div style="font-size:12px;color:#5a5a7a;margin-top:10px;">Single use — this code is just for you</div></div><a href="https://macrotrack.live/app.html" style="display:block;text-align:center;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;padding:16px;border-radius:12px;font-size:16px;font-weight:600;letter-spacing:1px;margin-bottom:24px;">Open MacroTrack →</a><p style="font-size:12px;color:#5a5a7a;text-align:center;">MacroTrack Private Beta</p></div>`,
          }),
        });
      }

      return jsonRes({ ok: true, code }, 200, cors);
    }

    // ── WAITLIST: Deny ────────────────────────────────────────────────────
    if (type === "waitlist_deny") {
      const { id, adminKey } = body;
      if (adminKey !== "MACROTRACK_ADMIN_2026") return jsonRes({ error: "Unauthorized" }, 401, cors);
      await sb(env, "PATCH", "waitlist?id=eq." + encodeURIComponent(id), { status: "denied" });
      return jsonRes({ ok: true }, 200, cors);
    }

    // ── WAITLIST: Revoke ──────────────────────────────────────────────────
    if (type === "waitlist_revoke") {
      const { id, code, adminKey } = body;
      if (adminKey !== "MACROTRACK_ADMIN_2026") return jsonRes({ error: "Unauthorized" }, 401, cors);

      if (code) {
        const stored = await env.CODES.get(code);
        if (stored) {
          const data = JSON.parse(stored);
          data.revoked = true;
          await env.CODES.put(code, JSON.stringify(data));
        }
      }

      await sb(env, "PATCH", "waitlist?id=eq." + encodeURIComponent(id), { status: "denied" });
      return jsonRes({ ok: true }, 200, cors);
    }

    // ── PUSH: Subscribe ───────────────────────────────────────────────────
    if (type === "push_subscribe") {
      const { deviceId, email, subscription, preferences } = body;
      if (!deviceId || !subscription || !subscription.endpoint) {
        return jsonRes({ error: "Missing subscription data" }, 400, cors);
      }
      // Resolve canonical device_id — same email-based pattern as sync_add_entry.
      // This ensures push notifications look up food entries under the right device_id.
      let resolvedDeviceId = deviceId;
      const profileCheck = await sbAdmin(env, "GET", "profiles?device_id=eq." + encodeURIComponent(deviceId) + "&limit=1");
      if ((!profileCheck.data || profileCheck.data.length === 0) && email) {
        const emailClean = email.trim().toLowerCase();
        const byEmail = await sbAdmin(env, "GET", "profiles?email=eq." + encodeURIComponent(emailClean) + "&limit=1");
        if (byEmail.data && byEmail.data.length > 0) {
          resolvedDeviceId = byEmail.data[0].device_id;
        }
      }
      const keys = subscription.keys || {};
      const result = await sbAdmin(env, "POST", "push_subscriptions", {
        device_id: resolvedDeviceId,
        endpoint: subscription.endpoint,
        p256dh: keys.p256dh || "",
        auth: keys.auth || "",
        notify_report: preferences?.report !== false,
        notify_correction: preferences?.correction !== false,
        notify_reminder: preferences?.reminder !== false,
        reminder_hour: preferences?.reminderHour || 12,
        updated_at: new Date().toISOString(),
      });
      if (!result.ok) return jsonRes({ error: "Failed to save subscription" }, 500, cors);
      return jsonRes({ ok: true }, 200, cors);
    }

    // ── PUSH: Subscribe (native iOS APNs) ────────────────────────────────
    if (type === "push_subscribe_apns") {
      const { deviceId, email, apnsToken, preferences } = body;
      if (!deviceId || !apnsToken) {
        return jsonRes({ error: "Missing deviceId or apnsToken" }, 400, cors);
      }
      let resolvedDeviceId = deviceId;
      const profileCheck = await sbAdmin(env, "GET", "profiles?device_id=eq." + encodeURIComponent(deviceId) + "&limit=1");
      if ((!profileCheck.data || profileCheck.data.length === 0) && email) {
        const emailClean = email.trim().toLowerCase();
        const byEmail = await sbAdmin(env, "GET", "profiles?email=eq." + encodeURIComponent(emailClean) + "&limit=1");
        if (byEmail.data && byEmail.data.length > 0) {
          resolvedDeviceId = byEmail.data[0].device_id;
        }
      }
      const result = await sbAdmin(env, "POST", "push_subscriptions", {
        device_id: resolvedDeviceId,
        endpoint: "apns://" + apnsToken,
        p256dh: "",
        auth: "",
        notify_report: preferences?.report !== false,
        notify_correction: preferences?.correction !== false,
        notify_reminder: preferences?.reminder !== false,
        reminder_hour: preferences?.reminderHour || 12,
        updated_at: new Date().toISOString(),
      });
      if (!result.ok) return jsonRes({ error: "Failed to save APNs subscription" }, 500, cors);
      return jsonRes({ ok: true }, 200, cors);
    }

    // ── PUSH: Update preferences ──────────────────────────────────────────
    if (type === "push_update_prefs") {
      const { deviceId, preferences } = body;
      if (!deviceId) return jsonRes({ error: "Missing deviceId" }, 400, cors);
      const updates = { updated_at: new Date().toISOString() };
      if (preferences.report !== undefined) updates.notify_report = preferences.report;
      if (preferences.correction !== undefined) updates.notify_correction = preferences.correction;
      if (preferences.reminder !== undefined) updates.notify_reminder = preferences.reminder;
      if (preferences.reminderHour !== undefined) updates.reminder_hour = preferences.reminderHour;
      const result = await sb(env, "PATCH",
        "push_subscriptions?device_id=eq." + encodeURIComponent(deviceId), updates);
      if (!result.ok) return jsonRes({ error: "Failed to update" }, 500, cors);
      return jsonRes({ ok: true }, 200, cors);
    }

    // ── PUSH: Unsubscribe ─────────────────────────────────────────────────
    if (type === "push_unsubscribe") {
      const { deviceId } = body;
      if (!deviceId) return jsonRes({ error: "Missing deviceId" }, 400, cors);
      await sb(env, "DELETE",
        "push_subscriptions?device_id=eq." + encodeURIComponent(deviceId));
      return jsonRes({ ok: true }, 200, cors);
    }


    // ── NATURAL LANGUAGE FOOD ENTRY ───────────────────────────────────────
    if (type === "nlp_food") {
      const { text } = body;
      if (!text || !text.trim()) return jsonRes({ error: "Missing text" }, 400, cors);

      const nlpPrompt = `Parse this food description into individual food items with accurate nutritional estimates.

Input: "${text.trim()}"

Return ONLY a valid JSON array. Each item must have:
- name: specific food name (e.g. "Grilled Chicken Breast" not just "chicken")
- serving: human-readable serving size (e.g. "6 oz", "1 cup", "1 medium")
- grams: estimated weight in grams
- cal: calories (integer)
- p: protein in grams (integer)
- c: carbs in grams (integer)
- f: fat in grams (integer)

Rules:
- If a brand is mentioned (e.g. "Fairlife"), use that brand's actual nutrition data
- If a restaurant is mentioned (e.g. "Five Guys"), use that restaurant's actual menu data
- Use realistic portion sizes for the context
- Round all numbers to integers
- Return ONLY the JSON array, no explanation, no markdown

Example input: "two eggs and a slice of toast with butter"
Example output: [{"name":"Large Eggs","serving":"2 large","grams":100,"cal":143,"p":13,"c":1,"f":10},{"name":"White Toast","serving":"1 slice","grams":30,"cal":79,"p":3,"c":15,"f":1},{"name":"Butter","serving":"1 pat","grams":5,"cal":36,"p":0,"c":0,"f":4}]`;

      const result = await callClaude(env.ANTHROPIC_API_KEY,
        "You are a nutrition database parser. Return ONLY valid JSON arrays. No markdown, no explanation, no text before or after the JSON. Be accurate with brand-name and restaurant nutrition data.",
        [{ role: "user", content: nlpPrompt }],
        800
      );

      if (result.error) return jsonRes({ error: result.error }, 502, cors);

      try {
        let jsonStr = result.text.replace(/```json|```/g, "").trim();
        const fb = jsonStr.indexOf("[");
        const lb = jsonStr.lastIndexOf("]");
        if (fb !== -1 && lb !== -1) jsonStr = jsonStr.slice(fb, lb + 1);
        const foods = JSON.parse(jsonStr);
        if (!Array.isArray(foods) || foods.length === 0) {
          return jsonRes({ error: "Could not parse any foods from that description" }, 400, cors);
        }
        return jsonRes({ foods: foods }, 200, cors);
      } catch (e) {
        return jsonRes({ error: "Failed to parse AI response" }, 500, cors);
      }
    }

    // ── ACCOUNT RECOVERY: Link email ─────────────────────────────────────
    if (type === "link_email") {
      const { deviceId, email } = body;
      if (!deviceId || !email) return jsonRes({ error: "Missing data" }, 400, cors);
      const emailClean = email.trim().toLowerCase();
      if (!emailClean.includes("@")) return jsonRes({ error: "Invalid email" }, 400, cors);

      // Check if this email is already linked to a different device
      const existing = await sb(env, "GET",
        "profiles?email=eq." + encodeURIComponent(emailClean) + "&limit=1");
      if (existing.data && existing.data.length > 0 &&
          existing.data[0].device_id !== deviceId) {
        return jsonRes({ error: "Email already linked to another account" }, 409, cors);
      }

      const result = await sb(env, "PATCH",
        "profiles?device_id=eq." + encodeURIComponent(deviceId), { email: emailClean });
      if (!result.ok) return jsonRes({ error: "Failed to save email" }, 500, cors);
      return jsonRes({ ok: true }, 200, cors);
    }

    // ── ACCOUNT RECOVERY: Request OTP ────────────────────────────────────
    if (type === "request_recovery") {
      const { email } = body;
      if (!email) return jsonRes({ error: "Missing email" }, 400, cors);
      const emailClean = email.trim().toLowerCase();

      const result = await sb(env, "GET",
        "profiles?email=eq." + encodeURIComponent(emailClean) + "&limit=1");
      if (!result.data || result.data.length === 0) {
        return jsonRes({ error: "No account found with that email" }, 404, cors);
      }

      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.CODES.put("recovery:" + emailClean, JSON.stringify({
        code, deviceId: result.data[0].device_id
      }), { expirationTtl: 900 });

      if (env.RESEND_API_KEY) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + env.RESEND_API_KEY },
          body: JSON.stringify({
            from: "MacroTrack <noreply@macrotrack.live>",
            to: [emailClean],
            subject: "Your MacroTrack recovery code",
            html: `<div style="font-family:'DM Sans',Arial,sans-serif;max-width:480px;margin:0 auto;background:#08080f;color:#f0f0fa;padding:40px 32px;border-radius:16px;"><div style="font-family:Georgia,serif;font-size:28px;letter-spacing:4px;margin-bottom:24px;">MACRO<span style="color:#6366f1;">TRACK</span></div><p style="font-size:16px;color:#a0a0c0;margin-bottom:24px;">Your account recovery code:</p><div style="background:#0d0d1a;border:1px solid rgba(99,102,241,0.3);border-radius:14px;padding:28px;text-align:center;margin-bottom:24px;"><div style="font-family:'Courier New',monospace;font-size:40px;font-weight:700;letter-spacing:10px;color:#6366f1;">${code}</div><div style="font-size:12px;color:#5a5a7a;margin-top:10px;">Expires in 15 minutes</div></div><p style="font-size:12px;color:#5a5a7a;">If you didn't request this, you can safely ignore this email.</p></div>`,
          }),
        });
      }
      return jsonRes({ ok: true }, 200, cors);
    }

    // ── ACCOUNT RECOVERY: Verify OTP + return full data snapshot ─────────
    if (type === "verify_recovery") {
      const { email, code } = body;
      if (!email || !code) return jsonRes({ error: "Missing data" }, 400, cors);
      const emailClean = email.trim().toLowerCase();

      const stored = await env.CODES.get("recovery:" + emailClean);
      if (!stored) return jsonRes({ error: "Code expired. Request a new one." }, 400, cors);
      let rec;
      try { rec = JSON.parse(stored); } catch (e) {
        return jsonRes({ error: "Invalid recovery data" }, 500, cors);
      }
      if (rec.code !== code.trim()) return jsonRes({ error: "Incorrect code — try again" }, 400, cors);

      await env.CODES.delete("recovery:" + emailClean); // one-time use
      const deviceId = rec.deviceId;

      const [profile, entries, wlog] = await Promise.all([
        sb(env, "GET", "profiles?device_id=eq." + encodeURIComponent(deviceId) + "&limit=1"),
        sb(env, "GET", "food_entries?device_id=eq." + encodeURIComponent(deviceId) + "&order=log_date.asc&limit=500"),
        sb(env, "GET", "weight_log?device_id=eq." + encodeURIComponent(deviceId) + "&order=log_date.asc&limit=200"),
      ]);

      return jsonRes({
        deviceId,
        profile: (profile.data && profile.data[0]) || null,
        entries: entries.data || [],
        wlog: wlog.data || [],
      }, 200, cors);
    }

    // ── AUTH OTP: Send 6-digit code via Resend (no Supabase email needed) ──
    if (type === "send_auth_otp") {
      const { email } = body;
      if (!email) return jsonRes({ error: "Missing email" }, 400, cors);
      const emailClean = email.trim().toLowerCase();
      if (!emailClean.includes("@")) return jsonRes({ error: "Invalid email" }, 400, cors);

      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.CODES.put("auth_otp:" + emailClean, JSON.stringify({
        code, createdAt: Date.now()
      }), { expirationTtl: 300 }); // 5 minutes

      if (!env.RESEND_API_KEY) return jsonRes({ error: "Email not configured" }, 500, cors);
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + env.RESEND_API_KEY },
        body: JSON.stringify({
          from: "MacroTrack <noreply@macrotrack.live>",
          to: [emailClean],
          subject: "Your MacroTrack sign-in code",
          html: `<div style="font-family:'DM Sans',Arial,sans-serif;max-width:480px;margin:0 auto;background:#08080f;color:#f0f0fa;padding:40px 32px;border-radius:16px;"><div style="font-family:Georgia,serif;font-size:28px;letter-spacing:4px;margin-bottom:24px;">MACRO<span style="color:#6366f1;">TRACK</span></div><p style="font-size:16px;color:#a0a0c0;margin-bottom:24px;">Your sign-in code:</p><div style="background:#0d0d1a;border:1px solid rgba(99,102,241,0.3);border-radius:14px;padding:28px;text-align:center;margin-bottom:24px;"><div style="font-family:'Courier New',monospace;font-size:40px;font-weight:700;letter-spacing:10px;color:#6366f1;">${code}</div><div style="font-size:12px;color:#5a5a7a;margin-top:10px;">Expires in 5 minutes</div></div><p style="font-size:12px;color:#5a5a7a;">If you didn't request this, you can safely ignore this email.</p></div>`,
        }),
      });
      if (!emailRes.ok) {
        const errText = await emailRes.text();
        return jsonRes({ error: "Failed to send email: " + errText }, 500, cors);
      }
      return jsonRes({ ok: true }, 200, cors);
    }

    // ── AUTH OTP: Verify code, link email to device, return cloud data ────
    if (type === "verify_auth_otp") {
      const { email, code, deviceId } = body;
      if (!email || !code || !deviceId) return jsonRes({ error: "Missing data" }, 400, cors);
      const emailClean = email.trim().toLowerCase();

      const stored = await env.CODES.get("auth_otp:" + emailClean);
      if (!stored) return jsonRes({ error: "Code expired — request a new one" }, 400, cors);
      let rec;
      try { rec = JSON.parse(stored); } catch(e) { return jsonRes({ error: "Invalid code data" }, 500, cors); }
      if (rec.code !== code.trim()) return jsonRes({ error: "Incorrect code — try again" }, 400, cors);
      // Don't delete the code yet — do the DB work first so that if the request
      // times out or the connection drops, the user can retry with the same code.

      // Check if this email is already linked to an existing account.
      // Use sbAdmin (service role key) to bypass RLS — we need to read another user's row.
      let existingDeviceId = null;

      const byEmail = await sbAdmin(env, "GET",
        "profiles?email=eq." + encodeURIComponent(emailClean) + "&limit=1");

      if (byEmail.data && byEmail.data.length > 0) {
        existingDeviceId = byEmail.data[0].device_id;
      } else if (env.SUPABASE_SERVICE_ROLE_KEY) {
        // Not found by email in profiles — user may have signed in with Google OAuth previously.
        // Look them up via Supabase auth admin API, then find their profile by auth UID.
        try {
          const authResp = await fetch(
            env.SUPABASE_URL + "/auth/v1/admin/users?page=1&per_page=1000",
            { headers: { "Authorization": "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY, "apikey": env.SUPABASE_SERVICE_ROLE_KEY } }
          );
          const authData = await authResp.json();
          const users = Array.isArray(authData.users) ? authData.users : [];
          const matched = users.find(u => u.email && u.email.toLowerCase() === emailClean);
          if (matched && matched.id) {
            const byUid = await sbAdmin(env, "GET", "profiles?device_id=eq." + encodeURIComponent(matched.id) + "&limit=1");
            if (byUid.data && byUid.data.length > 0) existingDeviceId = matched.id;
          }
        } catch(e) { /* fall through to new user path */ }
      }

      if (existingDeviceId) {
        // Returning user — load their data by existing device_id.
        // We return existingDeviceId to the client so it updates mt_device_id to match
        // what's already in Supabase. No row migration needed — avoids fire-and-forget
        // issues where Cloudflare drops unresolved promises after response is sent.
        const [profile, entries, wlog] = await Promise.all([
          sbAdmin(env, "GET", "profiles?device_id=eq." + encodeURIComponent(existingDeviceId) + "&limit=1"),
          sbAdmin(env, "GET", "food_entries?device_id=eq." + encodeURIComponent(existingDeviceId) + "&order=log_date.asc&limit=500"),
          sbAdmin(env, "GET", "weight_log?device_id=eq." + encodeURIComponent(existingDeviceId) + "&order=log_date.asc&limit=200"),
        ]);
        await env.CODES.delete("auth_otp:" + emailClean); // consumed — delete now
        return jsonRes({ ok: true, returning: true, existingDeviceId: existingDeviceId, profile: (profile.data && profile.data[0]) || null, entries: entries.data || [], wlog: wlog.data || [] }, 200, cors);
      }

      // New user — link email to their current device profile
      await sbAdmin(env, "PATCH", "profiles?device_id=eq." + encodeURIComponent(deviceId), { email: emailClean });
      await env.CODES.delete("auth_otp:" + emailClean); // consumed — delete now
      return jsonRes({ ok: true, returning: false }, 200, cors);
    }

    // ── AUTH MIGRATE: move all rows from anonymous device_id to auth UID ─
    if (type === "auth_migrate") {
      const { oldDeviceId, newUserId, email } = body;
      if (!oldDeviceId || !newUserId) return jsonRes({ error: "Missing data" }, 400, cors);
      if (oldDeviceId === newUserId) return jsonRes({ ok: true, noop: true }, 200, cors);

      // Check the old device actually has data before migrating
      const profileCheck = await sb(env, "GET",
        "profiles?device_id=eq." + encodeURIComponent(oldDeviceId) + "&limit=1");
      if (!profileCheck.data || profileCheck.data.length === 0) {
        // No old profile to migrate. If we have the newUserId profile, make sure email is stored.
        if (email) {
          await sbAdmin(env, "PATCH", "profiles?device_id=eq." + encodeURIComponent(newUserId),
            { email: email.trim().toLowerCase() });
        }
        return jsonRes({ ok: true, noop: true }, 200, cors);
      }

      // Migrate all three tables and store email for future OTP sign-ins
      const profilePatch = { device_id: newUserId };
      if (email) profilePatch.email = email.trim().toLowerCase();
      await Promise.all([
        sbAdmin(env, "PATCH", "profiles?device_id=eq." + encodeURIComponent(oldDeviceId), profilePatch),
        sbAdmin(env, "PATCH", "food_entries?device_id=eq." + encodeURIComponent(oldDeviceId),
          { device_id: newUserId }),
        sbAdmin(env, "PATCH", "weight_log?device_id=eq." + encodeURIComponent(oldDeviceId),
          { device_id: newUserId }),
      ]);

      return jsonRes({ ok: true }, 200, cors);
    }

    // ── STRIPE: Create checkout session ──────────────────────────────────
    if (type === "create_checkout_session") {
      const { priceId, deviceId, email } = body;
      if (!priceId || !deviceId) return jsonRes({ error: "Missing priceId or deviceId" }, 400, cors);
      if (!env.STRIPE_SECRET_KEY) return jsonRes({ error: "Stripe not configured" }, 500, cors);

      const tier = STRIPE_MAX_PRICE_IDS.has(priceId) ? "max" : "pro";
      const isPro = STRIPE_PRO_PRICE_IDS.has(priceId);
      const appUrl = "https://macrotrack.live/app.html";

      const params = {
        "mode": "subscription",
        "payment_method_types[0]": "card",
        "line_items[0][price]": priceId,
        "line_items[0][quantity]": "1",
        "client_reference_id": deviceId,
        "success_url": appUrl + "?checkout=success",
        "cancel_url": appUrl,
        "metadata[device_id]": deviceId,
        "metadata[tier]": tier,
      };
      if (email) params.customer_email = email;
      if (isPro) params["subscription_data[trial_period_days]"] = "3";

      const result = await stripeApi(env.STRIPE_SECRET_KEY, "POST", "checkout/sessions", params);
      if (!result.ok) return jsonRes({ error: (result.data.error && result.data.error.message) || "Stripe error" }, 502, cors);
      return jsonRes({ url: result.data.url }, 200, cors);
    }

    // ── REVENUECAT: Sync tier after native IAP purchase ───────────────────
    if (type === "rc_sync") {
      const { deviceId, tier } = body;
      if (!deviceId || !tier) return jsonRes({ error: "Missing deviceId or tier" }, 400, cors);
      const allowed = ["free", "pro", "max"];
      if (!allowed.includes(tier)) return jsonRes({ error: "Invalid tier" }, 400, cors);
      await sbAdmin(env, "PATCH", "profiles?device_id=eq." + encodeURIComponent(deviceId), {
        subscription_status: tier,
      });
      return jsonRes({ ok: true }, 200, cors);
    }

    // ── STRIPE: Get subscription status ──────────────────────────────────
    if (type === "get_subscription") {
      const { deviceId, email } = body;
      if (!deviceId) return jsonRes({ error: "Missing deviceId" }, 400, cors);
      const tier = await getSubscriptionTier(env, deviceId, email || "");
      return jsonRes({ subscription_status: tier }, 200, cors);
    }

    // ── NATURAL LANGUAGE WORKOUT ENTRY ───────────────────────────────────
    if (type === "nlp_workout") {
      const { text } = body;
      if (!text || !text.trim()) return jsonRes({ error: "Missing text" }, 400, cors);

      const workoutPrompt = `Parse this workout description into individual exercises.

Input: "${text.trim()}"

Return ONLY a valid JSON array. Each item must have:
- name: exercise name (e.g. "Flat Bench Press", "Lateral Raises", "Running")
- sets: number of sets as integer (or null if not applicable)
- reps: reps per set as string (e.g. "5", "8-12", or null)
- weight: weight as string (e.g. "225 lbs", "60 lb DBs", "bodyweight", or null)
- type: one of "strength", "cardio", "bodyweight"
- duration: duration in minutes as integer (or null)
- distance: distance as string (e.g. "3 miles", or null)
- notes: any extra detail (or null)

Rules:
- Parse every exercise mentioned, including warmups if specified
- If user writes "3x5" that means 3 sets of 5 reps
- If user writes "60s" or "60 lb dumbbells" that means 60 lb dumbbells
- Round numeric values to integers
- Return ONLY the JSON array, no explanation, no markdown

Example input: "flat bench 225 3x5, incline DB 60s 3x10, lateral raises 20s 3x15, 20 min treadmill"
Example output: [{"name":"Flat Bench Press","sets":3,"reps":"5","weight":"225 lbs","type":"strength","duration":null,"distance":null,"notes":null},{"name":"Incline Dumbbell Press","sets":3,"reps":"10","weight":"60 lb DBs","type":"strength","duration":null,"distance":null,"notes":null},{"name":"Lateral Raises","sets":3,"reps":"15","weight":"20 lb DBs","type":"strength","duration":null,"distance":null,"notes":null},{"name":"Treadmill","sets":null,"reps":null,"weight":null,"type":"cardio","duration":20,"distance":null,"notes":null}]`;

      const result = await callClaude(env.ANTHROPIC_API_KEY,
        "You are a fitness tracking parser. Return ONLY valid JSON arrays. No markdown, no explanation. Be precise about sets, reps, and weights exactly as described.",
        [{ role: "user", content: workoutPrompt }],
        800
      );

      if (result.error) return jsonRes({ error: result.error }, 502, cors);

      try {
        let jsonStr = result.text.replace(/```json|```/g, "").trim();
        const fb = jsonStr.indexOf("[");
        const lb = jsonStr.lastIndexOf("]");
        if (fb !== -1 && lb !== -1) jsonStr = jsonStr.slice(fb, lb + 1);
        const exercises = JSON.parse(jsonStr);
        if (!Array.isArray(exercises) || exercises.length === 0) {
          return jsonRes({ error: "Could not parse any exercises from that description" }, 400, cors);
        }
        return jsonRes({ exercises: exercises }, 200, cors);
      } catch (e) {
        return jsonRes({ error: "Failed to parse AI response" }, 500, cors);
      }
    }

    return jsonRes({ error: "Unknown request type: " + type }, 400, cors);
  },
};