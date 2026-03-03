import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
const port = process.env.PORT || 10000;

// -----------------------------
// Environment Variables
// -----------------------------
const openai = new OpenAI({
  apiKey: process.env.ConcussionAIKey
});

const MODEL = process.env.MODEL || "gpt-4.1-mini";

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : [];

// -----------------------------
// Middleware
// -----------------------------
app.use(express.json());

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // allow server-to-server or curl

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    }
  })
);

// -----------------------------
// Health Check Route
// -----------------------------
app.get("/", (req, res) => {
  res.json({ ok: true, service: "concussion-ai-proxy" });
});

// -----------------------------
// Evaluation Route
// -----------------------------
app.post("/evaluate", async (req, res) => {
  try {
    const { response } = req.body;

    if (!response) {
      return res.status(400).json({ error: "Missing response text." });
    }

    const aiResponse = await openai.responses.create({
      model: MODEL,
      input: `
You are grading a short-answer reflection.

Use the rubric below:

5 = Thorough, accurate, safety-focused, clearly reasoned.
4 = Mostly accurate, good reasoning, minor gaps.
3 = Basic understanding but lacks depth.
2 = Limited understanding or unclear reasoning.
1 = Incorrect or unsafe response.

Provide constructive feedback in 3–5 sentences maximum.

Return ONLY valid JSON in this exact format:
{"score": number, "feedback": "string"}

Student Response:
${response}
`
    });

    const textOutput = aiResponse.output[0].content[0].text;

    let parsed;

    try {
      parsed = JSON.parse(textOutput);
    } catch (parseError) {
      console.error("JSON parse error:", textOutput);
      return res.status(500).json({ error: "Invalid AI JSON format." });
    }

    res.json(parsed);
  } catch (error) {
    console.error("Evaluation error:", error);
    res.status(500).json({ error: "Evaluation failed." });
  }
});

// -----------------------------
// Start Server
// -----------------------------
app.listen(port, () => {
  console.log(`Server running on ${port}`);
});      body: JSON.stringify({
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

    // Parse structured output safely
    let parsed;
    try {
      parsed = JSON.parse(data.output_text);
    } catch {
      return res.status(500).json({
        error: "Model returned invalid JSON",
        raw: data.output_text
      });
    }

    // Extra server-side safety checks
    if (
      typeof parsed.score !== "number" ||
      parsed.score < 0 ||
      parsed.score > 4
    ) {
      parsed.score = 0;
    }

    if (typeof parsed.narrative !== "string") {
      parsed.narrative =
        "Thanks for your response. In this situation, the safest action is to stop playing and report symptoms immediately.";
    }

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
