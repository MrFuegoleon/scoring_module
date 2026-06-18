from flask import Blueprint, request, jsonify, send_file
import pandas as pd
import numpy as np
import io
import json
from services.cleaning_service import DataCleaningService
from services.session_store import SessionStore
from services.modelling_service import ModellingService
from services.pipeline_service import PipelineService

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

    preview = preview.where(pd.notnull(preview), None)

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


# ── /pipeline/init ────────────────────────────────────────────────────────────
# Upload du CSV + toutes les détections en une seule requête.
# Crée la session et retourne les rapports d'analyse (sans modifier les données).
@data_cleaning_bp.route("/pipeline/init", methods=["POST"])
def pipeline_init():
    try:
        if 'file' not in request.files:
            return jsonify({"error": "Aucun fichier fourni"}), 400

        df, error = _load_csv(request.files['file'])
        if error:
            return jsonify({"error": f"Impossible de lire le CSV : {error}"}), 400

        # Stocker le dataframe brut en session
        session_id = SessionStore.create(df)

        # Détection des types (sur copie — ne modifie pas la session)
        df_copy = df.copy()
        _, detected_types, type_report = DataCleaningService.smart_type_correction(df_copy)

        # Détection des doublons (read-only)
        doublons_report = DataCleaningService.detect_duplicates(df)

        # Détection des outliers (read-only — sur le df brut car les types
        # ne sont pas encore appliqués, mais les colonnes numériques existantes
        # sont quand même analysées)
        outliers_report = DataCleaningService.detect_outliers(df_copy)

        target_candidates = ModellingService.detect_target_candidates(df)

        return jsonify({
            "success":           True,
            "session_id":        session_id,
            "detected_types":    detected_types,
            "type_report":       type_report,
            "doublons_report":   doublons_report,
            "outliers_report":   outliers_report,
            "target_candidates": target_candidates,
            "statistics": {
                "rows_count": len(df),
                "cols_count": len(df.columns),
            },
        }), 200

    except Exception as e:
        return jsonify({"error": f"Erreur serveur : {str(e)}"}), 500


# ── /pipeline/confirm ─────────────────────────────────────────────────────────
# Applique les 3 transformations dans l'ordre :
#   1. Types confirmés par l'utilisateur
#   2. Suppression des doublons
#   3. Winsorisation des outliers (IQR)
# Met à jour la session pour que l'étape suivante (imputation) parte
# du dataframe déjà nettoyé.
@data_cleaning_bp.route("/pipeline/confirm", methods=["POST"])
def pipeline_confirm():
    try:
        session_id = request.form.get('session_id')
        if not session_id:
            return jsonify({"error": "session_id manquant"}), 400

        if not SessionStore.exists(session_id):
            return jsonify({"error": "Session introuvable ou expirée — relancez le pipeline"}), 404

        confirmed_raw = request.form.get('confirmed_types')
        if not confirmed_raw:
            return jsonify({"error": "confirmed_types manquant"}), 400

        try:
            confirmed_types = json.loads(confirmed_raw)
        except json.JSONDecodeError:
            return jsonify({"error": "confirmed_types doit être du JSON valide"}), 400

        # Stratégie outliers choisie par l'utilisateur ('drop' | 'winsorise')
        outlier_strategy = request.form.get('outlier_strategy', 'drop')
        if outlier_strategy not in ('drop', 'winsorise'):
            outlier_strategy = 'drop'

        df = SessionStore.get(session_id)

        # ── Étape 1 : application des types ──────────────────────────────────
        df, types_apply_report = DataCleaningService.apply_confirmed_types(df, confirmed_types)

        # ── Étape 2 : suppression des doublons ───────────────────────────────
        user_pk_column = request.form.get('user_pk_column') or None
        df, doublons_apply_report = DataCleaningService.remove_duplicates(df, user_pk_column=user_pk_column)

        # ── Étape 3 : traitement des outliers (stratégie utilisateur) ────────
        df, outliers_apply_report = DataCleaningService.apply_outlier_strategy(df, outlier_strategy)

        # Sauvegarder le df nettoyé pour la prochaine étape (imputation)
        SessionStore.update(session_id, df)

        return jsonify({
            "success": True,
            "types_result": {
                "apply_report": types_apply_report,
                "statistics": {
                    "rows_count":       len(df),
                    "cols_count":       len(df.columns),
                    "memory_usage_kb":  f"{df.memory_usage(deep=True).sum() / 1024:.2f}",
                },
            },
            "doublons_result": {
                "report": doublons_apply_report,
            },
            "outliers_result": {
                "report": outliers_apply_report,
            },
            "final_statistics": {
                "rows_count":      len(df),
                "cols_count":      len(df.columns),
                "memory_usage_kb": f"{df.memory_usage(deep=True).sum() / 1024:.2f}",
            },
            "preview": _safe_records(df, 5),
        }), 200

    except Exception as e:
        return jsonify({"error": f"Erreur serveur : {str(e)}"}), 500


