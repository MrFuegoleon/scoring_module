import json
import numpy as np
from flask import Blueprint, request, jsonify
from services.session_store import SessionStore
from services.multilabel_service import detect_targets, train_multilabel

multilabel_bp = Blueprint('multilabel', __name__)


class _SafeEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)


def _jsonify(data, status=200):
    return json.dumps(data, cls=_SafeEncoder), status, {'Content-Type': 'application/json'}


# ── /multilabel/detect-targets ───────────────────────────────────────────────
@multilabel_bp.route('/detect-targets', methods=['POST'])
def detect_targets_route():
    try:
        session_id = request.form.get('session_id')
        if not session_id:
            return jsonify({"error": "session_id manquant"}), 400

        df = SessionStore.get(session_id)
        if df is None:
            return jsonify({"error": "Session introuvable — effectuez d'abord le Data Cleaning"}), 404

        result = detect_targets(df)
        result["success"] = True
        result["n_rows"] = len(df)
        result["n_cols"] = len(df.columns)

        return _jsonify(result)

    except Exception as e:
        return jsonify({"error": f"Erreur serveur : {str(e)}"}), 500


# ── /multilabel/train ─────────────────────────────────────────────────────────
@multilabel_bp.route('/train', methods=['POST'])
def train_route():
    try:
        session_id  = request.form.get('session_id')
        targets_raw = request.form.get('target_cols', '')
        model_type  = request.form.get('model_type', 'random_forest')
        strategy    = request.form.get('strategy', 'multioutput')

        if not session_id:
            return jsonify({"error": "session_id manquant"}), 400

        target_cols = [c.strip() for c in targets_raw.split(',') if c.strip()]
        if not target_cols:
            return jsonify({"error": "Aucune colonne cible fournie"}), 400

        df = SessionStore.get(session_id)
        if df is None:
            return jsonify({"error": "Session introuvable"}), 404

        result = train_multilabel(df, target_cols, model_type, strategy)
        result["success"] = True

        return _jsonify(result)

    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Erreur serveur : {str(e)}"}), 500
