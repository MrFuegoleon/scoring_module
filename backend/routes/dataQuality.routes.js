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

import {
  computeFileHash,
  saveReport,
  getReportsByHash,
  getReportHtml,
  deleteReport,
} from "../services/reportStore.js";

const router = express.Router();
const upload = multer({ dest: "uploads/" });
const FLASK_URL = "http://localhost:5001";

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
// ══════════════════════════════════════════════════════════════════════════════
router.post("/preview", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Aucun fichier fourni" });

  try {
    const n = parseInt(req.body.n_rows, 10) || 10;
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
// ══════════════════════════════════════════════════════════════════════════════
router.post(
  "/report",
  upload.fields([{ name: "file", maxCount: 1 }]),
  async (req, res) => {
    const file = req.files?.["file"]?.[0];
    if (!file) return res.status(400).json({ error: "Aucun fichier fourni" });

    try {
      const data = await forwardFileToFlask(
        "/api/data-quality/report",
        file.path,
        file.originalname,
      );
      res.json(data);
    } catch (e) {
      if (file) fs.unlink(file.path, () => {});
      handleError(res, e);
    }
  },
);

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/data-quality/profile
// Génère (ou sert depuis cache) le rapport ydata_profiling HTML.
// Retourne le HTML brut + headers X-Report-Id, X-File-Hash, X-Generated-At.
// ══════════════════════════════════════════════════════════════════════════════
router.post("/profile", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Aucun fichier fourni" });

  const filePath = req.file.path;
  const originalName = req.file.originalname;

  try {
    // 1. Hash du fichier uploadé
    const fileHash = computeFileHash(filePath);

    // 2. Cache hit ? — ignoré si force=true (l'utilisateur veut une nouvelle génération)
    const force = req.query.force === "true" || req.body.force === "true";
    const cached = getReportsByHash(fileHash);
    if (!force && cached.length > 0) {
      const html = getReportHtml(cached[0].id);
      if (html) {
        fs.unlink(filePath, () => {});
        res.setHeader("Content-Type", "text/html");
        res.setHeader("X-Report-Id", cached[0].id);
        res.setHeader("X-File-Hash", fileHash);
        res.setHeader("X-Generated-At", cached[0].generated_at);
        res.setHeader("X-From-Cache", "true");
        return res.send(html);
      }
    }

    // 3. Pas de cache — générer via Flask
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath), originalName);
    const theme = req.body.theme || "dark";
    form.append("theme", theme);

    const response = await axios.post(
      `${FLASK_URL}/api/data-quality/profile`,
      form,
      {
        headers: form.getHeaders(),
        responseType: "text",
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 300_000,
      },
    );

    fs.unlink(filePath, () => {});

    const html = response.data;

    // 4. Sauvegarder sur disque
    const { id, generated_at } = saveReport(fileHash, originalName, html);

    // 5. Renvoyer le HTML avec métadonnées
    res.setHeader("Content-Type", "text/html");
    res.setHeader("X-Report-Id", id);
    res.setHeader("X-File-Hash", fileHash);
    res.setHeader("X-Generated-At", generated_at);
    res.setHeader("X-From-Cache", "false");
    res.send(html);
  } catch (e) {
    fs.unlink(filePath, () => {});
    let msg = e.message;
    if (e.response?.data) {
      try {
        msg = JSON.parse(e.response.data)?.error || msg;
      } catch {}
    }
    res.status(500).json({ error: msg });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/data-quality/reports?file_hash=<hash>
// Liste les rapports sauvegardés pour un dataset donné (par hash).
// ══════════════════════════════════════════════════════════════════════════════
router.get("/reports", (req, res) => {
  const { file_hash } = req.query;
  if (!file_hash) return res.status(400).json({ error: "file_hash requis" });
  res.json(getReportsByHash(file_hash));
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/data-quality/reports/:id/html
// Retourne le HTML brut d'un rapport sauvegardé.
// ══════════════════════════════════════════════════════════════════════════════
router.get("/reports/:id/html", (req, res) => {
  const html = getReportHtml(req.params.id);
  if (!html) return res.status(404).json({ error: "Rapport introuvable" });
  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /api/data-quality/reports/:id
// Supprime un rapport sauvegardé.
// ══════════════════════════════════════════════════════════════════════════════
router.delete("/reports/:id", (req, res) => {
  const ok = deleteReport(req.params.id);
  if (!ok) return res.status(404).json({ error: "Rapport introuvable" });
  res.json({ success: true });
});

export default router;
