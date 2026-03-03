// server.js
import express from "express";
import cors from "cors";

const app = express();

// ---- Config (Environment Variables) ----
const PORT = process.env.PORT || 10000;

// Prefer OPENAI_API_KEY, but allow your earlier name as a fallback
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.ConcussionAIKey;

// Model can be overridden in Render env vars
const MODEL = process.env.MODEL || "gpt-4.1-mini";

// Comma-separated list in Render env var: ALLOWED_ORIGINS
const ALLOWED_ORIGINS_RAW = process.env.ALLOWED_ORIGINS || "";
const ALLOWED_ORIGINS = ALLOWED_ORIGINS_RAW
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// ---- Middleware ----
app.use(express.json({ limit: "200kb" }));

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow same-origin / server-to-server / tools with no origin header
      if (!origin) return callback(null, true);

      // If you haven't set ALLOWED_ORIGINS, allow none (safer default)
      if (ALLOWED_ORIGINS.length === 0) return callback(new Error("CORS blocked"));

      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);

      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

// Helpful for preflight checks
app.options("*", cors());

// ---- Rubric + JSON schema (strict) ----
const EVAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "integer", minimum: 0, maximum: 4 },
    narrative: { type: "string" }
  },
  required: ["score", "narrative"]
};

const RUBRIC_TEXT = `
Score 0–4 based on how well the learner response demonstrates safe concussion decision-making.

Give 1 point each if the learner:
1) Removes self/athlete from play immediately or stops activity.
2) Reports symptoms to appropriate authority (coach/AT/medical staff) and does not hide it.
3) Mentions evaluation/medical clearance + following protocol before return-to-play.
4) Explains risk rationale (e.g., second impact syndrome, worsening symptoms, long-term harm).

Scoring:
- 0 = none of the above / unsafe advice
- 1 = one item
- 2 = two items
- 3 = three items
- 4 = all four items

Narrative: 2–5 short sentences max. Supportive tone. If missing items, say what to add.
Do NOT include markdown, bullets, or extra keys. Output must match JSON schema exactly.
`.trim();

// ---- Routes ----

// Health check
app.get("/", (req, res) => {
  res.json({ ok: true, service: "concussion-ai-proxy" });
});

// Simple test route (no console needed)
app.get("/test-evaluate", async (req, res) => {
  try {
    const sample = "I would stop playing right away, tell the coach, and get checked out before returning.";
    const result = await evaluateResponse(sample);
    res.json({ test_ok: true, sample_input: sample, result });
  } catch (err) {
    res.status(500).json({
      test_ok: false,
      error: "Server error",
      details: err?.message || String(err)
    });
  }
});

// Real endpoint for Storyline
// Expect body: { "response": "learner text here" }
app.post("/evaluate", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({
        error: "Missing API key",
        details: "Set OPENAI_API_KEY (or ConcussionAIKey) in Render Environment."
      });
    }

    const learnerText = String(req.body?.response || "").trim();

    if (!learnerText) {
      return res.status(400).json({
        error: "Missing response",
        details: "POST JSON body must include { response: \"...\" }"
      });
    }

    const result = await evaluateResponse(learnerText);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: "Server error",
      details: err?.message || String(err)
    });
  }
});

// ---- Core evaluator using Responses API ----
async function evaluateResponse(learnerText) {
  const systemPrompt = `You are an evaluator for a concussion safety training scenario.\n\n${RUBRIC_TEXT}`;

  const payload = {
    model: MODEL,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Learner response:\n${learnerText}` }
    ],
    // IMPORTANT: Responses API uses text.format (not response_format)
    text: {
      format: {
        type: "json_schema",
        name: "ConcussionEvaluation",
        strict: true,
        schema: EVAL_SCHEMA
      }
    },
    // keep it short & fast
    max_output_tokens: 180
  };

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`OpenAI error (${r.status}): ${errText}`);
  }

  const data = await r.json();

  // Responses API typically returns the text in: output[0].content[0].text
  const textOut =
    data?.output?.[0]?.content?.find(c => c.type === "output_text")?.text
    ?? data?.output_text; // fallback

  if (!textOut) {
    throw new Error("No output_text returned from OpenAI.");
  }

  // Because we forced JSON schema output, this should parse cleanly
  const parsed = JSON.parse(textOut);

  // Extra safety: clamp score
  parsed.score = Math.max(0, Math.min(4, Number(parsed.score)));

  return parsed;
}

// ---- Start server ----
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(", ") || "(none set)"}`);
  console.log(`Model: ${MODEL}`);
});
