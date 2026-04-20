import express from "express";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";
import fs from "fs";

const router = express.Router();
const upload = multer({ dest: "uploads/" });

// Proxy générique vers Flask — gère tous les sous-chemins (y compris pipeline/init,
// pipeline/confirm) et rend le fichier optionnel (confirm et missing n'en ont pas).
router.post("/*", upload.single("file"), async (req, res) => {
  const flaskUrl = `http://localhost:5000/api/data-cleaning${req.path}`;

  const form = new FormData();

  // Fichier présent uniquement sur /pipeline/init
  if (req.file) {
    form.append("file", fs.createReadStream(req.file.path), req.file.originalname);
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
