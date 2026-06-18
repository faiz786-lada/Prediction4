/**
 * ═══════════════════════════════════════════════════════════
 * NUMBER HACK — PERMANENT SERVER-SIDE AI ENGINE
 * Firebase Cloud Function — Runs 24/7 on Google servers
 * No browser needed. Auto-restarts. Never stops.
 * ═══════════════════════════════════════════════════════════
 *
 * DEPLOY COMMAND:
 *   firebase deploy --only functions
 *
 * This function:
 * 1. Runs every 1 minute via Cloud Scheduler (pubsub)
 * 2. Fetches latest lottery data from API
 * 3. Runs full AI prediction (RSI + MA + Fibonacci + Streak)
 * 4. Writes result to Firebase Realtime DB at /globalPrediction
 * 5. All users read from /globalPrediction in real-time
 */

const functions  = require("firebase-functions");
const admin      = require("firebase-admin");
const fetch      = require("node-fetch");

admin.initializeApp();
const db = admin.database();

const LOTTERY_API = "https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json?ts=";
const PROXY_URL   = "https://us-central1-number-hack-4798c.cloudfunctions.net/proxyLottery";

// ───────────────────────────────────────────────
// 1. SCHEDULED ENGINE — runs every 1 minute
// ───────────────────────────────────────────────
exports.permanentAIEngine = functions
    .runWith({ timeoutSeconds: 55, memory: "256MB" })
    .pubsub.schedule("every 1 minutes")
    .onRun(async () => {
        try {
            await runPredictionCycle();
            console.log("✅ Prediction cycle complete");
        } catch (e) {
            console.error("❌ Engine error:", e.message);
            await db.ref("globalEngine").update({
                active: true,
                lastError: e.message,
                lastErrorAt: Date.now(),
            });
        }
        return null;
    });

