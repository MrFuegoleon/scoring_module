"""
routes/data_quality_routes.py
──────────────────────────────
Compartiment 1 — Data Quality
Endpoints exposés à Express.
"""

import io
import pdfplumber
import docx

from flask import Blueprint, request, jsonify, Response
from services.data_quality_service import (
    load_dataframe,
    load_dataframe_from_path,
    build_quality_report,
    compute_quality_score,
    generate_profile_html,
)
from services.llm_quality_service import (
    llm_quality_check,
    execute_problems,
    compute_llm_score,
)

data_quality_bp = Blueprint("data_quality", __name__)


def _extract_text_from_file(file_storage) -> str:
    """Extrait le texte d'un FileStorage selon son extension."""
    name = (file_storage.filename or "").lower()
    raw = file_storage.read()

    if name.endswith(".pdf"):
        with pdfplumber.open(io.BytesIO(raw)) as pdf:
            return "\n".join(
                page.extract_text() or "" for page in pdf.pages
            ).strip()

    if name.endswith(".docx"):
        doc = docx.Document(io.BytesIO(raw))
        return "\n".join(p.text for p in doc.paragraphs).strip()

    if name.endswith(".doc"):
        # .doc (ancien format binaire) — lecture texte brut dégradée
        return raw.decode("utf-8", errors="ignore").strip()

    # .txt, .md et tout autre format texte
    return raw.decode("utf-8", errors="ignore").strip()


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

        html = generate_profile_html(df, title=f"Profiling — {title}")
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


# ── POST /api/data-quality/llm-analyze ───────────────────────────────────────
@data_quality_bp.route("/llm-analyze", methods=["POST"])
def llm_analyze():
    """Analyse LLM 2 étapes : détection + exécution des problèmes générés."""
    try:
        if "file" in request.files:
            df = load_dataframe(request.files["file"])
        elif request.is_json:
            body = request.get_json()
            filepath = body.get("filepath", "")
            df = load_dataframe_from_path(filepath)
        else:
            return jsonify({"error": "Fournir un fichier (multipart) ou un JSON avec 'filepath'"}), 400

        if df.empty:
            return jsonify({"error": "Le dataset est vide"}), 400

        description = ""
        if request.is_json:
            description = body.get("description", "")
        elif "description" in request.form:
            description = request.form.get("description", "")

        if "descriptionFile" in request.files:
            try:
                file_text = _extract_text_from_file(request.files["descriptionFile"])
                if file_text:
                    description = (description + "\n\n" + file_text).strip() if description else file_text
            except Exception:
                pass  # extraction échouée — on continue sans

        llm_result = llm_quality_check(df, description=description)
        execution_result = execute_problems(df, llm_result.get("problems", []))
        merged_analysis = {
            # Conserver compatibilité front existant
            "overall_assessment": execution_result.get("overall_assessment") or llm_result.get("overall_assessment"),
            "score": compute_llm_score(execution_result),
            "accuracy": execution_result.get("accuracy"),
            "consistency": execution_result.get("consistency"),
            "coherence": execution_result.get("consistency") or execution_result.get("coherence"),
            "timeliness": execution_result.get("timeliness"),
            "validity": execution_result.get("validity"),
            "recommendations": llm_result.get("recommendations", []),
            # Exposer trace pour debug
            "debug": {
                "initial": llm_result,
                "executed": execution_result,
            },
        }

        return jsonify({"success": True, "analysis": merged_analysis}), 200

    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
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
