/**
 * routes/dataQuality.routes.js
 * ─────────────────────────────
 * Compartiment 1 — Data Quality
 * Proxy entre React et Flask /api/data-quality/*
 */

import express from "express";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";
import fs from "fs";

const router = express.Router();
const upload = multer({ dest: "uploads/" });
const FLASK_URL = "http://localhost:5000";

// ── Helper : forwarder un fichier local vers Flask ──────────────────────────
async function forwardFileToFlask(flaskEndpoint, filePath, originalName) {
  const form = new FormData();
  form.append("file", fs.createReadStream(filePath), originalName);

  try {
    const response = await axios.post(`${FLASK_URL}${flaskEndpoint}`, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    return response.data;
  } finally {
    // Nettoyage garanti même en cas d'erreur
    fs.unlink(filePath, () => {});
  }
}

// ── Helper : réponse d'erreur uniforme ─────────────────────────────────────
function handleError(res, error) {
  const status = error.response?.status || 500;
  const message =
    error.response?.data?.error || error.message || "Erreur interne";
  return res.status(status).json({ success: false, error: message });
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/data-quality/preview
// Aperçu rapide : shape, colonnes, sample
// ══════════════════════════════════════════════════════════════════════════════
router.post("/preview", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Aucun fichier fourni" });

  try {
    const n = parseInt(req.query.n, 10) || 10;
    const data = await forwardFileToFlask(
      `/api/data-quality/preview?n=${n}`,
      req.file.path,
      req.file.originalname,
    );
    res.json(data);
  } catch (e) {
    handleError(res, e);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/data-quality/score
// Score qualité uniquement (léger, sans analyse complète)
// ══════════════════════════════════════════════════════════════════════════════
router.post("/score", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Aucun fichier fourni" });

  try {
    const data = await forwardFileToFlask(
      "/api/data-quality/score",
      req.file.path,
      req.file.originalname,
    );
    res.json(data);
  } catch (e) {
    handleError(res, e);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/data-quality/report
// Rapport qualité complet (overview + colonnes + score + alertes)
// Accepte : file (requis), descriptionFile (optionnel), description (texte optionnel)
// ══════════════════════════════════════════════════════════════════════════════
router.post(
  "/report",
  upload.fields([{ name: "file", maxCount: 1 }, { name: "descriptionFile", maxCount: 1 }]),
  async (req, res) => {
    const file = req.files?.["file"]?.[0];
    if (!file) return res.status(400).json({ error: "Aucun fichier fourni" });

    // Nettoyage du fichier description (non utilisé par Flask /report)
    const descFile = req.files?.["descriptionFile"]?.[0];

    try {
      const data = await forwardFileToFlask(
        "/api/data-quality/report",
        file.path,
        file.originalname,
      );
      if (descFile) fs.unlink(descFile.path, () => {});
      res.json(data);
    } catch (e) {
      if (descFile) fs.unlink(descFile.path, () => {});
      handleError(res, e);
    }
  },
);

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/data-quality/llm-analyze
// LLM analysis (proxy vers Flask)
// Accepte : file (requis), description (texte optionnel — enrichit le prompt LLM)
// ══════════════════════════════════════════════════════════════════════════════
router.post(
  "/llm-analyze",
  upload.fields([{ name: "file", maxCount: 1 }, { name: "descriptionFile", maxCount: 1 }]),
  async (req, res) => {
    const file = req.files?.["file"]?.[0];
    if (!file) return res.status(400).json({ error: "Aucun fichier fourni" });

    const descFile = req.files?.["descriptionFile"]?.[0];

    try {
      const form = new FormData();
      form.append("file", fs.createReadStream(file.path), file.originalname);
      if (req.body.description) form.append("description", req.body.description);
      if (descFile) form.append("descriptionFile", fs.createReadStream(descFile.path), descFile.originalname);

      const response = await axios.post(
        `${FLASK_URL}/api/data-quality/llm-analyze`,
        form,
        { headers: form.getHeaders(), maxContentLength: Infinity, maxBodyLength: Infinity },
      );
      fs.unlink(file.path, () => {});
      if (descFile) fs.unlink(descFile.path, () => {});
      res.json(response.data);
    } catch (e) {
      fs.unlink(file?.path, () => {});
      if (descFile) fs.unlink(descFile?.path, () => {});
      handleError(res, e);
    }
  },
);

/**
 * Ajouter dans routes/dataQuality.routes.js
 * ──────────────────────────────────────────
 * Proxy vers Flask /api/data-quality/profile
 * Retourne le HTML brut à React (pas du JSON).
 */

// ── POST /api/data-quality/profile ───────────────────────────────────────────
router.post("/profile", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Aucun fichier fourni" });

  try {
    const form = new FormData();
    form.append(
      "file",
      fs.createReadStream(req.file.path),
      req.file.originalname,
    );

    const response = await axios.post(
      `${FLASK_URL}/api/data-quality/profile`,
      form,
      {
        headers: form.getHeaders(),
        // Important : récupérer la réponse comme texte brut (pas JSON)
        responseType: "text",
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        // Le rapport peut être lourd, augmenter le timeout
        timeout: 300_000, // 5min — minimal mode est rapide mais on garde de la marge
      },
    );

    // Nettoyage fichier temp
    fs.unlink(req.file.path, () => {});

    // Renvoyer le HTML brut à React
    res.setHeader("Content-Type", "text/html");
    res.send(response.data);
  } catch (e) {
    fs.unlink(req.file?.path, () => {});
    // responseType:"text" → e.response.data est une string, pas un objet
    let msg = e.message;
    if (e.response?.data) {
      try {
        msg = JSON.parse(e.response.data)?.error || msg;
      } catch {}
    }
    res.status(500).json({ error: msg });
  }
});

export default router;
