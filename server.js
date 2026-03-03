import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(express.json({ limit: "1mb" }));

/**
 * ENV VARS REQUIRED
 * - OPENAI_API_KEY
 * - ALLOWED_ORIGINS  (comma-separated)
 * - OPENAI_MODEL     (optional)
 */
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// CORS: allow only listed origins (plus allow no-origin requests like curl)
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // Postman/curl/no-origin allowed
      if (ALLOWED_ORIGINS.length === 0) return callback(null, true); // If not set, allow all (dev)
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      return callback(new Error("CORS blocked for origin: " + origin));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

// Helpful for preflight
app.options("*", cors());

// Create OpenAI client (will error on startup if key missing)
if (!OPENAI_API_KEY) {
  console.warn(
    "WARNING: OPENAI_API_KEY is missing. /evaluate will fail until you set it in Render env vars."
  );
}
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// Health check
app.get("/", (req, res) => {
  res.json({ ok: true, service: "concussion-ai-proxy" });
});

/**
 * POST /evaluate
 * Body: { response: "learner text here" }
 * Returns strict JSON: { score, narrative, strengths[], improvements[] }
 */
app.post("/evaluate", async (req, res) => {
  try {
    const learnerResponse = (req.body?.response || "").toString().trim();

    if (!learnerResponse) {
      return res.status(400).json({
        error: "Missing required field: response",
      });
    }

    if (!OPENAI_API_KEY) {
      return res.status(500).json({
        error:
          "Server missing OPENAI_API_KEY. Add it in Render → Environment, then redeploy.",
      });
    }

    // --- Your rubric + strict output rules ---
    const rubric = `
You are an evaluator for a concussion decision scenario.
Score from 0 to 4 using this rubric:

4 = clearly removes self/athlete from play immediately, reports symptoms to medical staff/coach, mentions safety risk (second impact / worsening), and states follow-up evaluation.
3 = recommends removal + reporting, but misses one key rationale or follow-up detail.
2 = mixed/unclear; mentions symptoms but hesitates or delays reporting/removal.
1 = minimizes symptoms or suggests continuing play with weak rationale.
0 = explicitly recommends continuing play or hiding symptoms.

Output MUST be valid JSON only.
Narrative MUST be 3–5 short sentences max (keep it tight).
Do NOT include markdown, code fences, or extra keys.
`;

    // Use Structured Outputs (strict JSON schema)
    const response = await client.responses.create({
      model: OPENAI_MODEL,
      input: [
        { role: "system", content: rubric },
        {
          role: "user",
          content: `Learner response:\n${learnerResponse}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "concussion_eval",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              score: { type: "integer", minimum: 0, maximum: 4 },
              narrative: { type: "string" },
              strengths: {
                type: "array",
                items: { type: "string" },
                maxItems: 3,
              },
              improvements: {
                type: "array",
                items: { type: "string" },
                maxItems: 3,
              },
            },
            required: ["score", "narrative", "strengths", "improvements"],
          },
          strict: true,
        },
      },
      max_output_tokens: 250,
    });

    // Extract the JSON text
    const text = response.output_text;

    // Parse and return JSON
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      // If something weird happens, return raw for debugging
      return res.status(502).json({
        error: "Model did not return valid JSON.",
        raw: text,
      });
    }

    return res.json(parsed);
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
});

/**
 * GET /test-evaluate
 * Simple browser test (no console needed).
 * It calls /evaluate with a sample response and shows the JSON result.
 */
app.get("/test-evaluate", async (req, res) => {
  try {
    const sample = "I would stop playing immediately and tell the athletic trainer.";
    const r = await fetch(`${req.protocol}://${req.get("host")}/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response: sample }),
    });
    const data = await r.json();
    res.json({ test_ok: r.ok, result: data });
  } catch (e) {
    res.status(500).json({ test_ok: false, error: e?.message || String(e) });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Server running on", PORT));
