from flask import Blueprint, request, jsonify
import pandas as pd
import numpy as np
import io
import json
from services.cleaning_service import DataCleaningService

data_cleaning_bp = Blueprint("data-cleaning", __name__)


def _load_csv(file):
    """Charge un CSV depuis un objet Flask file, retourne (df, error)."""
    try:
        content = file.read()
        if isinstance(content, bytes):
            content = content.decode('utf-8', errors='replace')
        df = pd.read_csv(io.StringIO(content))
        return df, None
    except Exception as e:
        return None, str(e)


def _safe_records(df, n=5):
    """
    Convertit les n premieres lignes en records JSON-serializables :
    - NaN  → None
    - datetime64 → string ISO
    - category   → string
    - numpy int/float → Python natif
    """
    preview = df.head(n).copy()

    for col in preview.columns:
        if pd.api.types.is_datetime64_any_dtype(preview[col]):
            preview[col] = preview[col].dt.strftime('%Y-%m-%d %H:%M:%S')
        elif str(preview[col].dtype) == 'category':
            preview[col] = preview[col].astype(str)
        elif pd.api.types.is_integer_dtype(preview[col]):
            preview[col] = preview[col].astype(object)
        elif pd.api.types.is_float_dtype(preview[col]):
            preview[col] = preview[col].astype(object)

    # NaN → None
    preview = preview.where(pd.notnull(preview), None)

    # numpy scalaires → Python natifs
    records = []
    for row in preview.to_dict(orient='records'):
        clean_row = {}
        for k, v in row.items():
            if isinstance(v, (np.integer,)):
                clean_row[k] = int(v)
            elif isinstance(v, (np.floating,)):
                clean_row[k] = None if np.isnan(v) else float(v)
            elif isinstance(v, (np.bool_,)):
                clean_row[k] = bool(v)
            else:
                clean_row[k] = v
        records.append(clean_row)

    return records


# ── /detect-types ────────────────────────────────────────────────────────────
# Analyse les types et PROPOSE sans modifier — l'utilisateur doit confirmer.
@data_cleaning_bp.route("/detect-types", methods=["POST"])
def detect_types():
    try:
        if 'file' not in request.files:
            return jsonify({"error": "Aucun fichier fourni"}), 400

        df, error = _load_csv(request.files['file'])
        if error:
            return jsonify({"error": f"Impossible de lire le CSV : {error}"}), 400

        # On travaille sur une copie — le df original n'est pas modifié
        df_copy = df.copy()
        _, detected_types, type_report = DataCleaningService.smart_type_correction(df_copy)

        return jsonify({
            "success": True,
            "detected_types": detected_types,
            "type_report": type_report,
            "statistics": {
                "rows_count": len(df),
                "cols_count": len(df.columns),
            },
        }), 200

    except Exception as e:
        return jsonify({"error": f"Erreur serveur : {str(e)}"}), 500


# ── /apply-types ──────────────────────────────────────────────────────────────
# Applique les types confirmés par l'utilisateur.
@data_cleaning_bp.route("/apply-types", methods=["POST"])
def apply_types():
    try:
        if 'file' not in request.files:
            return jsonify({"error": "Aucun fichier fourni"}), 400

        confirmed_raw = request.form.get('confirmed_types')
        if not confirmed_raw:
            return jsonify({"error": "confirmed_types manquant dans la requête"}), 400

        try:
            confirmed_types = json.loads(confirmed_raw)
        except json.JSONDecodeError:
            return jsonify({"error": "confirmed_types doit être du JSON valide"}), 400

        df, error = _load_csv(request.files['file'])
        if error:
            return jsonify({"error": f"Impossible de lire le CSV : {error}"}), 400

        df_applied, apply_report = DataCleaningService.apply_confirmed_types(df, confirmed_types)

        return jsonify({
            "success": True,
            "apply_report": apply_report,
            "statistics": {
                "rows_count": len(df_applied),
                "cols_count": len(df_applied.columns),
                "memory_usage_kb": f"{df_applied.memory_usage(deep=True).sum() / 1024:.2f}",
            },
            "preview": _safe_records(df_applied, 5),
        }), 200

    except Exception as e:
        return jsonify({"error": f"Erreur serveur : {str(e)}"}), 500


# ── /doublons ─────────────────────────────────────────────────────────────────
@data_cleaning_bp.route("/doublons", methods=["POST"])
def clean_duplicates():
    try:
        if 'file' not in request.files:
            return jsonify({"error": "Aucun fichier fourni"}), 400

        df, error = _load_csv(request.files['file'])
        if error:
            return jsonify({"error": f"Impossible de lire le CSV : {error}"}), 400

        df_cleaned, report = DataCleaningService.remove_duplicates(df)

        return jsonify({
            "success": True,
            "report": report,
            "statistics": {
                "rows_count": len(df_cleaned),
                "cols_count": len(df_cleaned.columns),
                "memory_usage_kb": f"{df_cleaned.memory_usage(deep=True).sum() / 1024:.2f}",
            },
            "preview": _safe_records(df_cleaned, 5),
        }), 200

    except Exception as e:
        return jsonify({"error": f"Erreur serveur : {str(e)}"}), 500


# ── /outliers ─────────────────────────────────────────────────────────────────
@data_cleaning_bp.route("/outliers", methods=["POST"])
def clean_outliers():
    try:
        if 'file' not in request.files:
            return jsonify({"error": "Aucun fichier fourni"}), 400

        df, error = _load_csv(request.files['file'])
        if error:
            return jsonify({"error": f"Impossible de lire le CSV : {error}"}), 400

        df_cleaned, report = DataCleaningService.detect_and_treat_outliers(df)

        return jsonify({
            "success": True,
            "report": report,
            "statistics": {
                "rows_count": len(df_cleaned),
                "cols_count": len(df_cleaned.columns),
                "memory_usage_kb": f"{df_cleaned.memory_usage(deep=True).sum() / 1024:.2f}",
            },
            "preview": _safe_records(df_cleaned, 5),
        }), 200

    except Exception as e:
        return jsonify({"error": f"Erreur serveur : {str(e)}"}), 500


# ── /missing ──────────────────────────────────────────────────────────────────
@data_cleaning_bp.route("/missing", methods=["POST"])
def clean_missing():
    try:
        if 'file' not in request.files:
            return jsonify({"error": "Aucun fichier fourni"}), 400

        df, error = _load_csv(request.files['file'])
        if error:
            return jsonify({"error": f"Impossible de lire le CSV : {error}"}), 400

        df_cleaned, report = DataCleaningService.impute_missing_values(df)

        return jsonify({
            "success": True,
            "report": report,
            "statistics": {
                "rows_count": len(df_cleaned),
                "cols_count": len(df_cleaned.columns),
                "memory_usage_kb": f"{df_cleaned.memory_usage(deep=True).sum() / 1024:.2f}",
            },
            "preview": _safe_records(df_cleaned, 5),
        }), 200

    except Exception as e:
        return jsonify({"error": f"Erreur serveur : {str(e)}"}), 500
