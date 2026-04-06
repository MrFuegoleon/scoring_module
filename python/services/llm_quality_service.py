"""
services/llm_quality_service.py
────────────────────────────────
Analyse LLM (Azure OpenAI) — 4 piliers.
Framework-agnostic, client lazy-init.
"""

import json
import re
import logging
from typing import Optional

import numpy as np
import pandas as pd
from openai import AzureOpenAI

from core.config import settings

logger = logging.getLogger(__name__)

# ── Client lazy singleton ────────────────────────────────────────────────────
_client: Optional[AzureOpenAI] = None

LLM_PILLARS = ["accuracy", "consistency", "timeliness", "validity"]


def _get_client() -> AzureOpenAI:
    """Initialise le client Azure OpenAI une seule fois."""
    global _client
    if _client is None:
        if not all([settings.AZURE_OPENAI_API_BASE, settings.AZURE_OPENAI_API_KEY, settings.AZURE_OPENAI_DEPLOYMENT]):
            raise EnvironmentError(
                "Définir AZURE_OPENAI_API_BASE, AZURE_OPENAI_API_KEY "
                "et AZURE_OPENAI_DEPLOYMENT dans .env"
            )
        _client = AzureOpenAI(
            api_key=settings.AZURE_OPENAI_API_KEY,
            api_version=settings.AZURE_OPENAI_API_VERSION,
            azure_endpoint=settings.AZURE_OPENAI_API_BASE,
        )
    return _client


# ══════════════════════════════════════════════════════════════════════════════
# 1. RÉSUMÉ COMPACT DU DATASET
# ══════════════════════════════════════════════════════════════════════════════

def build_llm_summary(df: pd.DataFrame, description: str = "", n_rows: int = 5) -> dict:
    summary = {
        "shape": {"rows": int(df.shape[0]), "columns": int(df.shape[1])},
        "description": description.strip() if description else "",
        "columns": {},
        "sample_rows": {
            "first": df.head(n_rows).fillna("").astype(str).to_dict(orient="records"),
            "last": df.tail(n_rows).fillna("").astype(str).to_dict(orient="records"),
        },
    }

    logger.debug(f"Building LLM summary | shape={df.shape} | description_len={len(description)}")

    for col in df.columns:
        series = df[col]
        n_unique = int(series.nunique())

        col_info = {
            "dtype": str(series.dtype),
            "missing_pct": round(int(series.isnull().sum()) / len(series) * 100, 1) if len(series) > 0 else 0,
            "unique_count": n_unique,
            "top_values": [_safe_val(v) for v in series.dropna().value_counts().head(5).index.tolist()],
        }

        if pd.api.types.is_numeric_dtype(series):
            clean = series.dropna()
            if len(clean) > 0:
                col_info["stats"] = {
                    "min": _safe_val(clean.min()),
                    "max": _safe_val(clean.max()),
                    "mean": round(float(clean.mean()), 2),
                    "std": round(float(clean.std()), 2),
                }

        summary["columns"][col] = col_info

    return summary


def _safe_val(val):
    if isinstance(val, (np.integer,)):
        return int(val)
    if isinstance(val, (np.floating,)):
        return round(float(val), 4)
    if isinstance(val, (np.bool_,)):
        return bool(val)
    if isinstance(val, float) and (np.isnan(val) or np.isinf(val)):
        return None
    return val


# ══════════════════════════════════════════════════════════════════════════════
# 2. PROMPT SYSTÈME
# ══════════════════════════════════════════════════════════════════════════════

