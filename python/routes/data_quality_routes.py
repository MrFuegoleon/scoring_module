"""
routes/data_quality_routes.py
──────────────────────────────
Compartiment 1 — Data Quality
Endpoints exposés à Express.
"""


from flask import Blueprint, request, jsonify, Response
from services.data_quality_service import (
    load_dataframe,
    load_dataframe_from_path,
    build_quality_report,
    compute_quality_score,
    generate_profile_html,
)

data_quality_bp = Blueprint("data_quality", __name__)


# ── POST /api/data-quality/report ────────────────────────────────────────────
@data_quality_bp.route("/report", methods=["POST"])
def quality_report():
    """
    Rapport qualité complet sur un dataset uploadé.

    Accepte :
      - multipart/form-data  → champ "file" (CSV / Excel / JSON / Parquet)
      - application/json     → { "filepath": "/chemin/local" }

    Retourne :
      - overview         : infos générales du dataset
      - columns_analysis : analyse par colonne (types, manquants, outliers...)
      - quality_score    : score global + 4 dimensions
      - alerts           : liste des problèmes détectés
    """
    try:
        filename = ""

        # ── Mode upload fichier ──────────────────────────────────────────────
        if "file" in request.files:
            file     = request.files["file"]
            filename = file.filename
            df       = load_dataframe(file)

        # ── Mode filepath JSON (compatibilité existante) ─────────────────────
        elif request.is_json:
            body     = request.get_json()
            filepath = body.get("filepath", "")
            filename = filepath.split("/")[-1].split("\\")[-1]
            df       = load_dataframe_from_path(filepath)

        else:
            return jsonify({
                "error": "Fournir un fichier (multipart) ou un JSON avec 'filepath'"
            }), 400

        if df.empty:
            return jsonify({"error": "Le dataset est vide"}), 400

        report = build_quality_report(df, filename)
        return jsonify({"success": True, **report}), 200

    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Erreur interne : {str(e)}"}), 500


# ── POST /api/data-quality/profile ───────────────────────────────────────────
@data_quality_bp.route("/profile", methods=["POST"])
def profile_report():
    """
    Génère et retourne le rapport HTML ydata_profiling brut.
    Retourne : text/html (pas du JSON)
    """
    try:
        if "file" in request.files:
            file  = request.files["file"]
            df    = load_dataframe(file)
            title = file.filename
        elif request.is_json:
            body  = request.get_json()
            df    = load_dataframe_from_path(body.get("filepath", ""))
            title = body.get("filepath", "").split("/")[-1]
        else:
            return jsonify({"error": "Données manquantes"}), 400

        if df.empty:
            return jsonify({"error": "Dataset vide"}), 400

        theme = request.form.get("theme", "dark")
        html = generate_profile_html(df, title=f"Profiling — {title}", theme=theme)
        return Response(html, mimetype="text/html", status=200)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── POST /api/data-quality/score ─────────────────────────────────────────────
@data_quality_bp.route("/score", methods=["POST"])
def quality_score_only():
    """
    Retourne uniquement le score qualité (plus léger que /report).
    """
    try:
        if "file" in request.files:
            df = load_dataframe(request.files["file"])
        elif request.is_json:
            body = request.get_json()
            df   = load_dataframe_from_path(body.get("filepath", ""))
        else:
            return jsonify({"error": "Données manquantes"}), 400

        score = compute_quality_score(df)
        return jsonify({"success": True, **score}), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── POST /api/data-quality/preview ───────────────────────────────────────────
@data_quality_bp.route("/preview", methods=["POST"])
def preview():
    """
    Aperçu rapide du dataset : shape, colonnes, sample, types.
    """
    try:
        if "file" in request.files:
            file     = request.files["file"]
            df       = load_dataframe(file)
            filename = file.filename
        elif request.is_json:
            body     = request.get_json()
            filepath = body.get("filepath", "")
            df       = load_dataframe_from_path(filepath)
            filename = filepath.split("/")[-1]
        else:
            return jsonify({"error": "Données manquantes"}), 400

        try:
            n = int(request.args.get("n", 10))
        except (ValueError, TypeError):
            n = 10

        return jsonify({
            "success":  True,
            "filename": filename,
            "shape":    {"rows": int(df.shape[0]), "columns": int(df.shape[1])},
            "columns":  df.columns.tolist(),
            "dtypes":   df.dtypes.astype(str).to_dict(),
            "sample":   df.head(n).fillna("").to_dict(orient="records"),
            "missing_summary": df.isnull().sum().to_dict(),
        }), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500
