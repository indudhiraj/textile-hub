/**
 * Apply Line — Background Automation Server
 * ------------------------------------------
 * Roz ek scheduled time par (external cron ping se) ye:
 *   1. Firebase se resume + selected campaigns/roles padhta hai
 *   2. Gemini (with web search) se naye job openings dhundhta hai
 *   3. Har naye company ke liye tailored draft application banata hai
 *   4. Sab kuch Firebase mein wapas save karta hai (HTML tool mein dikhega)
 *   5. WhatsApp par (CallMeBot se) summary bhejta hai — bina kisi tap ke
 *
 * "Send" abhi bhi MANUAL hai — Dhiraj HTML tool khol kar khud Review & Send karega.
 */

const express = require('express');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- Firebase Admin init ---------- */
if (!process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || !process.env.FIREBASE_DATABASE_URL) {
  console.error('FIREBASE_SERVICE_ACCOUNT_BASE64 ya FIREBASE_DATABASE_URL missing hai — .env check karo.');
}
const serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '', 'base64').toString('utf8') || '{}'
);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});
const db = admin.database();

/* ---------- Campaign/Role definitions — HTML tool jaisa hi rakhna hai ---------- */
const CAMPAIGNS = {
  homefurnishing: { label: "Home Furnishing", roles: ["Merchandiser", "PPC Manager", "Production Manager"] },
  garment: { label: "Garment / Apparel Export", roles: ["PPC Manager", "Production Manager"] }
};

/* ---------- Gemini helpers ---------- */
const GEMINI_KEY = process.env.GEMINI_API_KEY;

async function callGemini(prompt, maxTokens = 900) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens } })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callGeminiWithSearch(prompt, maxTokens = 1600) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { maxOutputTokens: maxTokens } })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map(p => p.text || '').join('\n');
}

function parseDiscoverBlocks(text) {
  const getField = (block, key) => {
    const m = block.match(new RegExp(key + ":\\s*(.*)", "i"));
    if (!m) return "";
    const v = m[1].trim();
    return v.toLowerCase() === "not found" ? "" : v;
  };
  return text.split(/\n?-{2,}\n?/).map(b => b.trim()).filter(Boolean).map(block => ({
    company: getField(block, "COMPANY"), location: getField(block, "LOCATION"),
    jobTitle: getField(block, "JOBTITLE"), email: getField(block, "EMAIL"),
    jobLink: getField(block, "JOBLINK"), notes: getField(block, "NOTES")
  })).filter(r => r.company);
}

async function tailorApplication(company, resume, role) {
  const prompt = `Tum ek career assistant ho. Neeche diya gaya resume padho aur is company ke liye ek professional job application email likho.

RESUME:
${resume}

COMPANY: ${company.name} (${company.location})
TARGET ROLE: ${role}

Instructions:
- Email professional business English mein likho.
- Resume ke actual skills/experience ko highlight karo jo "${role}" role se relevant hain.
- Email short ho (120-160 words), professional tone.
- Company ka naam aur role explicitly mention karo.
- End mein resume attached hone ka reference karo.

Respond in EXACTLY this plain-text format, nothing else before or after:
SUBJECT: <email subject line here, one line only>
===BODY===
<email body here, can be multiple paragraphs>`;

  const text = await callGemini(prompt, 1000);
  const subjectMatch = text.match(/SUBJECT:\s*(.*)/i);
  const subject = subjectMatch ? subjectMatch[1].trim() : `Application for ${role} Role — ${company.name}`;
  const parts = text.split(/===BODY===/i);
  const body = parts.length > 1 ? parts[1].trim() : text.replace(/SUBJECT:.*$/im, "").trim();
  return { subject, body };
}

function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40); }
function todayISO() { return new Date().toISOString().slice(0, 10); }

/* ---------- WhatsApp via CallMeBot (free, personal-use API) ---------- */
async function sendWhatsApp(message) {
  const phone = process.env.CALLMEBOT_PHONE;
  const apikey = process.env.CALLMEBOT_APIKEY;
  if (!phone || !apikey) { console.log('CallMeBot configured nahi hai — WhatsApp skip kar rahe hain.'); return; }
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(message)}&apikey=${apikey}`;
  try {
    const res = await fetch(url);
    console.log('CallMeBot response status:', res.status);
  } catch (e) { console.error('CallMeBot send fail hua:', e.message); }
}

/* ---------- Main daily job ---------- */
async function runDailyJob() {
  console.log(`[${new Date().toISOString()}] Daily job shuru ho raha hai...`);
  const snap = await db.ref('jobApplyMultiCampaign/state').once('value');
  const state = snap.val();

  if (!state || !state.resume || !state.resume.trim()) {
    console.log('Firebase mein resume nahi mila — skip kar rahe hain.');
    await sendWhatsApp(`⚠️ Apply Line: Aaj ka automatic run skip hua — resume Firebase mein nahi mila. Pehle HTML tool mein Resume icon se resume save karein.`);
    return;
  }

  state.customCompanies = state.customCompanies || {};
  state.applications = state.applications || {};
  state.selectedCompanies = state.selectedCompanies || {};
  state.selectedRoles = state.selectedRoles || {};

  let totalNewCompanies = 0;
  let totalNewDrafts = 0;
  const perCampaignSummary = [];

  for (const camp of Object.keys(CAMPAIGNS)) {
    const roles = (CAMPAIGNS[camp].roles || []).filter(r => state.selectedRoles[camp] && state.selectedRoles[camp][r]);
    if (roles.length === 0) { continue; }

    const rolesTxt = roles.join(' / ');
    const prompt = `Web search karke pata karo ki "${CAMPAIGNS[camp].label}" (home textile/garment/apparel export) industry mein kaun si companies (India mein, kisi bhi major hub — NCR, Mumbai, Ludhiana, Bengaluru, Tirupur mein) ABHI current mein "${rolesTxt}" jaisi kisi role ke liye actively hiring kar rahi hain. Sirf real, currently verifiable openings do — invent mat karo. Kam se kam 3, zyada se zyada 8 companies do.