SYSTEM_PROMPT = """Tu es un expert senior en Data Quality avec 15 ans d'expérience.
Tu analyses des résumés statistiques de datasets et identifies des problèmes RÉELS et ACTIONNABLES et tu reponds qu'en francais.

Note : completeness et uniqueness sont gérés séparément par un outil statistique (ydata_profiling).
Tu dois uniquement évaluer les 4 piliers suivants.

═══════════════════════════════════════════════════════
 LES 4 PILIERS À ÉVALUER
═══════════════════════════════════════════════════════

• accuracy    → Les valeurs reflètent-elles fidèlement la réalité ?
• consistency → Les données sont-elles cohérentes ENTRE colonnes ?
• timeliness  → Les données semblent-elles obsolètes ou anachroniques ?
                ⚠ N'évalue ce pilier QUE si des colonnes date/timestamp sont présentes.
• validity    → Les valeurs respectent-elles les formats et règles métier ?

═══════════════════════════════════════════════════════
 RÈGLES STRICTES
═══════════════════════════════════════════════════════

1. FACTUELS UNIQUEMENT — problèmes VISIBLES dans les données fournies.
2. La fonction DOIT s'appeler detect_problem(df) et retourner un float 0.0–100.0.
   Variables : df, pd, np. Pas d'imports. Inclure try/except retournant 0.0.
3. Maximum 8 problèmes, 3 par pilier.
4. Sévérité : high (>20%), medium (5-20%), low (<5%).
5. Répond uniquement en français, même si la demande est en anglais ou multi-langues.
6. Si le modèle produit du texte en anglais, réécris la réponse en français et retourne la même structure JSON.

═══════════════════════════════════════════════════════
 FORMAT JSON UNIQUEMENT (pas de markdown, pas de texte)
═══════════════════════════════════════════════════════

{
  "problems": [
    {
      "category": "accuracy|consistency|timeliness|validity",
      "title": "Titre court (max 60 chars)",
      "description": "Description précise",
      "affected_columns": ["col1"],
      "examples": ["val1", "val2"],
      "severity": "high|medium|low",
      "estimated_pct": 12.5,
      "code": "def detect_problem(df):\\n    try:\\n        ...\\n    except Exception:\\n        return 0.0"
    }
  ],
  "pillars_summary": {
    "accuracy":    {"evaluated": true, "issues_found": 1},
    "consistency": {"evaluated": true, "issues_found": 0},
    "timeliness":  {"evaluated": false, "issues_found": 0},
    "validity":    {"evaluated": true, "issues_found": 2}
  },
  "recommendations": [
    {"priority": "high|medium|low", "action": "Action concrète", "target_columns": ["col1"], "estimated_effort": "< 1h | 1-4h | > 4h"}
  ],
  "overall_assessment": "Résumé en 2-3 phrases.",
  "pillar_scores": {"accuracy": 85, "consistency": 70, "timeliness": null, "validity": 80}
}"""


def _build_user_message(summary: dict, description: str = "") -> str:
    parts = []
    if description.strip():
        parts.append(f"## CONTEXTE MÉTIER DU DATASET\n{description.strip()}\n")
    parts.append(f"## RÉSUMÉ STATISTIQUE\n```json\n{json.dumps(summary, ensure_ascii=False, indent=2)}\n```\n")
    parts.append("## INSTRUCTIONS\nAnalyse selon les 4 piliers. Retourne JSON uniquement.")
    parts.append("## LANGUE\nTu réponds STRICTEMENT en français, aucune phrase en anglais, aucune traduction à moitié.")
    parts.append("## FORMAT\nJSON uniquement, même si tu vois du texte libre dans les exemples.")
    return "\n".join(parts)


# ══════════════════════════════════════════════════════════════════════════════
# 3. PHASE 1 — APPEL LLM
# ══════════════════════════════════════════════════════════════════════════════

def llm_quality_check(df: pd.DataFrame, description: str = "") -> dict:
    """Phase 1 : identifie les problèmes potentiels + retourne les codes."""
    logger.info(f"LLM quality check | shape={df.shape}")

    summary = build_llm_summary(df, description=description)
    user_message = _build_user_message(summary, description)

    client = _get_client()
    response = client.chat.completions.create(
        model=settings.AZURE_OPENAI_DEPLOYMENT,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        temperature=0.1,
        max_tokens=3500,
    )

    raw_text = response.choices[0].message.content or ""
    llm_result = _parse_response(raw_text)

    return {
        "problems": llm_result.get("problems", []),
        "pillars_summary": llm_result.get("pillars_summary", {}),
        "recommendations": llm_result.get("recommendations", []),
        "overall_assessment": llm_result.get("overall_assessment", "Analyse disponible."),
        "pillar_scores": llm_result.get("pillar_scores", {}),
        "pending_execution": True,
    }


# ══════════════════════════════════════════════════════════════════════════════
# 4. PHASE 2 — EXÉCUTION DES CODES
# ══════════════════════════════════════════════════════════════════════════════

