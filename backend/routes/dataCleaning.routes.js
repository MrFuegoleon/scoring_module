import express from "express";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";
import fs from "fs";

const router = express.Router();

const task = {
  types: "Correction des types de données",
  doublons: "Suppression des doublons",
  outliers: "Détection et traitement des outliers",
  missing: "Imputation des valeurs manquantes par WOE",
};

router.post(
  "/:taskKey",
  multer({ dest: "uploads/" }).single("file"),
  async (req, res) => {
    const { taskKey } = req.params;
    if (!req.file)
      return res.status(400).json({ error: "Aucun fichier fourni" });

    const form = new FormData();
    form.append(
      "file",
      fs.createReadStream(req.file.path),
      req.file.originalname,
    );
    // Transmet tous les champs texte du body vers Flask (ex: confirmed_types)
    for (const [key, value] of Object.entries(req.body || {})) {
      form.append(key, value);
    }
    try {
      const response = await axios.post(
        `http://localhost:5000/api/data-cleaning/${taskKey}`,
        form,
        {
          headers: form.getHeaders(),
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        },
      );
      res.json(response.data);
    } catch (e) {
      const status = e.response?.status || 500;
      const message = e.response?.data?.error || e.message || "Erreur interne";
      res.status(status).json({ error: message });
    } finally {
      fs.unlink(req.file.path, () => {});
    }
  },
);

export default router;
