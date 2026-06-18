import express from "express";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";
import fs from "fs";

const router = express.Router();
const upload = multer({ dest: "uploads/" });

const FLASK = "http://localhost:5001/api/deployment";

// GET → Flask (list /models, /schema, /download binaire)
router.get("/*", async (req, res) => {
  try {
    const response = await axios.get(`${FLASK}${req.path}`, {
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

// DELETE → Flask
router.delete("/*", async (req, res) => {
  try {
    const response = await axios.delete(`${FLASK}${req.path}`, { params: req.query });
    res.json(response.data);
  } catch (e) {
    const status = e.response?.status || 500;
    const message = e.response?.data?.error || e.message || "Erreur interne";
    res.status(status).json({ error: message });
  }
});

// POST → Flask (export : champs seuls ; predict : fichier CSV optionnel)
router.post("/*", upload.single("file"), async (req, res) => {
  const form = new FormData();
  if (req.file) {
    form.append("file", fs.createReadStream(req.file.path), req.file.originalname);
  }
  for (const [key, value] of Object.entries(req.body || {})) {
    form.append(key, value);
  }
  try {
    const response = await axios.post(`${FLASK}${req.path}`, form, {
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