Har company ke liye EXACTLY is plain-text format mein likho, har company ke beech "---":

COMPANY: <naam>
LOCATION: <location>
JOBTITLE: <job title>
EMAIL: <email agar mila, warna: not found>
JOBLINK: <link agar mila, warna: not found>
NOTES: <chhoti si line>
---`;

    let discovered = [];
    try {
      const raw = await callGeminiWithSearch(prompt, 1600);
      discovered = parseDiscoverBlocks(raw);
    } catch (e) {
      console.error(`Discover fail hua ${camp} ke liye:`, e.message);
      continue;
    }

    if (!state.customCompanies[camp]) state.customCompanies[camp] = {};
    const cat = 'Discovered (Auto)';
    if (!state.customCompanies[camp][cat]) state.customCompanies[camp][cat] = [];

    const existingNames = new Set();
    Object.values(state.customCompanies[camp]).flat().forEach(c => existingNames.add((c.name || '').toLowerCase()));

    let newCompaniesThisCampaign = 0;
    let newDraftsThisCampaign = 0;

    for (const r of discovered) {
      if (!r.company) continue;
      const nameLower = r.company.toLowerCase();
      if (existingNames.has(nameLower)) continue; // pehle se pata hai, dobara mat jodo
      existingNames.add(nameLower);

      const id = 'auto-' + slugify(r.company) + '-' + Date.now().toString(36) + Math.floor(Math.random() * 1000);
      const companyObj = { id, name: r.company, email: r.email || 'check-website', location: r.location || '—', jobLink: r.jobLink || '' };
      state.customCompanies[camp][cat].push(companyObj);
      state.selectedCompanies[id] = true;
      newCompaniesThisCampaign++; totalNewCompanies++;

      for (const role of roles) {
        const key = `${camp}::${id}::${role}`;
        try {
          const result = await tailorApplication(companyObj, state.resume, role);
          state.applications[key] = {
            campaign: camp, companyId: id, role,
            subject: result.subject, body: result.body,
            status: 'Draft',
            history: [{ date: todayISO(), note: 'Auto-discovered aur draft banaya gaya (background job)' }],
            hrReplies: []
          };
          newDraftsThisCampaign++; totalNewDrafts++;
        } catch (e) { console.error(`Tailor fail hua ${r.company} / ${role}:`, e.message); }
      }
    }
    perCampaignSummary.push(`${CAMPAIGNS[camp].label}: ${newCompaniesThisCampaign} nayi companies, ${newDraftsThisCampaign} drafts`);
  }

  await db.ref('jobApplyMultiCampaign/state').set(state);

  const totalDraftCount = Object.values(state.applications).filter(a => a.status === 'Draft').length;
  const summaryMsg = `📋 Apply Line — Auto Daily Run (${todayISO()})\n\n${perCampaignSummary.join('\n') || 'Koi role select nahi mila — HTML tool mein Step 02 check karein.'}\n\n✅ Nayi Companies: ${totalNewCompanies}\n📝 Naye Drafts: ${totalNewDrafts}\n📥 Total Pending Drafts: ${totalDraftCount}\n\nApply Line tool kholo aur review karke Send karo.`;
  await sendWhatsApp(summaryMsg);
  console.log('Daily job khatam hua:\n' + summaryMsg);
}

/* ---------- Express endpoints ---------- */
app.get('/', (req, res) => res.send('Apply Line automation server chal raha hai.'));
app.get('/health', (req, res) => res.send('OK'));

app.get('/run-daily-job', async (req, res) => {
  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET) {
    return res.status(403).send('Forbidden — secret galat ya missing hai.');
  }
  res.send('Daily job trigger ho gaya — background mein chal raha hai. Kuch minute mein WhatsApp par summary aayega.');
  try {
    await runDailyJob();
  } catch (e) {
    console.error('runDailyJob error:', e);
    await sendWhatsApp(`⚠️ Apply Line: Aaj ka run FAIL hua — ${e.message}`);
  }
});

app.listen(PORT, () => console.log(`Apply Line automation server port ${PORT} par chal raha hai.`));
