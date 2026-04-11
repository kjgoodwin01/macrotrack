var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-NnmnGB/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// worker.js
var ALLOWED_ORIGINS = [
  "https://kjgoodwin01.github.io",
  "http://localhost",
  "http://127.0.0.1"
];
function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.some((o) => origin.startsWith(o));
  return {
    "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
__name(corsHeaders, "corsHeaders");
function jsonRes(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}
__name(jsonRes, "jsonRes");
async function sb(env, method, path, body) {
  const prefer = method === "POST" ? "resolution=merge-duplicates,return=representation" : method === "PATCH" ? "return=representation" : "return=representation";
  const res = await fetch(env.SUPABASE_URL + "/rest/v1/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "apikey": env.SUPABASE_ANON_KEY,
      "Authorization": "Bearer " + env.SUPABASE_ANON_KEY,
      "Prefer": prefer
    },
    body: body ? JSON.stringify(body) : void 0
  });
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch (e) {
    return { ok: res.ok, status: res.status, data: text };
  }
}
__name(sb, "sb");
async function callClaude(apiKey, system, messages, maxTokens) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: maxTokens || 800,
        system,
        messages
      })
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error?.message || "Anthropic error" };
    const text = (data.content || []).find((b) => b.type === "text")?.text || "";
    return { text };
  } catch (e) {
    return { error: "Failed to reach Anthropic API" };
  }
}
__name(callClaude, "callClaude");
async function sendWebPush(endpoint, p256dhKey, authKey, payload, vapidPublicKey, vapidPrivateKey, vapidSubject) {
  try {
    const vapidHeader = await createVapidAuth(endpoint, vapidPublicKey, vapidPrivateKey, vapidSubject);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": vapidHeader,
        "Content-Type": "application/json",
        "TTL": "86400",
        "Urgency": "normal"
      },
      body: payload
    });
    return { ok: response.ok, status: response.status };
  } catch (e) {
    console.log("[sendWebPush] THREW:", e.message, e.stack);
    return { ok: false, status: 0, error: e.message };
  }
}
__name(sendWebPush, "sendWebPush");
async function createVapidAuth(endpoint, publicKey, privateKey, subject) {
  const urlObj = new URL(endpoint);
  const audience = urlObj.protocol + "//" + urlObj.host;
  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1e3);
  const payload = { aud: audience, exp: now + 86400, sub: subject };
  function toBase64Url(str) {
    return btoa(str).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  }
  __name(toBase64Url, "toBase64Url");
  const headerB64 = toBase64Url(JSON.stringify(header));
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const unsigned = headerB64 + "." + payloadB64;
  const rawKey = Uint8Array.from(atob(privateKey.replace(/-/g, "+").replace(/_/g, "/")), function(c) {
    return c.charCodeAt(0);
  });
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    new TextEncoder().encode(unsigned)
  );
  const sigBytes = new Uint8Array(signatureBuffer);
  let sigStr = "";
  for (let i = 0; i < sigBytes.length; i++) sigStr += String.fromCharCode(sigBytes[i]);
  const sigB64 = toBase64Url(sigStr);
  const jwt = unsigned + "." + sigB64;
  return "vapid t=" + jwt + ", k=" + publicKey;
}
__name(createVapidAuth, "createVapidAuth");
function getCoachSystem(mode) {
  const base = `You are a personal nutrition and fitness coach inside MacroTrack \u2014 a chat-based mobile app. You have the user's complete data: goal, targets, food logs, weight history, adherence patterns.

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
- Use plain numbers inline naturally: "You need 38g more protein \u2014 a 6oz chicken breast covers that."
- Sound like a real person texting, not a document or a report.

Always reference their actual numbers. Suggest specific foods with specific portions. Never repeat the same advice twice.`;
  if (mode === "tough") {
    return base + `

PERSONALITY: TOUGH LOVE. Brutally honest, no sugarcoating. If they ate like crap, say it. Hold them accountable with blunt language. Challenge excuses. Push hard. You care, but you show it through honesty, not comfort.`;
  }
  if (mode === "supportive") {
    return base + `

PERSONALITY: SUPPORTIVE. Lead with what they did well. Celebrate consistency and small wins. Frame setbacks as learning opportunities. Warm, positive language. When giving corrections, be gentle and solution-focused.`;
  }
  return base + `

PERSONALITY: BALANCED. Direct but fair. Mix accountability with encouragement. Conversational tone like a text from a coach who respects you. Not harsh, not soft \u2014 just real.`;
}
__name(getCoachSystem, "getCoachSystem");
var worker_default = {
  // ── Cron handler for scheduled push notifications ───────────────────
  async scheduled(event, env, ctx) {
    console.log("[scheduled] handler entered. cron:", event.cron, "scheduledTime:", event.scheduledTime);
    const now = /* @__PURE__ */ new Date();
    const hour = now.getUTCHours();
    const day = now.getUTCDay();
    const estOffset = -4;
    const estNow = new Date(now.getTime() + estOffset * 60 * 60 * 1e3);
    const todayISO = estNow.toISOString().slice(0, 10);
    console.log("[scheduled] now UTC:", now.toISOString(), "hour:", hour, "day:", day, "todayISO:", todayISO);
    async function sendPush(sub, title, bodyText) {
      console.log("[sendPush] called for sub.id:", sub.id, "sub.device_id:", sub.device_id, "title:", title);
      if (!sub.endpoint) {
        console.log("[sendPush] SKIPPED \u2014 sub.endpoint is undefined for sub.id:", sub.id);
        return;
      }
      try {
        const pushPayload = JSON.stringify({
          title,
          body: bodyText,
          url: "https://kjgoodwin01.github.io/macrotrack/",
          icon: "https://kjgoodwin01.github.io/macrotrack/icon-192.png"
        });
        console.log("[sendPush] calling sendWebPush for sub.id:", sub.id);
        const result = await sendWebPush(
          sub.endpoint,
          sub.p256dh,
          sub.auth,
          pushPayload,
          env.VAPID_PUBLIC_KEY,
          env.VAPID_PRIVATE_KEY,
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
    __name(sendPush, "sendPush");
    console.log("[scheduled] checking weekly report block: day === 0 && hour === 14 \u2192", day === 0 && hour === 14);
    if (day === 0 && hour === 14) {
      const subs = await sb(env, "GET", "push_subscriptions?notify_report=eq.true&limit=5000");
      console.log("[scheduled] weekly report subs count:", (subs.data || []).length, "subs.ok:", subs.ok);
      for (const sub of subs.data || []) {
        console.log("[scheduled] sending weekly report push to sub.id:", sub.id);
        await sendPush(sub, "Weekly Check-in Ready \u{1F4CA}", "Your coaching report is ready. See how your week went.");
      }
    }
    console.log("[scheduled] checking daily reminder block: hour === 16 \u2192", hour === 16);
    if (hour === 16) {
      const subs = await sb(env, "GET", "push_subscriptions?notify_reminder=eq.true&limit=5000");
      console.log("[scheduled] daily reminder subs count:", (subs.data || []).length, "subs.ok:", subs.ok);
      if (subs.data && subs.data.length > 0) {
        for (const sub of subs.data) {
          try {
            if (!sub.device_id) {
              console.log("[scheduled] daily reminder \u2014 sub.device_id is undefined for sub.id:", sub.id, "SKIPPING");
              continue;
            }
            const entries = await sb(
              env,
              "GET",
              "food_entries?device_id=eq." + encodeURIComponent(sub.device_id) + "&log_date=eq." + todayISO + "&limit=1"
            );
            const hasLogged = entries.data && entries.data.length > 0;
            console.log("[scheduled] daily reminder sub.id:", sub.id, "hasLogged:", hasLogged);
            if (!hasLogged) {
              console.log("[scheduled] sending daily reminder push to sub.id:", sub.id);
              await sendPush(sub, "Don't Forget to Log \u{1F4AA}", "You haven't logged any food today. Stay on track.");
            }
          } catch (e) {
            console.log("[scheduled] daily reminder ERROR for sub.id:", sub.id, e.message);
          }
        }
      }
    }
    console.log("[scheduled] checking protein gap block: hour === 21 \u2192", hour === 21);
    if (hour === 21) {
      const PROTEIN_GOAL = 200;
      const subs = await sb(env, "GET", "push_subscriptions?notify_correction=eq.true&limit=5000");
      console.log("[scheduled] protein gap subs count:", (subs.data || []).length, "subs.ok:", subs.ok);
      if (subs.data && subs.data.length > 0) {
        for (const sub of subs.data) {
          try {
            if (!sub.device_id) {
              console.log("[scheduled] protein gap \u2014 sub.device_id is undefined for sub.id:", sub.id, "SKIPPING");
              continue;
            }
            const entries = await sb(
              env,
              "GET",
              "food_entries?device_id=eq." + encodeURIComponent(sub.device_id) + "&log_date=eq." + todayISO + "&limit=200"
            );
            if (!entries.data || entries.data.length === 0) continue;
            const proteinLogged = Math.round(entries.data.reduce(function(sum, e) {
              return sum + (parseFloat(e.protein) || 0);
            }, 0));
            const gap = PROTEIN_GOAL - proteinLogged;
            console.log("[scheduled] protein gap sub.id:", sub.id, "proteinLogged:", proteinLogged, "gap:", gap);
            if (gap > 0) {
              const msg = "You've had " + proteinLogged + "g of protein today. You still need " + gap + "g to hit your 200g goal!";
              console.log("[scheduled] sending protein gap push to sub.id:", sub.id);
              await sendPush(sub, "Protein Gap Alert \u{1F3AF}", msg);
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
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonRes({ error: "Invalid JSON" }, 400, cors);
    }
    const { type } = body;
    if (type === "validate_code") {
      const { code, deviceId } = body;
      if (!code || !deviceId) return jsonRes({ error: "Missing code or deviceId" }, 400, cors);
      const stored = await env.CODES.get(code.toUpperCase().trim());
      if (!stored) return jsonRes({ valid: false, reason: "Invalid code" }, 200, cors);
      let codeData;
      try {
        codeData = JSON.parse(stored);
      } catch (e) {
        return jsonRes({ valid: false, reason: "Invalid code" }, 200, cors);
      }
      if (codeData.used && codeData.deviceId !== deviceId) {
        return jsonRes({ valid: false, reason: "Code already used" }, 200, cors);
      }
      if (codeData.revoked) {
        return jsonRes({ valid: false, reason: "Access revoked" }, 200, cors);
      }
      codeData.used = true;
      codeData.deviceId = deviceId;
      codeData.usedAt = (/* @__PURE__ */ new Date()).toISOString();
      await env.CODES.put(code.toUpperCase().trim(), JSON.stringify(codeData));
      return jsonRes({ valid: true, name: codeData.name || "" }, 200, cors);
    }
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
        } catch (e) {
        }
      }
      return jsonRes({ allowed: false, reason: "No valid access code" }, 200, cors);
    }
    if (type === "sync_load") {
      const { deviceId } = body;
      if (!deviceId) return jsonRes({ error: "Missing deviceId" }, 400, cors);
      const [profile, entries, wlog] = await Promise.all([
        sb(env, "GET", "profiles?device_id=eq." + encodeURIComponent(deviceId) + "&limit=1"),
        sb(env, "GET", "food_entries?device_id=eq." + encodeURIComponent(deviceId) + "&order=log_date.asc&limit=500"),
        sb(env, "GET", "weight_log?device_id=eq." + encodeURIComponent(deviceId) + "&order=log_date.asc&limit=200")
      ]);
      return jsonRes({
        profile: profile.data && profile.data[0] || null,
        entries: entries.data || [],
        wlog: wlog.data || []
      }, 200, cors);
    }
    if (type === "sync_profile") {
      const { deviceId, name, goalType, targetWeight, calories, protein, carbs, fat } = body;
      if (!deviceId) return jsonRes({ error: "Missing deviceId" }, 400, cors);
      if (!name || !name.trim()) return jsonRes({ error: "Name is required" }, 400, cors);
      const result = await sb(env, "POST", "profiles", {
        device_id: deviceId,
        name: name || "",
        goal_type: goalType || "cut",
        target_weight: targetWeight || null,
        calories: calories || 2100,
        protein: protein || 180,
        carbs: carbs || 210,
        fat: fat || 60,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      });
      if (!result.ok) return jsonRes({ error: "Failed to save profile" }, 500, cors);
      return jsonRes({ ok: true }, 200, cors);
    }
    if (type === "sync_add_entry") {
      const { deviceId, entry } = body;
      if (!deviceId || !entry) return jsonRes({ error: "Missing data" }, 400, cors);
      const profileCheck = await sb(env, "GET", "profiles?device_id=eq." + encodeURIComponent(deviceId) + "&limit=1");
      if (!profileCheck.data || profileCheck.data.length === 0) {
        return jsonRes({ error: "Profile not found \u2014 complete onboarding first" }, 403, cors);
      }
      const result = await sb(env, "POST", "food_entries", {
        device_id: deviceId,
        log_date: entry.date,
        meal: entry.meal,
        name: entry.name,
        serving: entry.serving || "",
        cal: entry.cal || 0,
        protein: entry.p || 0,
        carbs: entry.c || 0,
        fat: entry.f || 0
      });
      if (!result.ok) return jsonRes({ error: "Failed to save entry" }, 500, cors);
      const saved = result.data && result.data[0];
      return jsonRes({ ok: true, id: saved ? saved.id : null }, 200, cors);
    }
    if (type === "sync_update_entry") {
      const { entryId, entry } = body;
      if (!entryId || !entry) return jsonRes({ error: "Missing data" }, 400, cors);
      const result = await sb(
        env,
        "PATCH",
        "food_entries?id=eq." + encodeURIComponent(entryId),
        {
          cal: entry.cal || 0,
          protein: entry.p || 0,
          carbs: entry.c || 0,
          fat: entry.f || 0
        }
      );
      if (!result.ok) return jsonRes({ error: "Failed to update entry" }, 500, cors);
      return jsonRes({ ok: true }, 200, cors);
    }
    if (type === "sync_delete_entry") {
      const { deviceId, entryId } = body;
      if (!deviceId || !entryId) return jsonRes({ error: "Missing data" }, 400, cors);
      await sb(env, "DELETE", "food_entries?id=eq." + encodeURIComponent(entryId) + "&device_id=eq." + encodeURIComponent(deviceId));
      return jsonRes({ ok: true }, 200, cors);
    }
    if (type === "sync_log_weight") {
      const { deviceId, date, weight } = body;
      if (!deviceId || !date || !weight) return jsonRes({ error: "Missing data" }, 400, cors);
      const profileCheck = await sb(env, "GET", "profiles?device_id=eq." + encodeURIComponent(deviceId) + "&limit=1");
      if (!profileCheck.data || profileCheck.data.length === 0) {
        return jsonRes({ error: "Profile not found \u2014 complete onboarding first" }, 403, cors);
      }
      const result = await sb(env, "POST", "weight_log", {
        device_id: deviceId,
        log_date: date,
        weight
      });
      if (!result.ok) return jsonRes({ error: "Failed to save weight" }, 500, cors);
      return jsonRes({ ok: true }, 200, cors);
    }
    if (type === "usda_search") {
      const { query } = body;
      if (!query) return jsonRes({ error: "Missing query" }, 400, cors);
      const q = query.trim().toLowerCase();
      const qWords = q.split(/\s+/);
      const [usdaRaw, offRaw] = await Promise.all([
        fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(q)}&pageSize=50&api_key=${env.USDA_API_KEY}`).then((r) => r.ok ? r.json() : { foods: [] }).catch(() => ({ foods: [] })),
        fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=50&fields=product_name,brands,serving_size,serving_quantity,nutriments,code,unique_scans_n`, { headers: { "User-Agent": "MacroTrack App" } }).then((r) => r.ok ? r.json() : { products: [] }).catch(() => ({ products: [] }))
      ]);
      let combined = [];
      (offRaw.products || []).forEach((p) => {
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
            { nutrientId: 1004, value: n.fat_100g || 0 }
          ],
          servingSize: parseFloat(p.serving_quantity) || 100,
          servingSizeUnit: "g",
          source: "OFF",
          pop: parseInt(p.unique_scans_n) || 0
        });
      });
      (usdaRaw.foods || []).forEach((f) => {
        combined.push({ ...f, source: "USDA", pop: 0 });
      });
      const scored = combined.map((item) => {
        const desc = item.description.toLowerCase();
        const brand = (item.brandOwner || "").toLowerCase();
        let score = 0;
        if (item.source === "OFF") score += 1e4;
        if (desc.startsWith(q)) score += 2e4;
        const matchCount = qWords.filter((w) => desc.includes(w) || brand.includes(w)).length;
        score += matchCount * 5e3;
        score += item.pop * 20;
        if (brand.includes("llc") || brand.includes("inc") || brand.includes("operations")) score -= 5e3;
        if (item.dataType === "Survey (FNDDS)") score -= 8e3;
        return { ...item, _score: score };
      });
      scored.sort((a, b) => b._score - a._score);
      const seen = /* @__PURE__ */ new Set();
      const final = [];
      for (const item of scored) {
        const nameParts = item.description.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/);
        const key = `${(item.brandOwner || "").toLowerCase().slice(0, 8)}|${nameParts.slice(0, 2).join("")}`;
        if (!seen.has(key)) {
          seen.add(key);
          final.push(item);
        }
      }
      return jsonRes({ foods: final.slice(0, 25) }, 200, cors);
    }
    if (type === "barcode_lookup") {
      const { upc } = body;
      if (!upc) return jsonRes({ error: "Missing upc" }, 400, cors);
      try {
        const r = await fetch(
          "https://world.openfoodfacts.org/api/v0/product/" + upc + ".json",
          { headers: { "User-Agent": "MacroTrack App" } }
        );
        if (r.ok) {
          const d = await r.json();
          if (d.status === 1 && d.product) {
            const p = d.product;
            const n = p.nutriments || {};
            const servGrams = parseFloat(p.serving_quantity) || 100;
            return jsonRes({ foods: [{
              fdcId: "off-" + upc,
              description: p.product_name || "Unknown Product",
              brandOwner: p.brands || "",
              dataType: "Branded",
              gtinUpc: upc,
              foodNutrients: [
                { nutrientId: 1008, value: Math.round(n["energy-kcal_100g"] || 0) },
                { nutrientId: 1003, value: Math.round(n.proteins_100g || 0) },
                { nutrientId: 1005, value: Math.round(n.carbohydrates_100g || 0) },
                { nutrientId: 1004, value: Math.round(n.fat_100g || 0) }
              ],
              foodPortions: [{ portionDescription: p.serving_size || "1 serving", gramWeight: servGrams }],
              servingSize: servGrams,
              servingSizeUnit: "g"
            }] }, 200, cors);
          }
        }
      } catch (e) {
      }
      try {
        const params = new URLSearchParams({ query: upc, pageSize: "5", api_key: env.USDA_API_KEY });
        const r = await fetch("https://api.nal.usda.gov/fdc/v1/foods/search?" + params.toString());
        if (r.ok) {
          const d = await r.json();
          const foods = d.foods || [];
          const match = foods.find((f) => f.gtinUpc === upc) || foods[0];
          if (match) return jsonRes({ foods: [match] }, 200, cors);
        }
      } catch (e) {
      }
      return jsonRes({ foods: [] }, 200, cors);
    }
    if (type === "barcode_from_image") {
      const { imageBase64, mediaType } = body;
      if (!imageBase64) return jsonRes({ error: "Missing image" }, 400, cors);
      const result = await callClaude(
        env.ANTHROPIC_API_KEY,
        'You are a barcode reader. Find any barcode in the image. Return ONLY valid JSON: {"upc":"digits"} or {"upc":null}.',
        [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: imageBase64 } },
          { type: "text", text: "What is the barcode number? Return only JSON." }
        ] }],
        150
      );
      if (result.error) return jsonRes({ error: result.error }, 502, cors);
      try {
        return jsonRes(JSON.parse(result.text.replace(/```json|```/g, "").trim()), 200, cors);
      } catch (e) {
        return jsonRes({ upc: null }, 200, cors);
      }
    }
    if (type === "image_scan" || !type && body.imageBase64) {
      const { imageBase64, mediaType } = body;
      if (!imageBase64 || !mediaType) return jsonRes({ error: "Missing image data" }, 400, cors);
      const result = await callClaude(
        env.ANTHROPIC_API_KEY,
        'You are an expert sports nutritionist. Identify the specific dish by name (say Chicken Pot Pie not just chicken). Estimate portion. Use known nutritional data. Return ONLY valid JSON: {"name":"Dish Name","cal":0,"p":0,"c":0,"f":0,"confidence":"high/medium/low","note":"assumptions"}. All integers.',
        [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: "Identify this food and return nutrition JSON." }
        ] }],
        400
      );
      if (result.error) return jsonRes({ error: result.error }, 502, cors);
      try {
        return jsonRes(JSON.parse(result.text.replace(/```json|```/g, "").trim()), 200, cors);
      } catch (e) {
        return jsonRes({ error: "Could not parse nutrition data" }, 500, cors);
      }
    }
    if (type === "meal_plan") {
      const { days, calories, protein, carbs, fat, goalType, preferences, context } = body;
      if (!days || !calories) return jsonRes({ error: "Missing plan parameters" }, 400, cors);
      const prefText = preferences || "Use a variety of whole foods.";
      const contextText = context ? "\n\nUSER DATA:\n" + context : "";
      const jsonTemplate = '{"days":[{"day":"Day 1","totalCal":0,"totalProtein":0,"totalCarbs":0,"totalFat":0,"meals":{"Breakfast":[{"food":"name","amount":"Xg","cal":0,"p":0,"c":0,"f":0}],"Lunch":[],"Dinner":[],"Snack":[]}}]}';
      const userPrompt = "Create a " + days + "-day meal prep plan. Per day: " + calories + " kcal, " + protein + "g protein, " + carbs + "g carbs, " + fat + "g fat. Goal: " + goalType + ". Preferences: " + prefText + contextText + ". Every food item must have an exact gram weight (e.g. 180g, 85g). Use the user's recent food history to avoid repeating foods they've been eating. Scale recipe complexity to their cooking skill level. Each day within 50 kcal of target. Vary meals daily. All food amounts in grams only. Return ONLY JSON: " + jsonTemplate;
      try {
        let gramsToUS = function(grams, foodName) {
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
        }, categorize = function(name) {
          const n = name.toLowerCase();
          if (n.includes("chicken") || n.includes("beef") || n.includes("turkey") || n.includes("salmon") || n.includes("tuna") || n.includes("shrimp") || n.includes("tilapia") || n.includes("pork") || n.includes("steak") || n.includes("protein powder") || n.includes("greek yogurt") || n.includes("cottage cheese") || n.includes("tofu") || n.includes("tempeh") || n.includes("egg")) {
            return "Proteins";
          }
          if (n.includes("rice") || n.includes("oat") || n.includes("pasta") || n.includes("bread") || n.includes("quinoa") || n.includes("potato") || n.includes("sweet potato") || n.includes("tortilla") || n.includes("wrap") || n.includes("flour")) {
            return "Grains & Carbs";
          }
          if (n.includes("broccoli") || n.includes("spinach") || n.includes("kale") || n.includes("pepper") || n.includes("tomato") || n.includes("onion") || n.includes("garlic") || n.includes("zucchini") || n.includes("mushroom") || n.includes("carrot") || n.includes("celery") || n.includes("lettuce") || n.includes("cucumber") || n.includes("asparagus") || n.includes("green bean") || n.includes("banana") || n.includes("apple") || n.includes("berry") || n.includes("berries") || n.includes("orange") || n.includes("grape") || n.includes("cherry") || n.includes("mango") || n.includes("strawberry") || n.includes("blueberry") || n.includes("fruit")) {
            return "Fruits & Vegetables";
          }
          if (n.includes("milk") || n.includes("cheese") || n.includes("butter") || n.includes("cream") || n.includes("yogurt") || n.includes("egg")) {
            return "Dairy & Eggs";
          }
          return "Other";
        };
        __name(gramsToUS, "gramsToUS");
        __name(categorize, "categorize");
        const planRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 6e3,
            system: "You are a professional meal prep nutritionist. Return only valid JSON. No markdown, no explanation, no text before or after the JSON.",
            messages: [{ role: "user", content: userPrompt }]
          })
        });
        if (!planRes.ok) {
          const err = await planRes.json().catch(() => ({}));
          return jsonRes({ error: "AI error: " + (err.error?.message || planRes.status) }, 502, cors);
        }
        const planData = await planRes.json();
        const rawText = ((planData.content || []).find((b) => b.type === "text") || {}).text || "";
        let jsonStr = rawText.replace(/```json|```/g, "").trim();
        const firstBrace = jsonStr.indexOf("{");
        const lastBrace = jsonStr.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1) {
          jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
        }
        const plan = JSON.parse(jsonStr);
        if (!plan.days || !Array.isArray(plan.days)) {
          return jsonRes({ error: "Invalid plan structure \u2014 try again" }, 500, cors);
        }
        const totals = {};
        plan.days.forEach(function(day) {
          Object.values(day.meals || {}).forEach(function(items) {
            (items || []).forEach(function(item) {
              const name = item.food;
              const grams = parseFloat(String(item.amount).replace(/[^0-9.]/g, "")) || 0;
              if (name && grams > 0) {
                totals[name] = (totals[name] || 0) + grams;
              }
            });
          });
        });
        const shoppingList = { "Proteins": [], "Grains & Carbs": [], "Fruits & Vegetables": [], "Dairy & Eggs": [], "Other": [] };
        Object.keys(totals).forEach(function(foodName) {
          const totalGrams = totals[foodName];
          const withBuffer = totalGrams * 1.1;
          const qty = gramsToUS(withBuffer, foodName);
          const cat = categorize(foodName);
          shoppingList[cat].push({ item: foodName, qty });
        });
        Object.keys(shoppingList).forEach(function(k) {
          if (shoppingList[k].length === 0) delete shoppingList[k];
        });
        plan.shoppingList = shoppingList;
        return jsonRes(plan, 200, cors);
      } catch (e) {
        return jsonRes({ error: "Could not generate plan: " + e.message }, 500, cors);
      }
    }
    if (type === "coach_report") {
      const { context, prompt, coachMode } = body;
      if (!context) return jsonRes({ error: "Missing context" }, 400, cors);
      const system = getCoachSystem(coachMode);
      const result = await callClaude(
        env.ANTHROPIC_API_KEY,
        system,
        [{ role: "user", content: "My data:\n\n" + context + "\n\n" + (prompt || "Write a weekly check-in as 3-4 bullet points. Cover weight trend vs goal, calorie adherence, protein consistency, and one actionable focus for next week. Start each with an emoji.") }],
        600
      );
      if (result.error) return jsonRes({ error: result.error }, 502, cors);
      return jsonRes({ text: result.text }, 200, cors);
    }
    if (type === "coach_chat") {
      const { context, messages, coachMode } = body;
      if (!context || !messages) return jsonRes({ error: "Missing context or messages" }, 400, cors);
      const system = getCoachSystem(coachMode);
      const claudeMessages = [
        { role: "user", content: "My current data:\n\n" + context },
        { role: "assistant", content: "Got it, I have your full data. What do you want to know?" }
      ].concat(messages);
      const result = await callClaude(env.ANTHROPIC_API_KEY, system, claudeMessages, 800);
      if (result.error) return jsonRes({ error: result.error }, 502, cors);
      return jsonRes({ text: result.text }, 200, cors);
    }
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
        response.appUrl = "https://kjgoodwin01.github.io/macrotrack/";
      }
      return jsonRes(response, 200, cors);
    }
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
        status: "pending"
      });
      if (!result.ok) return jsonRes({ error: "Failed to save" }, 500, cors);
      return jsonRes({ ok: true }, 200, cors);
    }
    if (type === "waitlist_list") {
      const { adminKey } = body;
      if (adminKey !== "MACROTRACK_ADMIN_2026") return jsonRes({ error: "Unauthorized" }, 401, cors);
      const result = await sb(env, "GET", "waitlist?order=created_at.desc&limit=500");
      if (!result.ok) return jsonRes({ error: "Failed to load" }, 500, cors);
      return jsonRes({ waitlist: result.data || [] }, 200, cors);
    }
    if (type === "waitlist_approve") {
      const { id, email, name, adminKey } = body;
      if (adminKey !== "MACROTRACK_ADMIN_2026") return jsonRes({ error: "Unauthorized" }, 401, cors);
      if (!id || !email || !name) return jsonRes({ error: "Missing data" }, 400, cors);
      const code = name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6) + Math.random().toString(36).slice(2, 6).toUpperCase();
      await env.CODES.put(code, JSON.stringify({
        name,
        used: false,
        email,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      }));
      await sb(env, "PATCH", "waitlist?id=eq." + encodeURIComponent(id), {
        status: "approved",
        invite_code: code,
        approved_at: (/* @__PURE__ */ new Date()).toISOString()
      });
      if (env.RESEND_API_KEY) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + env.RESEND_API_KEY },
          body: JSON.stringify({
            from: "MacroTrack <onboarding@resend.dev>",
            to: [email],
            subject: "Your MacroTrack invite is here \u{1F389}",
            html: `<div style="font-family:'DM Sans',Arial,sans-serif;max-width:520px;margin:0 auto;background:#08080f;color:#f0f0fa;padding:40px 32px;border-radius:16px;"><div style="font-family:Georgia,serif;font-size:28px;letter-spacing:4px;margin-bottom:6px;">MACRO<span style="color:#6366f1;">TRACK</span></div><div style="font-size:11px;color:#5a5a7a;letter-spacing:2px;text-transform:uppercase;margin-bottom:32px;">Private Beta</div><p style="font-size:16px;line-height:1.7;color:#a0a0c0;margin-bottom:24px;">Hey ${name}, your application was approved. You're in. \u{1F389}</p><div style="background:#0d0d1a;border:1px solid rgba(99,102,241,0.3);border-radius:14px;padding:24px;text-align:center;margin-bottom:28px;"><div style="font-size:12px;color:#5a5a7a;text-transform:uppercase;letter-spacing:2px;margin-bottom:12px;">Your Invite Code</div><div style="font-family:'Courier New',monospace;font-size:32px;font-weight:700;letter-spacing:6px;color:#6366f1;">${code}</div><div style="font-size:12px;color:#5a5a7a;margin-top:10px;">Single use \u2014 this code is just for you</div></div><a href="https://kjgoodwin01.github.io/macrotrack/" style="display:block;text-align:center;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;padding:16px;border-radius:12px;font-size:16px;font-weight:600;letter-spacing:1px;margin-bottom:24px;">Open MacroTrack \u2192</a><p style="font-size:12px;color:#5a5a7a;text-align:center;">MacroTrack Private Beta</p></div>`
          })
        });
      }
      return jsonRes({ ok: true, code }, 200, cors);
    }
    if (type === "waitlist_deny") {
      const { id, adminKey } = body;
      if (adminKey !== "MACROTRACK_ADMIN_2026") return jsonRes({ error: "Unauthorized" }, 401, cors);
      await sb(env, "PATCH", "waitlist?id=eq." + encodeURIComponent(id), { status: "denied" });
      return jsonRes({ ok: true }, 200, cors);
    }
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
    if (type === "push_subscribe") {
      const { deviceId, subscription, preferences } = body;
      if (!deviceId || !subscription || !subscription.endpoint) {
        return jsonRes({ error: "Missing subscription data" }, 400, cors);
      }
      const keys = subscription.keys || {};
      const result = await sb(env, "POST", "push_subscriptions", {
        device_id: deviceId,
        endpoint: subscription.endpoint,
        p256dh: keys.p256dh || "",
        auth: keys.auth || "",
        notify_report: preferences?.report !== false,
        notify_correction: preferences?.correction !== false,
        notify_reminder: preferences?.reminder || false,
        reminder_hour: preferences?.reminderHour || 12,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      });
      if (!result.ok) return jsonRes({ error: "Failed to save subscription" }, 500, cors);
      return jsonRes({ ok: true }, 200, cors);
    }
    if (type === "push_update_prefs") {
      const { deviceId, preferences } = body;
      if (!deviceId) return jsonRes({ error: "Missing deviceId" }, 400, cors);
      const updates = { updated_at: (/* @__PURE__ */ new Date()).toISOString() };
      if (preferences.report !== void 0) updates.notify_report = preferences.report;
      if (preferences.correction !== void 0) updates.notify_correction = preferences.correction;
      if (preferences.reminder !== void 0) updates.notify_reminder = preferences.reminder;
      if (preferences.reminderHour !== void 0) updates.reminder_hour = preferences.reminderHour;
      const result = await sb(
        env,
        "PATCH",
        "push_subscriptions?device_id=eq." + encodeURIComponent(deviceId),
        updates
      );
      if (!result.ok) return jsonRes({ error: "Failed to update" }, 500, cors);
      return jsonRes({ ok: true }, 200, cors);
    }
    if (type === "push_unsubscribe") {
      const { deviceId } = body;
      if (!deviceId) return jsonRes({ error: "Missing deviceId" }, 400, cors);
      await sb(
        env,
        "DELETE",
        "push_subscriptions?device_id=eq." + encodeURIComponent(deviceId)
      );
      return jsonRes({ ok: true }, 200, cors);
    }
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
      const result = await callClaude(
        env.ANTHROPIC_API_KEY,
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
        return jsonRes({ foods }, 200, cors);
      } catch (e) {
        return jsonRes({ error: "Failed to parse AI response" }, 500, cors);
      }
    }
    return jsonRes({ error: "Unknown request type: " + type }, 400, cors);
  }
};

// ../../Users/kjgoo/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../Users/kjgoo/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-scheduled.ts
var scheduled = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  const url = new URL(request.url);
  if (url.pathname === "/__scheduled") {
    const cron = url.searchParams.get("cron") ?? "";
    await middlewareCtx.dispatch("scheduled", { cron });
    return new Response("Ran scheduled event");
  }
  const resp = await middlewareCtx.next(request, env);
  if (request.headers.get("referer")?.endsWith("/__scheduled") && url.pathname === "/favicon.ico" && resp.status === 500) {
    return new Response(null, { status: 404 });
  }
  return resp;
}, "scheduled");
var middleware_scheduled_default = scheduled;

// ../../Users/kjgoo/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-NnmnGB/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_scheduled_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../Users/kjgoo/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-NnmnGB/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