# ── /missing/detect ───────────────────────────────────────────────────────────
# Analyse les valeurs manquantes sans modifier le df de session.
# Retourne le rapport + stratégie proposée par colonne.
@data_cleaning_bp.route("/missing/detect", methods=["POST"])
def missing_detect():
    try:
        session_id = request.form.get('session_id')
        if not session_id:
            return jsonify({"error": "session_id manquant"}), 400
        if not SessionStore.exists(session_id):
            return jsonify({"error": "Session introuvable ou expirée — relancez le pipeline"}), 404

        df     = SessionStore.get(session_id)
        report = DataCleaningService.detect_missing(df)

        total_missing_cols = len(report)
        total_missing_vals = sum(r['missing_count'] for r in report.values())

        return jsonify({
            "success":             True,
            "missing_report":      report,
            "total_missing_cols":  total_missing_cols,
            "total_missing_vals":  total_missing_vals,
            "statistics": {
                "rows_count": len(df),
                "cols_count": len(df.columns),
            },
        }), 200

    except Exception as e:
        return jsonify({"error": f"Erreur serveur : {str(e)}"}), 500


# ── /missing/apply ────────────────────────────────────────────────────────────
# Applique les stratégies confirmées par l'utilisateur.
# Met à jour la session → pipeline 4/4 terminé.
@data_cleaning_bp.route("/missing/apply", methods=["POST"])
def missing_apply():
    try:
        session_id = request.form.get('session_id')
        if not session_id:
            return jsonify({"error": "session_id manquant"}), 400
        if not SessionStore.exists(session_id):
            return jsonify({"error": "Session introuvable ou expirée — relancez le pipeline"}), 404

        strategies_raw = request.form.get('confirmed_strategies')
        if not strategies_raw:
            return jsonify({"error": "confirmed_strategies manquant"}), 400

        try:
            confirmed_strategies = json.loads(strategies_raw)
        except json.JSONDecodeError:
            return jsonify({"error": "confirmed_strategies doit être du JSON valide"}), 400

        create_indicators = request.form.get('create_indicators', 'false').lower() == 'true'

        df = SessionStore.get(session_id)
        df_clean, report = DataCleaningService.impute_missing_values(df, confirmed_strategies, create_indicators=create_indicators)

        SessionStore.update(session_id, df_clean)

        return jsonify({
            "success":  True,
            "report":   report,
            "final_statistics": {
                "rows_count":      len(df_clean),
                "cols_count":      len(df_clean.columns),
                "memory_usage_kb": f"{df_clean.memory_usage(deep=True).sum() / 1024:.2f}",
            },
            "preview": _safe_records(df_clean, 5),
        }), 200

    except Exception as e:
        return jsonify({"error": f"Erreur serveur : {str(e)}"}), 500


# ── /pipeline/build ───────────────────────────────────────────────────────────
# Construit les deux datamarts (logit + tree) à partir du df nettoyé en session.
@data_cleaning_bp.route("/pipeline/build", methods=["POST"])
def pipeline_build():
    try:
        session_id    = request.form.get('session_id')
        target_col    = request.form.get('target_col')
        n_bins        = int(request.form.get('n_bins', 10))
        cardinality   = int(request.form.get('cardinality_threshold', 10))
        smoothing     = float(request.form.get('smoothing', 0.2))
        excl_raw      = request.form.get('excluded_cols')
        excluded_cols = json.loads(excl_raw) if excl_raw else []

        if not session_id or not target_col:
            return jsonify({'error': 'session_id et target_col requis'}), 400
        if not SessionStore.exists(session_id):
            return jsonify({'error': 'Session introuvable — relancez le pipeline'}), 404

        df = SessionStore.get(session_id)
        if target_col not in df.columns:
            return jsonify({'error': f'Colonne {target_col} introuvable'}), 400

        # Supprimer les colonnes exclues (sauf la cible)
        cols_to_drop = [c for c in excluded_cols if c in df.columns and c != target_col]
        if cols_to_drop:
            df = df.drop(columns=cols_to_drop)
            # Mise à jour du df brut en session pour que le chemin split utilise le même périmètre
            SessionStore.set(session_id, df)

        df_logit, logit_summary = PipelineService.build_logit_pipeline(df, target_col, n_bins)
        df_tree,  tree_summary  = PipelineService.build_tree_pipeline(df, target_col, cardinality, smoothing)

        SessionStore.set(f'{session_id}_logit', df_logit)
        SessionStore.set(f'{session_id}_tree',  df_tree)
        SessionStore.set_meta(session_id, {'target_col': target_col})
        # Invalide les splits encodés en cache (le périmètre des features a pu changer)
        SessionStore.cache_clear_prefix(session_id)

        return jsonify({
            'success':       True,
            'target_col':    target_col,
            'logit_summary': logit_summary,
            'tree_summary':  tree_summary,
            'logit_preview': _safe_records(df_logit, 8),
            'tree_preview':  _safe_records(df_tree,  8),
        }), 200

    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': f'Erreur serveur : {str(e)}'}), 500


# ── /pipeline/download/<type> ─────────────────────────────────────────────────
# Retourne le datamart (logit | tree) en CSV téléchargeable.
@data_cleaning_bp.route("/pipeline/download/<pipeline_type>", methods=["GET"])
def pipeline_download(pipeline_type):
    session_id = request.args.get('session_id')
    if not session_id:
        return jsonify({'error': 'session_id requis'}), 400
    if pipeline_type not in ('logit', 'tree'):
        return jsonify({'error': 'pipeline_type doit être logit ou tree'}), 400

    sid = f'{session_id}_{pipeline_type}'
    if not SessionStore.exists(sid):
        return jsonify({'error': "Datamart non trouvé — construisez d'abord les pipelines"}), 404

    df  = SessionStore.get(sid)
    buf = io.BytesIO()
    df.to_csv(buf, index=False)
    buf.seek(0)

    return send_file(
        buf,
        mimetype='text/csv',
        as_attachment=True,
        download_name=f'datamart_{pipeline_type}_{session_id[:8]}.csv',
    )
