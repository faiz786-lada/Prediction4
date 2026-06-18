# 🚀 PERMANENT AI ENGINE — DEPLOY GUIDE
## Firebase Cloud Functions Setup (One-time only)

---

## Step 1 — Node.js Install karo
https://nodejs.org/en/download
(LTS version download karo)

---

## Step 2 — Firebase CLI Install karo
Terminal/CMD mein yeh command chalao:
```
npm install -g firebase-tools
```

---

## Step 3 — Firebase Login karo
```
firebase login
```
Browser mein Google account se login karo (wahi account jo Firebase project ka owner ho)

---

## Step 4 — Functions folder mein dependencies install karo
```
cd functions
npm install
cd ..
```

---

## Step 5 — Deploy karo
```
firebase deploy --only functions
```

Yeh 3-5 minute lagega. Deploy hone ke baad aisa dikhega:
```
✔ functions[permanentAIEngine]: Scheduled function every 1 minutes
✔ functions[triggerEngine]: HTTP function
✔ functions[proxyLottery]: HTTP function
```

---

## Step 6 — Firebase Console mein verify karo
1. https://console.firebase.google.com
2. Project: number-hack-4798c
3. Functions → tab mein `permanentAIEngine` dikhega
4. Database → `globalPrediction` node mein data aane lagega

---

## Kya hoga deploy ke baad?

✅ Har 1 minute mein automatically prediction update hogi
✅ Koi browser open rakhne ki zaroorat NAHI
✅ Google ke servers pe permanently chalta rahega
✅ Sab users ko same prediction milegi
✅ 24/7/365 — band nahi hoga

---

## Agar kuch error aaye

### "Billing account required"
Cloud Functions ke liye Firebase ka Blaze (pay-as-you-go) plan chahiye.
Cost: ~FREE for this usage (1M free invocations/month, yeh sirf ~43,000/month use karega)
Firebase Console → Upgrade to Blaze plan

### "Permission denied"
```
firebase login --reauth
```

### Manual trigger (test ke liye)
Browser mein yeh URL kholo:
https://us-central1-number-hack-4798c.cloudfunctions.net/triggerEngine

---

## Files summary
```
functions/
  index.js        ← Main AI engine (server-side)
  package.json    ← Dependencies
firebase.json     ← Firebase config
.firebaserc       ← Project ID
database.rules.json ← DB security rules
index.html        ← Frontend (users Firebase se read karte hain)
```