def execute_problems(df: pd.DataFrame, problems: list) -> dict:
    """Phase 2 : exécute les codes Python → vrais pourcentages."""
    categories = {p: [] for p in LLM_PILLARS}

    for problem in problems:
        cat = problem.get("category", "validity")
        if cat not in categories:
            cat = "validity"
        categories[cat].append(problem)

    result = {}
    for pillar, probs in categories.items():
        if not probs:
            result[pillar] = {"score": 100, "issues": []}
            continue

        issues = []
        percentages = []

        for prob in probs:
            code = prob.get("code", "")
            percentage = (
                _execute_code_safely(code, df)
                if code
                else prob.get("estimated_pct", 0.0)
            )
            percentages.append(percentage)
            issues.append({
                "title": prob.get("title", ""),
                "description": prob.get("description", ""),
                "percentage": round(percentage, 1),
                "examples": prob.get("examples", []),
                "severity": prob.get("severity", "medium"),
                "affected_columns": prob.get("affected_columns", []),
            })

        avg_pct = sum(percentages) / len(percentages) if percentages else 0
        result[pillar] = {
            "score": round(max(0, 100 - avg_pct), 1),
            "issues": issues,
        }

    result["recommendations"] = []
    result["overall_assessment"] = _generate_assessment(result)
    result["pending_execution"] = False
    return result


def _execute_code_safely(code: str, df: pd.DataFrame) -> float:
    """Exécute un code Python en sandbox restreinte."""
    try:
        safe_builtins = {
            "len": len, "sum": sum, "max": max, "min": min, "abs": abs,
            "round": round, "int": int, "float": float, "str": str,
            "bool": bool, "range": range, "enumerate": enumerate,
            "zip": zip, "list": list, "dict": dict, "set": set,
            "tuple": tuple, "sorted": sorted, "any": any, "all": all,
            "isinstance": isinstance, "type": type,
        }
        allowed_globals = {"__builtins__": safe_builtins, "df": df, "pd": pd, "np": np}
        local_vars = {}
        exec(code, allowed_globals, local_vars)

        fn = local_vars.get("detect_problem")
        if fn and callable(fn):
            result = fn(df)
            if isinstance(result, (int, float)):
                return max(0.0, min(100.0, float(result)))

        for obj in local_vars.values():
            if callable(obj):
                result = obj(df)
                if isinstance(result, (int, float)):
                    return max(0.0, min(100.0, float(result)))

        return 0.0
    except Exception as e:
        logger.warning(f"[sandbox] erreur exécution : {e}")
        return 0.0


def _generate_assessment(result: dict) -> str:
    scores = [result.get(p, {}).get("score", 100) for p in LLM_PILLARS if result.get(p)]
    if not scores:
        return "Aucun problème détecté."
    avg = sum(scores) / len(scores)
    if avg >= 90:
        return "Dataset de très haute qualité. Quelques points mineurs à surveiller."
    if avg >= 75:
        return "Bonne qualité générale. Quelques problèmes à corriger."
    if avg >= 60:
        return "Qualité moyenne. Plusieurs problèmes nécessitent votre attention."
    return "Qualité préoccupante. Un nettoyage important est recommandé."


def compute_llm_score(executed_result: dict) -> float:
    """Score agrégé pondéré sur les 4 piliers LLM."""
    weights = {"accuracy": 0.35, "validity": 0.30, "consistency": 0.25, "timeliness": 0.10}
    total, total_w = 0.0, 0.0

    for key, w in weights.items():
        score = executed_result.get(key, {}).get("score")
        if score is None and key == "timeliness":
            continue
        total += (score if score is not None else 100) * w
        total_w += w

    return round(total / total_w, 2) if total_w > 0 else 100.0


# ══════════════════════════════════════════════════════════════════════════════
# PARSING ROBUSTE
# ══════════════════════════════════════════════════════════════════════════════

def _parse_response(raw: str) -> dict:
    text = raw.strip()
    text = re.sub(r"^```json\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    text = text.strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except Exception:
                pass
    return {
        "problems": [],
        "pillars_summary": {},
        "recommendations": [],
        "overall_assessment": "Analyse LLM indisponible (erreur de parsing).",
        "pillar_scores": {},
    }
