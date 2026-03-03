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
      if (!origin) return callback(null, true);

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
// MAIN Evaluation Route (POST)
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

Use this rubric:

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
// SIMPLE BROWSER TEST ROUTE (GET)
// -----------------------------
app.get("/test-evaluate", async (req, res) => {
  try {
    const sampleResponse =
      "I would remove the player from the game and monitor symptoms before allowing a return.";

    const aiResponse = await openai.responses.create({
      model: MODEL,
      input: `
Score this response from 1–5 using the concussion safety rubric.
Provide 3–5 sentences of feedback.
Return ONLY valid JSON:
{"score": number, "feedback": "string"}

Response:
${sampleResponse}
`
    });

    const textOutput = aiResponse.output[0].content[0].text;
    const parsed = JSON.parse(textOutput);

    res.json(parsed);

  } catch (error) {
    console.error("Test route error:", error);
    res.status(500).json({ error: "Test failed." });
  }
});

// -----------------------------
// Start Server
// -----------------------------
app.listen(port, () => {
  console.log(`Server running on ${port}`);
});
