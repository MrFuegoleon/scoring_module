import express from "express";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";

const router = express.Router();
const upload = multer();
const FLASK_BASE_URL = process.env.FLASK_URL || "http://localhost:5001";

router.post("/*", upload.none(), async (req, res) => {
  const flaskUrl = `${FLASK_BASE_URL}/api/multilabel${req.path}`;

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
