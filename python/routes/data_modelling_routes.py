import numpy as np
import pandas as pd
from flask import Blueprint, request, jsonify
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


# ── /modelling/init ───────────────────────────────────────────────────────────
# Vérifie que les deux datamarts sont disponibles et retourne leurs infos.
@data_modelling_bp.route('/init', methods=['POST'])
def modelling_init():
    try:
        session_id = request.form.get('session_id')
        if not session_id:
            return jsonify({"error": "session_id manquant"}), 400

        logit_sid = f'{session_id}_logit'
        tree_sid  = f'{session_id}_tree'

        if not SessionStore.exists(logit_sid) or not SessionStore.exists(tree_sid):
            return jsonify({
                "error": "Datamarts non construits — terminez le pipeline Data Cleaning (étape pipelines)"
            }), 404

        meta       = SessionStore.get_meta(session_id)
        target_col = meta.get('target_col')

        df_logit = SessionStore.get(logit_sid)
        df_tree  = SessionStore.get(tree_sid)

        def _col_kind(df, col):
            if pd.api.types.is_numeric_dtype(df[col]):
                return 'numeric'
            return 'categorical'

        return jsonify({
            "success":    True,
            "target_col": target_col,
            "logit": {
                "n_rows":  len(df_logit.dropna(subset=[target_col])),
                "n_cols":  len(df_logit.columns),
                "columns": list(df_logit.columns),
            },
            "tree": {
                "n_rows":  len(df_tree.dropna(subset=[target_col])),
                "n_cols":  len(df_tree.columns),
                "columns": list(df_tree.columns),
            },
        }), 200

    except Exception as e:
        return jsonify({"error": f"Erreur serveur : {str(e)}"}), 500


# ── /modelling/models ─────────────────────────────────────────────────────────
@data_modelling_bp.route('/models', methods=['GET'])
def get_available_models():
    from services.training_service import available_models
    return jsonify({'models': available_models()}), 200


# ── /modelling/train ──────────────────────────────────────────────────────────
@data_modelling_bp.route('/train', methods=['POST'])
def train_model():
    try:
        from services.training_service import TrainingService

        session_id   = request.form.get('session_id')
        model_type   = request.form.get('model_type')
        use_pca      = request.form.get('use_pca', 'false').lower() == 'true'
        n_comp_raw   = request.form.get('n_components')
        n_components = int(n_comp_raw) if n_comp_raw else None
    
        if not session_id or not model_type:
            return jsonify({"error": "Paramètres manquants (session_id, model_type)"}), 400

        # Détermine quel datamart utiliser
        pipeline  = 'logit' if model_type == 'logit' else 'tree'
        sid       = f'{session_id}_{pipeline}'

        if not SessionStore.exists(sid):
            return jsonify({"error": f"Datamart '{pipeline}' non trouvé — construisez les pipelines d'abord"}), 404

        df         = SessionStore.get(sid)
        meta       = SessionStore.get_meta(session_id)
        target_col = meta.get('target_col')

        if not target_col or target_col not in df.columns:
            return jsonify({"error": "Variable cible introuvable dans le datamart"}), 400

        X, y, feature_names = TrainingService.prepare_preencoded_features(df, target_col)

        pca_report = None
        if use_pca and pipeline == 'tree':
            X, pca_report = TrainingService.apply_pca(X, n_components)

        results = TrainingService.train_and_evaluate(X, y, model_type)

        response = {
            'success':       True,
            'pipeline':      pipeline,
            'model_type':    model_type,
            'target_col':    target_col,
            'results':       results,
            'feature_names': feature_names,
        }
        if pca_report:
            response['pca_report'] = pca_report

        return jsonify(response), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Erreur serveur : {str(e)}"}), 500
