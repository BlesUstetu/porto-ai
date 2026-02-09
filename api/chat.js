/**
 * Vercel Serverless Function: /api/chat
 *
 * ✅ Gemini (Google AI) — cocok untuk hosting di Vercel, tanpa expose API key ke browser.
 *
 * Environment Variables (Vercel → Project → Settings → Environment Variables):
 *   GEMINI_API_KEY = "..."   (WAJIB)
 *   GEMINI_MODEL   = "gemini-1.5-flash" (opsional)
 */

export default async function handler(req, res) {
  // CORS (aman untuk same-origin, membantu testing)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: "GEMINI_API_KEY is not set in Vercel env" });
  }

  // Model default yang ringan
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const userMessages = Array.isArray(body.messages) ? body.messages : [];
    const isProbe = !!body.probe;

    // Probe: untuk cek "AI/Offline" di widget, tanpa biaya request
    if (isProbe) {
      return res.status(200).json({ ok: true });
    }

    // Bersihkan & batasi konteks
    const cleaned = userMessages
      .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-24)
      .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));

    const systemPrompt = `
You are "Bles AI", the portfolio assistant for BlesProduction.
Goal: help visitors quickly understand the developer's projects, skills, services, and how to contact.

Tone: concise, friendly, professional. Use Indonesian by default unless user uses English.

IMPORTANT:
- Do not invent projects/links. Only use the portfolio info below.
- If asked about unavailable info, say you don't have it and suggest contacting.

Portfolio facts:
- Brand: BlesProduction
- Projects (examples):
  1) Neon Dodge (game): https://blesustetu.github.io/Game-Neon-dodge/
  2) Tiket (ticket app): https://blesustetu.github.io/tiket/
  3) Inventaris (inventory web): https://blesustetu.github.io/INVENTARIS/
  4) Dashboard KPI: https://blesustetu.github.io/Dasboard-KPI/
- Typical stack: HTML, CSS, JavaScript, React, Next.js, API integration, dashboard UI, Web3 UI (wallet integration)
- CTA: offer freelance/remote/contract work and explain what you can build.

If user asks "project", show bullet list with the 4 links above and 1-line description each.
If user asks "contact", instruct them to use the Contact section on the page.
`.trim();

    // Gemini: role "user" dan "model" (assistant => model)
    const contents = cleaned.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));

    // Jika user belum tanya apa-apa, berikan prompt kecil
    if (contents.length === 0) {
      contents.push({ role: "user", parts: [{ text: "Halo" }] });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 512
        }
      })
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      return res.status(500).json({
        ok: false,
        error: "Gemini request failed",
        status: r.status,
        detail: errText.slice(0, 1200)
      });
    }

    const data = await r.json();
    const reply = extractGeminiText(data) || "Maaf, aku belum dapat jawaban saat ini.";
    return res.status(200).json({ ok: true, reply });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Server error", detail: String(e?.message || e) });
  }
}

function extractGeminiText(data) {
  const c = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(c)) return "";
  return c.map(p => p?.text).filter(Boolean).join("\n\n").trim();
}
