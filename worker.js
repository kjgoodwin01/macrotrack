/**
 * MacroTrack Worker — Cloudflare Worker
 * Handles: Supabase sync, food search, barcode lookup,
 * AI photo scan, coach chat/report, meal plan generation,
 * push notifications, natural language food entry
 */

const ALLOWED_ORIGINS = [
  "https://kjgoodwin01.github.io",
  "http://localhost",
  "http://127.0.0.1",
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

// ── Search Orchestrator helpers ───────────────────────────────────────────
function getNutrientVal(nutrients, id) {
  const n = (nutrients || []).find(x => x.nutrientId === id || x.nutrientNumber === String(id));
  return Math.round(n && n.value ? n.value : 0);
}

// Comprehensive restaurant chain keyword list — lowercase substrings for partial matching
// e.g. "mcdonald" matches "McDonald's", "mcdonalds nuggets", "mcdonald's big mac", etc.
const CHAIN_KEYWORDS = [
  // Burgers
  "mcdonald","burger king","wendy's","wendy","five guys","shake shack","in-n-out",
  "whataburger","culver's","culver","jack in the box","carl's jr","hardee's","hardee",
  "sonic drive","checkers","rally's","steak 'n shake","steak n shake","fatburger",
  "smashburger","burgerfi","back yard burgers","habit burger","the habit","freddy's",
  "fuddruckers","steak escape","back yard burger",
  // Chicken
  "chick-fil-a","chick fil a","popeyes","popeye","kfc","raising cane","zaxby",
  "wingstop","bojangles","church's chicken","el pollo loco","slim chickens",
  "jollibee","dave's hot chicken","hattie b","gus's","golden chick",
  "golden corral chicken","huey magoo",
  // Sandwiches & Subs
  "subway","jimmy john","jersey mike","firehouse subs","firehouse sub","quiznos",
  "potbelly","which wich","penn station","charley's","charleys","goodcents",
  "mr. hero","mr hero","blimpie","togos","togo's",
  // Mexican
  "chipotle","qdoba","moe's southwest","moe's","taco bell","del taco","taco bueno",
  "taco cabana","on the border","fuzzy's taco","freebirds","chronic tacos",
  "salsarita","tijuana flats","baja fresh","rubio's","rubio",
  // Pizza
  "pizza hut","domino's","domino","papa john","little caesar","papa murphy",
  "sbarro","blaze pizza","mod pizza","pieology","round table","marco's pizza",
  "marcos pizza","cicis","cici's","godfather's","hungry howie","jets pizza",
  "jet's pizza","east of chicago","donatos","ledo pizza","stevi b",
  "uno pizzeria","uno chicago","mellow mushroom","old chicago",
  // Coffee, Bakery & Breakfast
  "starbucks","dunkin","tim horton","panera","einstein bros","bruegger",
  "caribou coffee","peet's","dutch bros","biggby","scooter's coffee",
  "corner bakery","la madeleine","first watch","original pancake","ihop",
  "denny's","denny","waffle house","cracker barrel","bob evans","perkins",
  "friendly's","shoney's","big boy","huddle house","village inn",
  // Casual & Family Dining
  "applebee's","applebee","chili's","chili","tgi friday","tgi fridays",
  "olive garden","red lobster","outback steakhouse","outback",
  "longhorn steakhouse","longhorn","texas roadhouse","red robin",
  "cheesecake factory","ruby tuesday","buffalo wild wings","bdubs","b-dubs",
  "hooters","yard house","dave & buster","dave and buster","bahama breeze",
  "seasons 52","bonefish grill","carrabba","maggiano","joe's crab","bubba gump",
  "benihana","pf chang","p.f. chang","P.F. Chang","houlihan","fridays",
  // Fine Dining Chains
  "capital grille","the capital grille","eddie v","ruth's chris","morton's",
  "fleming's","mastro's","ocean prime","del frisco","sullivan's steakhouse",
  "black angus","lone star steakhouse","sizzler","western sizzlin",
  // Fast Casual
  "sweetgreen","noodles & company","noodles and company","cosi","freshii",
  "tender greens","dig inn","honeygrow","lemonade restaurant","by chloe",
  "just salad","salata","mcalister's deli","mcalister","jason's deli",
  "corner bakery","zoes kitchen","zoës kitchen","cosi restaurant",
  // Asian Fast Casual
  "panda express","pei wei","yoshinoya","manchu wok","sarku japan",
  "genghis grill","bd's mongolian","mongolian grill","hibachi-san",
  // BBQ
  "dickey's bbq","dickey","famous dave","smokey bones","mission bbq",
  "jim 'n nick","rodizio grill","4 rivers","luby's","golden corral",
  "ryan's grill","hometown buffet",
  // Ice Cream & Dessert
  "dairy queen","baskin-robbins","baskin robbins","cold stone","marble slab",
  "yogurtland","pinkberry","menchie's","menchie","tcby","rita's italian ice",
  "carvel","orange julius","insomnia cookies","krispy kreme","cinnabon",
  "nothing bundt","great american cookies","rocky mountain chocolate",
  "marble slab creamery","maggie moo","bruster's","culver's concrete",
  // Smoothies & Juice
  "jamba juice","jamba","smoothie king","tropical smoothie","clean juice",
  "booster juice","robeks","nekter juice","pressed juicery",
  // Seafood
  "long john silver","captain d's","captain d","joe's crab shack",
  "red lobster","legal sea foods","bubba gump shrimp","bonefish",
  // Convenience & Snacks
  "wawa","sheetz","7-eleven","auntie anne's","auntie anne","pretzelmaker",
  "wetzel's pretzels","wetzel","hot dog on a stick","nathan's famous","nathans",
  // Wings Specialists
  "wingstop","wing zone","wild wing","anchor bar","pluckers","99 restaurant",
  // Deli & Bakery
  "jersey mike","jason's deli","schlotzksy's","schlotzsky","mcalister",
  "bruegger's","einstein bagel","great harvest","Paradise bakery",
  // Steak & Seafood Casual
  "texas de brazil","texas de brasil","fogo de chao","fogo","brazeiro",
  "saltgrass","longhorn","black bear diner","marie callender",
  // Other Notable Chains
  "noodles","qdoba","moes","cinco de mayo","del taco","taco john","taco time",
  "taco mayo","del taco","bad daddy","smalls sliders","culver",
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

// ── Web Push helper — sends push notification via VAPID ──────────────────
async function sendWebPush(endpoint, p256dhKey, authKey, payload, vapidPublicKey, vapidPrivateKey, vapidSubject) {
  try {
    const vapidHeader = await createVapidAuth(endpoint, vapidPublicKey, vapidPrivateKey, vapidSubject);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": vapidHeader,
        "Content-Type": "application/json",
        "TTL": "86400",
        "Urgency": "normal",
      },
      body: payload,
    });
    return { ok: response.ok, status: response.status };
  } catch (e) {
    console.log("[sendWebPush] THREW:", e.message, e.stack);
    return { ok: false, status: 0, error: e.message };
  }
}

