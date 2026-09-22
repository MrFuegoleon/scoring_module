import express from "express";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";

const router = express.Router();
const upload = multer();
const FLASK_BASE_URL = process.env.FLASK_URL || "http://localhost:5001";

// Proxy générique GET vers Flask
router.get("/*", async (req, res) => {
  const flaskUrl = `${FLASK_BASE_URL}/api/data-modelling${req.path}`;
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

// Proxy générique POST vers Flask — tous les sous-chemins (woe/compute, init, train, etc.)
router.post("/*", upload.none(), async (req, res) => {
  const flaskUrl = `${FLASK_BASE_URL}/api/data-modelling${req.path}`;

  const form = new FormData();
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
  }
});

export default router;
