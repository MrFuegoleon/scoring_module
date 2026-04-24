import express from "express";
import cors from "cors";
import multer from "multer";
import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";

// ── Routers (compartiments) ─────────────────────────────────────────────────
import dataQualityRouter   from "./routes/dataQuality.routes.js";
import dataCleaningRouter  from "./routes/dataCleaning.routes.js";
import dataModellingRouter from "./routes/dataModelling.routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;

app.use(
  cors({
    exposedHeaders: [
      "X-Report-Id",
      "X-File-Hash",
      "X-Generated-At",
      "X-From-Cache",
    ],
  }),
);
app.use(express.json());

// ── Multer (stockage temporaire uploads) ────────────────────────────────────
export const upload = multer({ dest: "uploads/" });

// ── Enregistrement des compartiments ───────────────────────────────────────
app.use("/api/data-quality",   dataQualityRouter);
app.use("/api/data-cleaning",  dataCleaningRouter);
app.use("/api/data-modelling", dataModellingRouter);

// ── Routes existantes (inchangées) ─────────────────────────────────────────
app.get("/api/test", (req, res) => {
  res.json({ message: "Backend OK", timestamp: new Date() });
});

app.get("/api/python/test", async (req, res) => {
  try {
    const response = await axios.get("http://localhost:5000/api/test");
    res.json({ message: "Python OK", pythonResponse: response.data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/analyze", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Pas de fichier" });
  try {
    const response = await axios.post("http://localhost:5000/api/analyze", {
      filepath: req.file.path,
    });
    res.json({ filename: req.file.originalname, analysis: response.data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend sur http://localhost:${PORT}`);
});