async function createVapidAuth(endpoint, publicKey, privateKey, subject) {
  const urlObj = new URL(endpoint);
  const audience = urlObj.protocol + "//" + urlObj.host;

  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: audience, exp: now + 86400, sub: subject };

  function toBase64Url(str) {
    return btoa(str).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  }

  const headerB64 = toBase64Url(JSON.stringify(header));
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const unsigned = headerB64 + "." + payloadB64;

  const rawKey = Uint8Array.from(atob(privateKey.replace(/-/g, "+").replace(/_/g, "/")), function(c) { return c.charCodeAt(0); });

  const cryptoKey = await crypto.subtle.importKey(
    "raw", rawKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false, ["sign"]
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
      try {
        const pushPayload = JSON.stringify({
          title: title,
          body: bodyText,
          url: "https://kjgoodwin01.github.io/macrotrack/",
          icon: "https://kjgoodwin01.github.io/macrotrack/icon-192.png",
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
      const subs = await sb(env, "GET", "push_subscriptions?notify_report=eq.true&limit=5000");
      console.log("[scheduled] weekly report subs count:", (subs.data || []).length, "subs.ok:", subs.ok);
      for (const sub of (subs.data || [])) {
        console.log("[scheduled] sending weekly report push to sub.id:", sub.id);
        await sendPush(sub, "Weekly Check-in Ready 📊", "Your coaching report is ready. See how your week went.");
      }
    }

    // ── Daily reminder: 4 PM UTC = 12 PM EDT ───────────────────────────
    console.log("[scheduled] checking daily reminder block: hour === 16 →", hour === 16);
    if (hour === 16) {
      const subs = await sb(env, "GET", "push_subscriptions?notify_reminder=eq.true&limit=5000");
      console.log("[scheduled] daily reminder subs count:", (subs.data || []).length, "subs.ok:", subs.ok);
      if (subs.data && subs.data.length > 0) {
        for (const sub of subs.data) {
          try {
            if (!sub.device_id) {
              console.log("[scheduled] daily reminder — sub.device_id is undefined for sub.id:", sub.id, "SKIPPING");
              continue;
            }
            const entries = await sb(env, "GET",
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
      const subs = await sb(env, "GET", "push_subscriptions?notify_correction=eq.true&limit=5000");
      console.log("[scheduled] protein gap subs count:", (subs.data || []).length, "subs.ok:", subs.ok);
      if (subs.data && subs.data.length > 0) {
        for (const sub of subs.data) {
          try {
            if (!sub.device_id) {
              console.log("[scheduled] protein gap — sub.device_id is undefined for sub.id:", sub.id, "SKIPPING");
              continue;
            }

            // Resolve personal protein goal from profile
            const profile = await sb(env, "GET",
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
            const entries = await sb(env, "GET",
              "food_entries?device_id=eq." + encodeURIComponent(sub.device_id) +
              "&log_date=eq." + todayISO + "&limit=200"
            );
            if (!entries.data || entries.data.length === 0) continue;

            const proteinLogged = Math.round(entries.data.reduce(function(sum, e) {
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
      const { deviceId } = body;
      if (!deviceId) return jsonRes({ error: "Missing deviceId" }, 400, cors);
      const [profile, entries, wlog] = await Promise.all([
        sb(env, "GET", "profiles?device_id=eq." + encodeURIComponent(deviceId) + "&limit=1"),
        sb(env, "GET", "food_entries?device_id=eq." + encodeURIComponent(deviceId) + "&order=log_date.asc&limit=500"),
        sb(env, "GET", "weight_log?device_id=eq." + encodeURIComponent(deviceId) + "&order=log_date.asc&limit=200"),
      ]);
      return jsonRes({
        profile: (profile.data && profile.data[0]) || null,
        entries: entries.data || [],
        wlog: wlog.data || [],
      }, 200, cors);
    }

    // ── SYNC: Save profile ────────────────────────────────────────────────
    if (type === "sync_profile") {
      const { deviceId, name, goalType, targetWeight, calories, protein, carbs, fat } = body;
      if (!deviceId) return jsonRes({ error: "Missing deviceId" }, 400, cors);
      if (!name || !name.trim()) return jsonRes({ error: "Name is required" }, 400, cors);
      const result = await sb(env, "POST", "profiles", {
        device_id: deviceId, name: name || "", goal_type: goalType || "cut",
        target_weight: targetWeight || null, calories: calories || 2100,
        protein: protein || 180, carbs: carbs || 210, fat: fat || 60,
        updated_at: new Date().toISOString(),
      });
      if (!result.ok) return jsonRes({ error: "Failed to save profile" }, 500, cors);
      return jsonRes({ ok: true }, 200, cors);
    }

    // ── SYNC: Add food entry ──────────────────────────────────────────────
    if (type === "sync_add_entry") {
      const { deviceId, entry } = body;
      if (!deviceId || !entry) return jsonRes({ error: "Missing data" }, 400, cors);
      const profileCheck = await sb(env, "GET", "profiles?device_id=eq." + encodeURIComponent(deviceId) + "&limit=1");
      if (!profileCheck.data || profileCheck.data.length === 0) {
        return jsonRes({ error: "Profile not found — complete onboarding first" }, 403, cors);
      }
      const result = await sb(env, "POST", "food_entries", {
        device_id: deviceId, log_date: entry.date, meal: entry.meal,
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
      try {
        const r = await fetch("https://world.openfoodfacts.org/api/v0/product/" + upc + ".json",
          { headers: { "User-Agent": "MacroTrack App" } });
        if (r.ok) {
          const d = await r.json();
          if (d.status === 1 && d.product) {
            const p = d.product;
            const n = p.nutriments || {};
            const servGrams = parseFloat(p.serving_quantity) || 100;
            return jsonRes({ foods: [{
              fdcId: "off-" + upc,
              description: p.product_name || "Unknown Product",
              brandOwner: p.brands || "", dataType: "Branded", gtinUpc: upc,
              foodNutrients: [
                { nutrientId: 1008, value: Math.round(n["energy-kcal_100g"] || 0) },
                { nutrientId: 1003, value: Math.round(n.proteins_100g || 0) },
                { nutrientId: 1005, value: Math.round(n.carbohydrates_100g || 0) },
                { nutrientId: 1004, value: Math.round(n.fat_100g || 0) },
              ],
              foodPortions: [{ portionDescription: p.serving_size || "1 serving", gramWeight: servGrams }],
              servingSize: servGrams, servingSizeUnit: "g",
            }]}, 200, cors);
          }
        }
      } catch (e) {}
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
      const { days, calories, protein, carbs, fat, goalType, preferences, context } = body;
      if (!days || !calories) return jsonRes({ error: "Missing plan parameters" }, 400, cors);

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
        Object.keys(totals).forEach(function(foodName) {
          const totalGrams = totals[foodName];
          const withBuffer = totalGrams * 1.1;
          const qty = gramsToUS(withBuffer, foodName);
          const cat = categorize(foodName);
          shoppingList[cat].push({ item: foodName, qty: qty });
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

    // ── COACH REPORT ──────────────────────────────────────────────────────
    if (type === "coach_report") {
      const { context, prompt, coachMode } = body;
      if (!context) return jsonRes({ error: "Missing context" }, 400, cors);
      const system = getCoachSystem(coachMode);
      const result = await callClaude(env.ANTHROPIC_API_KEY, system,
        [{ role: "user", content: "My data:\n\n" + context + "\n\n" + (prompt || "Write a weekly check-in as 3-4 bullet points. Cover weight trend vs goal, calorie adherence, protein consistency, and one actionable focus for next week. Start each with an emoji.") }],
        600
      );
      if (result.error) return jsonRes({ error: result.error }, 502, cors);
      return jsonRes({ text: result.text }, 200, cors);
    }

    // ── COACH CHAT ────────────────────────────────────────────────────────
    if (type === "coach_chat") {
      const { context, messages, coachMode } = body;
      if (!context || !messages) return jsonRes({ error: "Missing context or messages" }, 400, cors);
      const system = getCoachSystem(coachMode);
      const claudeMessages = [
        { role: "user", content: "My current data:\n\n" + context },
        { role: "assistant", content: "Got it, I have your full data. What do you want to know?" },
      ].concat(messages);
      const result = await callClaude(env.ANTHROPIC_API_KEY, system, claudeMessages, 800);
      if (result.error) return jsonRes({ error: result.error }, 502, cors);
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
        response.appUrl = "https://kjgoodwin01.github.io/macrotrack/";
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
            from: "MacroTrack <onboarding@resend.dev>",
            to: [email],
            subject: "Your MacroTrack invite is here 🎉",
            html: `<div style="font-family:'DM Sans',Arial,sans-serif;max-width:520px;margin:0 auto;background:#08080f;color:#f0f0fa;padding:40px 32px;border-radius:16px;"><div style="font-family:Georgia,serif;font-size:28px;letter-spacing:4px;margin-bottom:6px;">MACRO<span style="color:#6366f1;">TRACK</span></div><div style="font-size:11px;color:#5a5a7a;letter-spacing:2px;text-transform:uppercase;margin-bottom:32px;">Private Beta</div><p style="font-size:16px;line-height:1.7;color:#a0a0c0;margin-bottom:24px;">Hey ${name}, your application was approved. You're in. 🎉</p><div style="background:#0d0d1a;border:1px solid rgba(99,102,241,0.3);border-radius:14px;padding:24px;text-align:center;margin-bottom:28px;"><div style="font-size:12px;color:#5a5a7a;text-transform:uppercase;letter-spacing:2px;margin-bottom:12px;">Your Invite Code</div><div style="font-family:'Courier New',monospace;font-size:32px;font-weight:700;letter-spacing:6px;color:#6366f1;">${code}</div><div style="font-size:12px;color:#5a5a7a;margin-top:10px;">Single use — this code is just for you</div></div><a href="https://kjgoodwin01.github.io/macrotrack/" style="display:block;text-align:center;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;padding:16px;border-radius:12px;font-size:16px;font-weight:600;letter-spacing:1px;margin-bottom:24px;">Open MacroTrack →</a><p style="font-size:12px;color:#5a5a7a;text-align:center;">MacroTrack Private Beta</p></div>`,
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
        updated_at: new Date().toISOString(),
      });
      if (!result.ok) return jsonRes({ error: "Failed to save subscription" }, 500, cors);
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

    return jsonRes({ error: "Unknown request type: " + type }, 400, cors);
  },
};