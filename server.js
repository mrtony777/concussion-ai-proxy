import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());

app.use(
  cors({
    origin: true, // temporary (we’ll lock down after it works)
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.get("/", (req, res) => {
  res.json({ ok: true, service: "concussion-ai-proxy" });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on ${port}`));
