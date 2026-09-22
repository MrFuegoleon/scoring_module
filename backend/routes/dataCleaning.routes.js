import express from "express";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";
import fs from "fs";

const router = express.Router();
const upload = multer({ dest: "uploads/" });
const FLASK_BASE_URL = process.env.FLASK_URL || "http://localhost:5001";

// Proxy GET → Flask (ex: /pipeline/download/<type>?session_id=...)
router.get("/*", async (req, res) => {
  const flaskUrl = `${FLASK_BASE_URL}/api/data-cleaning${req.path}`;
  try {
    const response = await axios.get(flaskUrl, {
      params: req.query,
      responseType: "stream",
    });
    res.set(response.headers);
    response.data.pipe(res);
  } catch (e) {
    const status = e.response?.status || 500;
    const message = e.response?.data?.error || e.message || "Erreur interne";
    res.status(status).json({ error: message });
  }
});

// Proxy générique POST → Flask — gère tous les sous-chemins (y compris pipeline/init,
// pipeline/confirm) et rend le fichier optionnel (confirm et missing n'en ont pas).
router.post("/*", upload.single("file"), async (req, res) => {
  const flaskUrl = `${FLASK_BASE_URL}/api/data-cleaning${req.path}`;

  const form = new FormData();

  // Fichier présent uniquement sur /pipeline/init
  if (req.file) {
    form.append(
      "file",
      fs.createReadStream(req.file.path),
      req.file.originalname,
    );
  }

  // Champs texte : session_id, confirmed_types, etc.
  for (const [key, value] of Object.entries(req.body || {})) {
    form.append(key, value);
  }

  try {
    const response = await axios.post(flaskUrl, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    res.json(response.data);
  } catch (e) {
    const status = e.response?.status || 500;
    const message = e.response?.data?.error || e.message || "Erreur interne";
    res.status(status).json({ error: message });
  } finally {
    if (req.file) fs.unlink(req.file.path, () => {});
  }
});

export default router;
