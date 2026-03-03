import express from "express";
import cors from "cors";

const app = express();
app.use(express.json({ limit: "200kb" }));

// --------------------------------------------------
// CORS SETUP (Uses ALLOWED_ORIGINS env variable)
// --------------------------------------------------
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("CORS blocked: " + origin));
  }
}));

// --------------------------------------------------
// HEALTH CHECK
// --------------------------------------------------
app.get("/", (req, res) => {
  res.json({ ok: true, service: "concussion-ai-proxy" });
});

// --------------------------------------------------
// TEMP TEST ROUTE (Simple browser test)
// --------------------------------------------------
app.get("/test", async (req, res) => {
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.MODEL,
        input: "Explain why stopping play after concussion symptoms is important in 2 short sentences."
      })
    });

    const data = await response.json();
    res.json(data);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --------------------------------------------------
// REAL AI EVALUATION ROUTE
// --------------------------------------------------
app.post("/evaluate", async (req, res) => {
  try {
    const { learnerResponse } = req.body;

    if (!learnerResponse || typeof learnerResponse !== "string") {
      return res.status(400).json({ error: "Missing learnerResponse" });
    }

    const rubric = `
You are evaluating a student athlete’s response to a concussion scenario.

Best decision:
Stop playing immediately, report symptoms to a coach or athletic trainer,
and seek medical evaluation. Continuing play risks serious harm.

Score 0-4:

4 = Clearly stop play + report + medical evaluation + strong safety reasoning
3 = Stop/report but explanation is limited
2 = Mixed or uncertain response
1 = Minimizes symptoms or suggests waiting
0 = Encourages continuing play

Return STRICT JSON only:

{
  "score": number (0-4),
  "narrative": "3-5 short supportive sentences max"
}
`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.MODEL,
        input: [
          { role: "system", content: rubric },
          { role: "user", content: learnerResponse }
        ],
        max_output_tokens: 200,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "concussion_feedback",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                score: { type: "integer", minimum: 0, maximum: 4 },
                narrative: { type: "string" }
              },
              required: ["score", "narrative"]
            }
          }
        }
      })
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(500).json({ error: "OpenAI error", detail: text });
    }

    const data = await response.json();
    const parsed = JSON.parse(data.output_text);

    res.json(parsed);

  } catch (error) {
    res.status(500).json({
      error: "Server error",
      detail: error.message
    });
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log("Server running on", port));