// ───────────────────────────────────────────────
// 2. HTTP TRIGGER — manual trigger or health check
//    GET https://us-central1-number-hack-4798c.cloudfunctions.net/triggerEngine
// ───────────────────────────────────────────────
exports.triggerEngine = functions
    .runWith({ timeoutSeconds: 55, memory: "256MB" })
    .https.onRequest(async (req, res) => {
        res.set("Access-Control-Allow-Origin", "*");
        try {
            const result = await runPredictionCycle();
            res.json({ success: true, prediction: result.prediction, confidence: result.confidence, period: result.period });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

// ───────────────────────────────────────────────
// 3. PROXY — avoids CORS for lottery API
// ───────────────────────────────────────────────
exports.proxyLottery = functions
    .runWith({ timeoutSeconds: 15, memory: "128MB" })
    .https.onRequest(async (req, res) => {
        res.set("Access-Control-Allow-Origin", "*");
        res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
        if (req.method === "OPTIONS") { res.status(204).send(""); return; }
        try {
            const r    = await fetch(LOTTERY_API + Date.now(), { timeout: 10000 });
            const data = await r.json();
            res.json(data);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

// ═══════════════════════════════════════════════
// CORE PREDICTION ENGINE
// ═══════════════════════════════════════════════
async function runPredictionCycle() {
    // Fetch data
    const data = await fetchLotteryData();
    if (!data?.data?.list?.length) throw new Error("API returned no data");

    const list    = data.data.list;
    const results = list.map(item => parseInt(item.number) >= 5 ? "BIG" : "SMALL");
    const period  = list[0].issueNumber;

    // Check if period already processed
    const lastSnap = await db.ref("globalPrediction/period").once("value");
    if (lastSnap.val() === period) {
        console.log(`Period ${period} already processed, skipping`);
        // Still update timestamp so users know engine is alive
        await db.ref("globalEngine").update({ active: true, lastHeartbeat: Date.now() });
        return { prediction: null, confidence: null, period };
    }

    // Run AI
    const last20          = results.slice(0, 20);
    const bigRatio        = last20.filter(r => r === "BIG").length / last20.length * 100;
    const smallRatio      = 100 - bigRatio;
    const volatility      = calculateVolatility(results);
    const alternationRate = calculateAlternationRate(results);
    const streak          = calculateStreakValue(results);
    const sentiment       = 50 + (bigRatio - 50) * 0.5;

    const rsiResult = calculateRSI(results);
    const maResult  = calculateMovingAverages(results);
    const fibResult = calculateFibonacciLevels(results);
    const strResult = analyzeStreak(results);
    const hybrid    = hybridPrediction(rsiResult, maResult, fibResult, strResult, bigRatio);

    const payload = {
        period,
        prediction:     hybrid.prediction,
        confidence:     Math.round(hybrid.confidence),
        bigScore:       hybrid.bigScore,
        smallScore:     hybrid.smallScore,
        ind: {
            rsi:    rsiResult.prediction,
            ma:     maResult.prediction,
            fib:    fibResult.prediction,
            streak: strResult.prediction,
            neural: null,
        },
        rsiValue:       rsiResult.value,
        rsiSignal:      rsiResult.signal,
        maSignal:       maResult.prediction ? `${maResult.prediction} trend` : "Neutral",
        fibLevel:       fibResult.level,
        bigRatio,
        smallRatio,
        volatility,
        alternationRate,
        streak,
        sentiment,
        results:        results.slice(0, 50),
        updatedAt:      Date.now(),
    };

    await db.ref("globalPrediction").set(payload);
    await db.ref("globalEngine").update({
        active:        true,
        lastHeartbeat: Date.now(),
        lastPeriod:    period,
        lastError:     null,
    });

    console.log(`✅ Period ${period} → ${hybrid.prediction} (${Math.round(hybrid.confidence)}%)`);
    return payload;
}

// ─────────────────────────────────────────────
// FETCH LOTTERY DATA
// ─────────────────────────────────────────────
async function fetchLotteryData() {
    const res  = await fetch(LOTTERY_API + Date.now(), { timeout: 12000 });
    if (!res.ok) throw new Error(`API HTTP ${res.status}`);
    return res.json();
}

// ═══════════════════════════════════════════════
// AI HELPER FUNCTIONS (same logic as frontend)
// ═══════════════════════════════════════════════
function calculateVolatility(results) {
    if (results.length < 2) return 50;
    let changes = 0;
    const n = Math.min(20, results.length);
    for (let i = 1; i < n; i++) if (results[i - 1] !== results[i]) changes++;
    return (changes / (n - 1)) * 100;
}

function calculateAlternationRate(results) {
    if (results.length < 2) return 50;
    let alternations = 0;
    const n = Math.min(20, results.length);
    for (let i = 1; i < n; i++) if (results[i - 1] !== results[i]) alternations++;
    return (alternations / (n - 1)) * 100;
}

function calculateStreakValue(results) {
    if (!results.length) return 1;
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[i - 1]) streak++;
        else break;
    }
    return streak;
}

function calculateRSI(results) {
    if (results.length < 14) return { value: 50, prediction: null, confidence: 50, signal: "Neutral" };
    let gains = 0, losses = 0;
    for (let i = 1; i <= 14 && i < results.length; i++) {
        results[i - 1] === "BIG" ? gains++ : losses++;
    }
    const rs  = gains / (losses || 0.001);
    const rsi = 100 - (100 / (1 + rs));
    let prediction = null, confidence = 50;
    if (rsi > 70)      { prediction = "SMALL"; confidence = Math.min(85, 60 + (rsi - 70) * 1.5); }
    else if (rsi < 30) { prediction = "BIG";   confidence = Math.min(85, 60 + (30 - rsi) * 1.5); }
    return { value: rsi, prediction, confidence, signal: prediction ? `${prediction} expected` : "Neutral" };
}

function calculateMovingAverages(results) {
    if (results.length < 5) return { prediction: null, confidence: 50, ma5: 50, ma10: 50, ma20: 50 };
    const ma5  = results.slice(0, 5).filter(r => r === "BIG").length / 5;
    const ma10 = results.slice(0, 10).filter(r => r === "BIG").length / Math.min(10, results.length);
    const ma20 = results.slice(0, 20).filter(r => r === "BIG").length / Math.min(20, results.length);
    let prediction = null, confidence = 50;
    if (ma5 > ma10 && ma10 > ma20)      { prediction = "BIG";   confidence = Math.min(85, 65 + (ma5 - ma10) * 50); }
    else if (ma5 < ma10 && ma10 < ma20) { prediction = "SMALL"; confidence = Math.min(85, 65 + (ma10 - ma5) * 50); }
    else if (ma5 > ma20)                { prediction = "BIG";   confidence = 55; }
    else if (ma5 < ma20)                { prediction = "SMALL"; confidence = 55; }
    return { prediction, confidence, ma5: ma5 * 100, ma10: ma10 * 100, ma20: ma20 * 100 };
}

function calculateFibonacciLevels(results) {
    if (results.length < 20) return { prediction: null, confidence: 50, level: 50 };
    const pct = (results.slice(0, 20).filter(r => r === "BIG").length / 20) * 100;
    let prediction = null, confidence = 50;
    if (pct >= 78.6)      { prediction = "SMALL"; confidence = Math.min(82, 70 + (pct - 78.6) * 0.5); }
    else if (pct <= 23.6) { prediction = "BIG";   confidence = Math.min(82, 70 + (23.6 - pct) * 0.5); }
    else if (pct >= 61.8) { prediction = "SMALL"; confidence = 60; }
    else if (pct <= 38.2) { prediction = "BIG";   confidence = 60; }
    return { prediction, confidence, level: pct };
}

function analyzeStreak(results) {
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[i - 1]) streak++;
        else break;
    }
    let prediction = null, confidence = 50;
    if (streak >= 5)      { prediction = results[0]; confidence = 75; }
    else if (streak >= 3) { prediction = results[0]; confidence = 65; }
    return { prediction, confidence, currentStreak: streak };
}

function hybridPrediction(rsiM, maM, fibM, strM, bigRatio) {
    const weights = { rsi: 0.25, ma: 0.30, fib: 0.20, streak: 0.25 };
    let bigScore = 0, smallScore = 0;

    const addScore = (model, key) => {
        if (!model.prediction) return;
        const w   = weights[key] || 0.25;
        const adj = ((model.confidence || 50) - 50) / 50;
        const score = w * (1 + adj * 0.5);
        if (model.prediction === "BIG") bigScore += score;
        else smallScore += score;
    };

    addScore(rsiM, "rsi");
    addScore(maM,  "ma");
    addScore(fibM, "fib");
    addScore(strM, "streak");

    const finalPrediction = bigScore > smallScore ? "BIG" : (smallScore > bigScore ? "SMALL" : (bigRatio > 50 ? "SMALL" : "BIG"));
    const finalConfidence = Math.min(95, Math.max(45, (Math.max(bigScore, smallScore) / (bigScore + smallScore || 1)) * 100));

    return { prediction: finalPrediction, confidence: finalConfidence, bigScore, smallScore };
}
