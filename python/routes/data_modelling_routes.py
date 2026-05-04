import json
import numpy as np
import pandas as pd
from flask import Blueprint, request, jsonify
from services.modelling_service import ModellingService
from services.session_store import SessionStore

data_modelling_bp = Blueprint('data_modelling', __name__)


def _safe_records(df: pd.DataFrame, n: int = 10) -> list:
    rows = []
    for rec in df.head(n).to_dict('records'):
        safe = {}
        for k, v in rec.items():
            if v is None or (isinstance(v, float) and (np.isnan(v) or np.isinf(v))):
                safe[k] = None
            elif pd.isnull(v):
                safe[k] = None
            elif isinstance(v, (np.integer,)):
                safe[k] = int(v)
            elif isinstance(v, (np.floating,)):
                safe[k] = round(float(v), 4)
            elif isinstance(v, pd.Timestamp):
                safe[k] = str(v)
            elif hasattr(v, 'item'):
                safe[k] = v.item()
            else:
                safe[k] = v
        rows.append(safe)
    return rows


def _col_profiles(df: pd.DataFrame) -> dict:
    total = len(df)
    profiles = {}
    for col in df.columns:
        n_missing = int(df[col].isna().sum())
        dtype_str = str(df[col].dtype)
        if pd.api.types.is_numeric_dtype(df[col]):
            kind = 'numeric'
        elif pd.api.types.is_datetime64_any_dtype(df[col]):
            kind = 'datetime'
        else:
            kind = 'categorical'
        profiles[col] = {
            "dtype":     dtype_str,
            "kind":      kind,
            "n_missing": n_missing,
            "fill_rate": round((total - n_missing) / total * 100, 1) if total > 0 else 0,
            "n_unique":  int(df[col].nunique(dropna=True)),
        }
    return profiles


# ── /modelling/init ───────────────────────────────────────────────────────────
@data_modelling_bp.route('/init', methods=['POST'])
def modelling_init():
    try:
        session_id = request.form.get('session_id')
        if not session_id:
            return jsonify({"error": "session_id manquant"}), 400
        if not SessionStore.exists(session_id):
            return jsonify({"error": "Session introuvable — terminez d'abord le Data Cleaning"}), 404

        df = SessionStore.get(session_id)
        candidates = ModellingService.detect_target_candidates(df)

        return jsonify({
            "success":           True,
            "target_candidates": candidates,
            "statistics": {
                "rows_count": len(df),
                "cols_count": len(df.columns),
            },
            "col_profiles": _col_profiles(df),
            "preview":      _safe_records(df, 10),
        }), 200

    except Exception as e:
        return jsonify({"error": f"Erreur serveur : {str(e)}"}), 500


# ── /modelling/woe/compute ────────────────────────────────────────────────────
# Calcule WOE et IV pour toutes les variables (ou un sous-ensemble).
# Les valeurs manquantes sont traitées comme un bin à part — pas d'imputation.
@data_modelling_bp.route('/woe/compute', methods=['POST'])
def compute_woe():
    try:
        session_id = request.form.get('session_id')
        target_col = request.form.get('target_col')

        if not session_id:
            return jsonify({"error": "session_id manquant"}), 400
        if not target_col:
            return jsonify({"error": "target_col manquant"}), 400
        if not SessionStore.exists(session_id):
            return jsonify({"error": "Session introuvable"}), 404

        df = SessionStore.get(session_id)

        if target_col not in df.columns:
            return jsonify({"error": f"Colonne « {target_col} » introuvable"}), 400

        feature_cols_raw = request.form.get('feature_cols')
        feature_cols = json.loads(feature_cols_raw) if feature_cols_raw else None
        n_bins = int(request.form.get('n_bins', 10))

        woe_report = ModellingService.compute_woe_iv(df, target_col, feature_cols, n_bins=n_bins)

        # Dataset transformé (aperçu 100 lignes)
        df_woe     = ModellingService.apply_woe_transform(df, target_col, woe_report, n_bins=n_bins)
        woe_preview = _safe_records(df_woe, 100)
        woe_columns = list(df_woe.columns)

        # Résumé de distribution IV
        iv_summary = {"Inutile": 0, "Faible": 0, "Moyen": 0, "Fort": 0, "Suspect": 0}
        for info in woe_report.values():
            iv_summary[info["iv_label"]] = iv_summary.get(info["iv_label"], 0) + 1

        return jsonify({
            "success":     True,
            "target_col":  target_col,
            "woe_report":  woe_report,
            "n_features":  len(woe_report),
            "iv_summary":  iv_summary,
            "woe_preview": woe_preview,
            "woe_columns": woe_columns,
        }), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Erreur serveur : {str(e)}"}), 500
