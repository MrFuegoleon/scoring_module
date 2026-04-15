import pandas as pd
import numpy as np
import warnings


# Valeurs textuelles considérées comme nulles
_NULL_LIKE = {
    '', 'null', 'nan', 'NAN', 'none', 'None', 'NULL',
    'NA', 'N/A', '#N/A', 'n/a', 'NaT', 'nat', 'missing',
}

# Mots-clés dans le nom de colonne → candidat ID/Code (pas de conversion numérique)
_ID_KEYWORDS = {'id', 'code', 'zip', 'phone', 'tel', 'iban', 'siret', 'postal', 'nir', 'ean', 'isbn'}

# Mapping booléen exhaustif
_BOOL_MAP = {
    'oui': True,  'non': False,
    'true': True, 'false': False,
    '1': True,    '0': False,
    1: True,      0: False,
    'yes': True,  'no': False,
    'o': True,    'n': False,
    'vrai': True, 'faux': False,
}


def _is_id_candidate(col_name: str) -> bool:
    name = col_name.lower()
    return any(kw in name for kw in _ID_KEYWORDS)


class DataCleaningService:

    # ─────────────────────────────────────────────────────────────────────────
    # 1. CORRECTION DES TYPES — cascade avec rapport de confiance
    # ─────────────────────────────────────────────────────────────────────────
    @staticmethod
    def smart_type_correction(df: pd.DataFrame):
        """
        Retourne (df_corrigé, detected_types, type_report).

        detected_types : dict simple  {col: type_string}
        type_report    : dict riche   {col: {original_dtype, detected_type,
                                             confidence, converted, failed, action}}
        """
        warnings.filterwarnings("ignore", category=UserWarning, module='pandas')

        total_rows = len(df)
        type_report = {}

        # ── Phase 1 : Normalisation universelle ──────────────────────────────
        for col in df.columns:
            if df[col].dtype == 'object':
                df[col] = df[col].apply(
                    lambda x: x.strip() if isinstance(x, str) else x
                )
                df[col] = df[col].replace(list(_NULL_LIKE), np.nan)

        # ── Phase 2 : Cascade colonne par colonne ───────────────────────────
        for col in df.columns:
            original_dtype = str(df[col].dtype)
            non_null_mask  = df[col].notna()
            n_non_null     = int(non_null_mask.sum())
            id_candidate   = _is_id_candidate(col)

            # Colonne entièrement vide
            if n_non_null == 0:
                type_report[col] = {
                    "original_dtype": original_dtype,
                    "detected_type": "object",
                    "confidence": 0.0,
                    "converted": 0,
                    "failed": 0,
                    "action": "empty",
                }
                continue

            # ── 1. BOOLÉEN ──────────────────────────────────────────────────
            unique_vals = df[col].dropna().unique()
            if len(unique_vals) == 2:
                lower_vals = [str(v).lower() for v in unique_vals]
                if all(v in _BOOL_MAP for v in lower_vals):
                    df[col] = df[col].apply(
                        lambda x: _BOOL_MAP.get(str(x).lower()) if pd.notna(x) else np.nan
                    )
                    type_report[col] = {
                        "original_dtype": original_dtype,
                        "detected_type": "bool",
                        "confidence": round(n_non_null / total_rows * 100, 1),
                        "converted": n_non_null,
                        "failed": total_rows - n_non_null,
                        "action": "converted",
                    }
                    continue

            # ── 2+3. NUMÉRIQUE (int → float → category) ─────────────────────
            try:
                col_str  = df[col].astype(str).str.replace(',', '.', regex=False)
                col_str  = col_str.where(non_null_mask, np.nan)
                temp_num = pd.to_numeric(col_str, errors='coerce')

                n_converted      = int(temp_num.notna().sum())
                conversion_ratio = n_converted / total_rows

                if conversion_ratio > 0.8:
                    non_null_num = temp_num.dropna()
                    ratio_unique = temp_num.nunique() / total_rows if total_rows > 0 else 0
                    is_all_int   = len(non_null_num) > 0 and (non_null_num % 1 == 0).all()
                    has_nan      = df[col].isna().any()

                    # Candidat ID/Code numérique à haute cardinalité → string
                    if id_candidate and ratio_unique > 0.9:
                        type_report[col] = {
                            "original_dtype": original_dtype,
                            "detected_type": "object (ID/Code)",
                            "confidence": round(conversion_ratio * 100, 1),
                            "converted": 0,
                            "failed": 0,
                            "action": "kept_as_id",
                        }
                        continue

                    # Basse cardinalité → category
                    if ratio_unique < 0.05:
                        df[col]    = temp_num.astype('category')
                        final_type = 'category'

                    # Entiers sans NaN → downcast
                    elif is_all_int and conversion_ratio > 0.95 and not has_nan:
                        col_min = int(non_null_num.min())
                        col_max = int(non_null_num.max())
                        if   -128          <= col_min and col_max <= 127:          target = np.int8
                        elif -32_768       <= col_min and col_max <= 32_767:       target = np.int16
                        elif -2_147_483_648 <= col_min and col_max <= 2_147_483_647: target = np.int32
                        else:                                                        target = np.int64
                        df[col]    = temp_num.astype(target)
                        final_type = str(df[col].dtype)

                    # Float
                    else:
                        df[col]    = temp_num
                        final_type = 'float64'

                    type_report[col] = {
                        "original_dtype": original_dtype,
                        "detected_type": final_type,
                        "confidence": round(n_converted / total_rows * 100, 1),
                        "converted": n_converted,
                        "failed": total_rows - n_converted,
                        "action": "converted",
                    }
                    continue
            except Exception:
                pass

            # ── 4. DATETIME ─────────────────────────────────────────────────
            if df[col].dtype == 'object':
                try:
                    sample = df[col].dropna().astype(str)
                    if sample.str.contains(r'[-/:\s]', regex=True).any():
                        temp_date   = pd.to_datetime(
                            df[col], errors='coerce', format='mixed', dayfirst=True
                        )
                        n_converted = int(temp_date.notna().sum())
                        if n_converted / total_rows > 0.8:
                            df[col] = temp_date
                            type_report[col] = {
                                "original_dtype": original_dtype,
                                "detected_type": str(df[col].dtype),
                                "confidence": round(n_converted / total_rows * 100, 1),
                                "converted": n_converted,
                                "failed": total_rows - n_converted,
                                "action": "converted",
                            }
                            continue
                except Exception:
                    pass

            # ── 5. FALLBACK : TEXTE / CATÉGORIE / ID ────────────────────────
            ratio_unique = df[col].nunique() / total_rows if total_rows > 0 else 0

            if ratio_unique > 0.9 and df[col].dtype == 'object':
                final_type = "object (ID/String)"
                action     = "kept_as_id"
            elif ratio_unique < 0.1:
                df[col]    = df[col].astype('category')
                final_type = "category"
                action     = "converted"
            else:
                final_type = str(df[col].dtype)
                action     = "kept"

            type_report[col] = {
                "original_dtype": original_dtype,
                "detected_type": final_type,
                "confidence": round(n_non_null / total_rows * 100, 1),
                "converted": n_non_null if action == "converted" else 0,
                "failed": total_rows - n_non_null,
                "action": action,
            }

        detected_types = {col: r["detected_type"] for col, r in type_report.items()}
        return df, detected_types, type_report

    # ─────────────────────────────────────────────────────────────────────────
    # 1b. APPLICATION DES TYPES CONFIRMÉS PAR L'UTILISATEUR
    # ─────────────────────────────────────────────────────────────────────────
    @staticmethod
    def apply_confirmed_types(df: pd.DataFrame, confirmed_types: dict):
        """
        Applique les types choisis/validés par l'utilisateur.
        confirmed_types : {col_name: target_type_string}
        Retourne (df_modifié, apply_report).
        """
        # Normalisation préalable des nulls
        for col in df.columns:
            if df[col].dtype == 'object':
                df[col] = df[col].apply(lambda x: x.strip() if isinstance(x, str) else x)
                df[col] = df[col].replace(list(_NULL_LIKE), np.nan)

        apply_report = {}

        for col, target_type in confirmed_types.items():
            if col not in df.columns:
                continue

            original_dtype = str(df[col].dtype)
            t = target_type.lower().strip()

            try:
                # Entiers
                if t in ('int8', 'int16', 'int32', 'int64'):
                    col_str  = df[col].astype(str).str.replace(',', '.', regex=False)
                    col_str  = col_str.where(df[col].notna(), np.nan)
                    temp_num = pd.to_numeric(col_str, errors='coerce')
                    df[col]  = temp_num.astype(t)

                # Flottants
                elif t in ('float32', 'float64'):
                    col_str  = df[col].astype(str).str.replace(',', '.', regex=False)
                    col_str  = col_str.where(df[col].notna(), np.nan)
                    df[col]  = pd.to_numeric(col_str, errors='coerce').astype(t)

                # Booléen
                elif t == 'bool':
                    df[col] = df[col].apply(
                        lambda x: _BOOL_MAP.get(str(x).lower()) if pd.notna(x) else np.nan
                    )

                # Date / Heure
                elif 'datetime' in t:
                    df[col] = pd.to_datetime(
                        df[col], errors='coerce', format='mixed', dayfirst=True
                    )

                # Catégorie
                elif t == 'category':
                    df[col] = df[col].astype('category')

                # Texte / ID (object)
                else:
                    orig_na  = df[col].isna()
                    df[col]  = df[col].astype(str)
                    df[col]  = df[col].where(~orig_na, np.nan)

                n_ok   = int(df[col].notna().sum())
                n_fail = int(df[col].isna().sum())

                apply_report[col] = {
                    "original_dtype": original_dtype,
                    "applied_type": str(df[col].dtype),
                    "success": True,
                    "converted": n_ok,
                    "failed": n_fail,
                }

            except Exception as e:
                apply_report[col] = {
                    "original_dtype": original_dtype,
                    "applied_type": original_dtype,
                    "success": False,
                    "error": str(e),
                    "converted": 0,
                    "failed": len(df),
                }

        return df, apply_report

    # ─────────────────────────────────────────────────────────────────────────
    # 2. SUPPRESSION DES DOUBLONS
    # ─────────────────────────────────────────────────────────────────────────
    @staticmethod
    def remove_duplicates(df: pd.DataFrame):
        initial_rows = len(df)
        n_duplicates = int(df.duplicated().sum())
        df_cleaned   = df.drop_duplicates().reset_index(drop=True)

        report = {
            "initial_rows": initial_rows,
            "duplicates_found": n_duplicates,
            "rows_after": len(df_cleaned),
            "rows_removed": initial_rows - len(df_cleaned),
            "percentage_removed": round(n_duplicates / initial_rows * 100, 2) if initial_rows > 0 else 0,
        }
        return df_cleaned, report

    # ─────────────────────────────────────────────────────────────────────────
    # 3. DÉTECTION ET TRAITEMENT DES OUTLIERS (IQR + winsorisation)
    # ─────────────────────────────────────────────────────────────────────────
    @staticmethod
    def detect_and_treat_outliers(df: pd.DataFrame):
        numeric_cols = df.select_dtypes(include=[np.number]).columns
        report = {}

        for col in numeric_cols:
            try:
                col_data = df[col].dropna()
                if len(col_data) < 4:
                    continue
                Q1, Q3 = col_data.quantile(0.25), col_data.quantile(0.75)
                IQR = Q3 - Q1
                if IQR == 0:
                    continue
                lower, upper = Q1 - 1.5 * IQR, Q3 + 1.5 * IQR
                n_out = int(((df[col] < lower) | (df[col] > upper)).sum())
                if n_out > 0:
                    df[col] = df[col].clip(lower=lower, upper=upper)
                    report[col] = {
                        "outliers_count": n_out,
                        "lower_bound": round(float(lower), 4),
                        "upper_bound": round(float(upper), 4),
                        "treatment": "winsorisation (clip aux bornes IQR)",
                    }
            except Exception:
                pass

        return df, report

    # ─────────────────────────────────────────────────────────────────────────
    # 4. IMPUTATION DES VALEURS MANQUANTES
    # ─────────────────────────────────────────────────────────────────────────
    @staticmethod
    def impute_missing_values(df: pd.DataFrame):
        report = {}

        for col in df.columns:
            try:
                n_missing = int(df[col].isna().sum())
                if n_missing == 0:
                    continue
                missing_pct = round(n_missing / len(df) * 100, 2)
                dtype_str   = str(df[col].dtype)

                if pd.api.types.is_numeric_dtype(df[col]):
                    median_val = df[col].median()
                    df[col]    = df[col].fillna(median_val)
                    strategy   = f"mediane ({round(float(median_val), 4)})"

                elif dtype_str == 'category' or df[col].dtype == object:
                    mode_series = df[col].mode()
                    if len(mode_series) > 0:
                        mode_val = mode_series.iloc[0]
                        if dtype_str == 'category' and mode_val not in df[col].cat.categories:
                            df[col] = df[col].cat.add_categories([mode_val])
                        df[col]  = df[col].fillna(mode_val)
                        strategy = f"mode ({mode_val})"
                    else:
                        strategy = "ignoree (aucune valeur disponible)"

                elif pd.api.types.is_datetime64_any_dtype(df[col]):
                    df[col]  = df[col].ffill().bfill()
                    strategy = "propagation temporelle (ffill/bfill)"

                else:
                    strategy = "ignoree (type non supporte)"

                report[col] = {
                    "missing_count": n_missing,
                    "missing_percentage": missing_pct,
                    "strategy": strategy,
                    "dtype": dtype_str,
                }

            except Exception as e:
                report[col] = {
                    "missing_count": int(df[col].isna().sum()),
                    "missing_percentage": 0,
                    "strategy": f"erreur : {str(e)}",
                    "dtype": str(df[col].dtype),
                }

        return df, report
