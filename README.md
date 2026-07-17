# Apply Line — Automation Server Setup Guide

Ye server roz ek fixed time par khud-ba-khud:
1. Naye job openings dhundhta hai (aapke selected campaigns/roles ke hisaab se)
2. Har nayi company ke liye tailored draft application banata hai
3. WhatsApp par summary bhejta hai — **bina kisi tap ke**

**Send abhi bhi manual hai** — aap HTML tool (Apply Line) khol kar khud Review & Send karoge.

---

## Zaroori Cheezein (pehle inhe ready karo)

### 1. Firebase Service Account Key
Ye web-config se ALAG hai (jo HTML tool mein use ki thi).
1. https://console.firebase.google.com → apna project kholo
2. ⚙️ Project Settings → **Service Accounts** tab
3. "Generate New Private Key" dabao → ek `.json` file download hogi
4. Is file ko **base64** mein convert karna hai:
   - **Mac/Linux Terminal:** `base64 -i serviceAccountKey.json | tr -d '\n'`
   - **Windows PowerShell:** `[Convert]::ToBase64String([IO.File]::ReadAllBytes("serviceAccountKey.json"))`
   - Ya online tool: base64encode.org (file upload karke, sirf apne trusted browser mein)
5. Jo lamba text milega, wahi `FIREBASE_SERVICE_ACCOUNT_BASE64` mein jayega

### 2. Firebase Database URL
Firebase Console → Realtime Database → upar hi URL dikhega (jaisa `https://xxx-default-rtdb.firebaseio.com`)

### 3. Gemini API Key
Wahi jo aapne HTML tool mein use ki thi (aistudio.google.com/apikey)

### 4. CallMeBot Setup (WhatsApp ke liye, 2 minute mein ho jayega)
1. Apne phone mein ye number contact mein save karo: **+34 611 01 16 37**
2. Us number ko WhatsApp par ye message bhejo: `I allow callmebot to send me messages`
3. Bot turant ek reply karega jisme aapki **API Key** hogi
4. Apna WhatsApp number (country code ke saath, jaise `+919876543210`) aur ye API key note kar lo

### 5. GitHub Account (free)
Render is code ko deploy karne ke liye ek Git repository maangta hai.
1. github.com par free account banao
2. "New Repository" → naam do (jaise `apply-line-server`) → Create
3. "Add file" → "Upload files" → is folder ki saari files (server.js, package.json, .env.example, README.md) drag-drop karo → Commit

---

## Render Par Deploy Karna

1. https://render.com par account banao (GitHub se sign-in kar sakte ho, aasan rahega)
2. Dashboard → **New +** → **Web Service**
3. Apna GitHub repo (`apply-line-server`) connect karo
4. Settings:
   - **Name:** apply-line-automation (ya jo chaho)
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. "Environment" section mein ye sab variables add karo (upar wale `.env.example` jaisa):
   - `FIREBASE_SERVICE_ACCOUNT_BASE64`
   - `FIREBASE_DATABASE_URL`
   - `GEMINI_API_KEY`
   - `CALLMEBOT_PHONE`
   - `CALLMEBOT_APIKEY`
   - `CRON_SECRET` (koi bhi random text likh do, jaise `dhiraj-apply-2026-secret`)
6. "Create Web Service" dabao — 2-3 minute mein deploy ho jayega
7. Aapko ek URL milega jaisa: `https://apply-line-automation.onrender.com`

**Test karne ke liye:** browser mein kholo:
`https://apply-line-automation.onrender.com/run-daily-job?secret=YOUR_CRON_SECRET`
(YOUR_CRON_SECRET ki jagah wahi likhna jo aapne Environment mein daala tha)

Agar sab sahi hai, aapko turant WhatsApp par summary aana chahiye (ya 1-2 minute mein).

---

## Daily Auto-Trigger Set Karna (cron-job.org — free)

Render ka FREE plan 15 minute inactivity ke baad "so jata hai" — isliye ek external free scheduler use karenge jo roz ek fixed time par is URL ko khud call kar de.

1. https://cron-job.org par free account banao
2. "Create Cronjob"
3. **URL:** `https://apply-line-automation.onrender.com/run-daily-job?secret=YOUR_CRON_SECRET`
4. **Schedule:** Daily, jis time chaho (jaise subah 8:00 AM IST)
5. Save karo

Bas — ab roz us time par server khud jaag kar apna kaam karega aur WhatsApp par summary bhej dega.

*(Optional: agar chaho ki server hamesha "jaga" rahe taaki turant respond kare, to cron-job.org mein ek aur job bana sakte ho jo har 10 minute mein `/health` URL ko ping kare. Zaroori nahi hai — daily job ke liye 30-60 second ka "wake up" delay chalta hai.)*

---

## Ye Kaam Karta Hai, Ye Nahi

✅ Roz naye job openings dhundhna (AI + web search)
✅ Har naye company ke liye tailored draft banana
✅ WhatsApp par automatic summary (bina tap ke)
✅ Sab kuch Firebase mein save — HTML tool kholne par turant dikhega

❌ Email khud send nahi karta — aapko HTML tool mein Review & Send karna hoga
❌ LinkedIn/Naukri se auto-apply nahi karta (unke Terms of Service ye allow nahi karte)
❌ HR ke reply khud nahi padhta — wo aapko manually HR Reply Log mein daalna hoga

---

## Kharcha

- Render Free Web Service: **₹0** (bas thoda "sleep" hota hai jab use nahi ho raha)
- cron-job.org: **₹0**
- CallMeBot: **₹0** (personal use ke liye free)
- Gemini API: aapke usage ke hisaab se — daily 2 campaigns ke liye search+draft calls, Gemini Flash ka free-tier quota usually kaafi hota hai halke usage ke liye

Agar future mein zyada reliability chahiye (server kabhi na soye), Render ka Starter paid plan (~$7/month) le sakte ho — lekin abhi ke liye Free tier se shuruaat karna theek hai.
