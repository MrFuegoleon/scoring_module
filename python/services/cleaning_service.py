import pandas as pd
import numpy as np
import warnings


# Valeurs textuelles considérées comme nulles
_NULL_LIKE = {
    '', 'null', 'nan', 'NAN', 'none', 'None', 'NULL',
    'NA', 'N/A', '#N/A', 'n/a', 'NaT', 'nat', 'missing',
    'unknown', 'unk', 'undefined', '?', 'nd', 'n.d.',
}

# Mots-clés dans le nom de colonne → candidat ID/Code (pas de conversion numérique)
_ID_KEYWORDS = {'id', 'code', 'zip', 'phone', 'tel', 'iban', 'siret', 'postal', 'nir', 'ean', 'isbn'}

# Mapping booléen exhaustif — couvre les encodages mixtes (1/Y/yes/no/N/0…)
_BOOL_MAP = {
    'oui': True,  'non': False,
    'true': True, 'false': False,
    '1': True,    '0': False,
    1: True,      0: False,
    'yes': True,  'no': False,
    'y': True,    'n': False,
    'o': True,
    't': True,    'f': False,
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
            # Détecte les booléens à encodage mixte (1/Y/yes/no/N/0…)
            # Pas de contrainte de cardinalité : on vérifie que TOUTES
            # les valeurs non-nulles sont dans le mapping booléen.
            unique_vals = df[col].dropna().unique()
            lower_vals  = [str(v).lower() for v in unique_vals]
            if len(unique_vals) >= 2 and all(v in _BOOL_MAP for v in lower_vals):
                # Vérifier qu'il y a au moins une valeur True ET une False
                mapped = {_BOOL_MAP[v] for v in lower_vals}
                if True in mapped and False in mapped:
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

                    # Entiers sans NaN → downcast numpy (int8/16/32/64)
                    # Avec NaN → float64 (NaN n'existe pas en entier numpy)
                    # L'imputation corrigera les NaN ; re-typer ensuite si besoin
                    elif is_all_int and conversion_ratio > 0.8:
                        if has_nan:
                            df[col]    = temp_num          # float64, NaN préservés
                            final_type = 'float64'
                        else:
                            col_min = int(non_null_num.min())
                            col_max = int(non_null_num.max())
                            if   -128            <= col_min and col_max <= 127:           target = np.int8
                            elif -32_768         <= col_min and col_max <= 32_767:        target = np.int16
                            elif -2_147_483_648  <= col_min and col_max <= 2_147_483_647: target = np.int32
                            else:                                                          target = np.int64
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
                # Entiers : numpy (int32) si pas de NaN, nullable pandas (Int32) si NaN
                if t in ('int8', 'int16', 'int32', 'int64'):
                    col_str  = df[col].astype(str).str.replace(',', '.', regex=False)
                    col_str  = col_str.where(df[col].notna(), np.nan)
                    temp_num = pd.to_numeric(col_str, errors='coerce')
                    if temp_num.isna().any():
                        nullable_type = t[0].upper() + t[1:]  # int32 → Int32
                        df[col] = temp_num.round(0).astype(nullable_type)
                    else:
                        df[col] = temp_num.astype(t)

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
    # 2. DOUBLONS — détection de la clé primaire
    # ─────────────────────────────────────────────────────────────────────────
    @staticmethod
    def find_high_cardinality_candidates(df: pd.DataFrame) -> list:
        """
        Retourne toutes les colonnes sans valeurs nulles dont la cardinalité
        est ≥ 90 % du nombre de lignes, triées par cardinalité décroissante.
        """
        total = len(df)
        if total == 0:
            return []
        candidates = []
        for col in df.columns:
            if df[col].isna().any():
                continue
            ratio = df[col].nunique() / total
            if ratio >= 0.9:
                candidates.append({"column": col, "cardinality_ratio": round(ratio, 4)})
        candidates.sort(key=lambda x: x["cardinality_ratio"], reverse=True)
        return candidates

    @staticmethod
    def _find_primary_key(df: pd.DataFrame) -> str | None:
        """
        Cherche une colonne clé primaire parmi les colonnes dont le nom
        contient un mot-clé ID (_ID_KEYWORDS).
        Critères : pas de null, cardinalité ≥ 90 % des lignes.
        Retourne la colonne la plus unique, ou None si introuvable.
        """
        total = len(df)
        if total == 0:
            return None

        candidates = []
        for col in df.columns:
            if not _is_id_candidate(col):
                continue
            if df[col].isna().any():
                continue
            ratio = df[col].nunique() / total
            if ratio >= 0.9:
                candidates.append((col, ratio))

        if not candidates:
            return None

        # Colonne la plus unique en premier
        candidates.sort(key=lambda x: x[1], reverse=True)
        return candidates[0][0]

    # ─────────────────────────────────────────────────────────────────────────
    # 2b. DOUBLONS — détection seule (read-only)
    # ─────────────────────────────────────────────────────────────────────────
    @staticmethod
    def detect_duplicates(df: pd.DataFrame) -> dict:
        """
        Compte les doublons sans modifier le dataframe.
        Stratégie :
          1. Si une clé primaire est trouvée → doublon = même valeur d'ID
          2. Sinon → doublon = ligne entière identique
        Retourne aussi high_cardinality_candidates (cardinalité ≥ 90 %) et
        suggested_pk pour que l'utilisateur puisse valider ou choisir.
        """
        initial_rows = len(df)
        pk_col = DataCleaningService._find_primary_key(df)
        high_cardinality_candidates = DataCleaningService.find_high_cardinality_candidates(df)
        suggested_pk = pk_col or (high_cardinality_candidates[0]["column"] if high_cardinality_candidates else None)

        if pk_col:
            n_duplicates = int(df.duplicated(subset=[pk_col]).sum())
            method = f"clé primaire · colonne « {pk_col} »"
        else:
            n_duplicates = int(df.duplicated().sum())
            method = "toutes les colonnes (clé primaire introuvable)"

        return {
            "initial_rows":                initial_rows,
            "duplicates_found":            n_duplicates,
            "rows_after":                  initial_rows - n_duplicates,
            "rows_removed":                n_duplicates,
            "percentage_removed":          round(n_duplicates / initial_rows * 100, 2) if initial_rows > 0 else 0,
            "pk_column":                   pk_col,
            "suggested_pk":                suggested_pk,
            "high_cardinality_candidates": high_cardinality_candidates,
            "all_columns":                 list(df.columns),
            "method":                      method,
        }

    # ─────────────────────────────────────────────────────────────────────────
    # 2c. SUPPRESSION DES DOUBLONS — application
    # ─────────────────────────────────────────────────────────────────────────
    @staticmethod
    def remove_duplicates(df: pd.DataFrame, user_pk_column: str = None):
        """
        Supprime les doublons.
        Priorité : user_pk_column (choix utilisateur) > _find_primary_key > toutes colonnes.
        """
        initial_rows = len(df)
        if user_pk_column and user_pk_column in df.columns:
            pk_col = user_pk_column
        else:
            pk_col = DataCleaningService._find_primary_key(df)

        if pk_col:
            n_duplicates = int(df.duplicated(subset=[pk_col]).sum())
            df_cleaned   = df.drop_duplicates(subset=[pk_col]).reset_index(drop=True)
            method       = f"clé primaire · colonne « {pk_col} »"
        else:
            n_duplicates = int(df.duplicated().sum())
            df_cleaned   = df.drop_duplicates().reset_index(drop=True)
            method       = "toutes les colonnes (clé primaire introuvable)"

        report = {
            "initial_rows":       initial_rows,
            "duplicates_found":   n_duplicates,
            "rows_after":         len(df_cleaned),
            "rows_removed":       initial_rows - len(df_cleaned),
            "percentage_removed": round(n_duplicates / initial_rows * 100, 2) if initial_rows > 0 else 0,
            "pk_column":          pk_col,
            "method":             method,
        }
        return df_cleaned, report

    # ─────────────────────────────────────────────────────────────────────────
    # 3. OUTLIERS — détection seule (read-only)
    # ─────────────────────────────────────────────────────────────────────────
    @staticmethod
    def detect_outliers(df: pd.DataFrame) -> dict:
        """
        Analyse IQR sur toutes les colonnes numériques, sans modifier le df.
        Retourne un rapport par colonne contenant des outliers.
        """
        numeric_cols = df.select_dtypes(include=[np.number]).columns
        report = {}
        total = len(df)

        for col in numeric_cols:
            col_data = df[col].dropna()
            if len(col_data) < 4:
                continue
            Q1  = col_data.quantile(0.25)
            Q3  = col_data.quantile(0.75)
            IQR = Q3 - Q1
            if IQR == 0:
                continue
            lower = Q1 - 1.5 * IQR
            upper = Q3 + 1.5 * IQR
            n_out = int(((df[col] < lower) | (df[col] > upper)).sum())
            if n_out > 0:
                report[col] = {
                    "outliers_count": n_out,
                    "outliers_pct":   round(n_out / total * 100, 1),
                    "lower_bound":    round(float(lower), 4),
                    "upper_bound":    round(float(upper), 4),
                    "q1":             round(float(Q1), 4),
                    "q3":             round(float(Q3), 4),
                    "iqr":            round(float(IQR), 4),
                    "col_min":        round(float(col_data.min()), 4),
                    "col_max":        round(float(col_data.max()), 4),
                }

        return report

    # ─────────────────────────────────────────────────────────────────────────
    # 3b. OUTLIERS — application de la stratégie choisie
    # ─────────────────────────────────────────────────────────────────────────
    @staticmethod
    def apply_outlier_strategy(df: pd.DataFrame, strategy: str = 'drop'):
        """
        strategy='drop'       → supprime les lignes contenant au moins un outlier
        strategy='winsorise'  → clip chaque colonne à ses bornes IQR
        """
        numeric_cols = df.select_dtypes(include=[np.number]).columns
        col_report   = {}
        rows_before  = len(df)

        bounds = {}
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
                mask  = (df[col] < lower) | (df[col] > upper)
                n_out = int(mask.sum())
                if n_out > 0:
                    bounds[col] = {
                        "lower": lower, "upper": upper,
                        "n_out": n_out, "mask": mask,
                    }
            except Exception:
                pass

        if not bounds:
            return df, {}

        if strategy == 'drop':
            global_mask = pd.Series(False, index=df.index)
            for col, b in bounds.items():
                global_mask |= b["mask"]
                col_report[col] = {
                    "outliers_count": b["n_out"],
                    "lower_bound":    round(float(b["lower"]), 4),
                    "upper_bound":    round(float(b["upper"]), 4),
                    "treatment":      "suppression des lignes",
                }
            df = df[~global_mask].reset_index(drop=True)

        else:  # winsorise
            for col, b in bounds.items():
                df[col] = df[col].clip(lower=b["lower"], upper=b["upper"])
                col_report[col] = {
                    "outliers_count": b["n_out"],
                    "lower_bound":    round(float(b["lower"]), 4),
                    "upper_bound":    round(float(b["upper"]), 4),
                    "treatment":      "winsorisation (clip aux bornes IQR)",
                }

        col_report["_meta"] = {
            "strategy":     strategy,
            "rows_before":  rows_before,
            "rows_after":   len(df),
            "rows_dropped": rows_before - len(df),
        }

        return df, col_report

    # Alias conservé pour rétrocompatibilité interne
    @staticmethod
    def detect_and_treat_outliers(df: pd.DataFrame):
        return DataCleaningService.apply_outlier_strategy(df, strategy='winsorise')

    # ─────────────────────────────────────────────────────────────────────────
    # 4. IMPUTATION — détection seule (read-only)
    # ─────────────────────────────────────────────────────────────────────────
    @staticmethod
    def detect_missing(df: pd.DataFrame) -> dict:
        """
        Analyse les valeurs manquantes par colonne sans modifier le df.
        Propose une stratégie par défaut selon le type et le taux de missing.
        """
        total  = len(df)
        report = {}

        for col in df.columns:
            n_missing = int(df[col].isna().sum())
            if n_missing == 0:
                continue

            pct       = round(n_missing / total * 100, 1)
            dtype_str = str(df[col].dtype)

            if pct > 60:
                proposed = 'drop_column'
            elif pct > 30:
                proposed = 'constant'
            elif pd.api.types.is_numeric_dtype(df[col]):
                proposed = 'median'
            elif pd.api.types.is_datetime64_any_dtype(df[col]):
                proposed = 'ffill'
            else:
                proposed = 'mode'

            report[col] = {
                'missing_count':    n_missing,
                'missing_pct':      pct,
                'dtype':            dtype_str,
                'proposed_strategy': proposed,
            }

        return report

    # ─────────────────────────────────────────────────────────────────────────
    # 4b. IMPUTATION — application des stratégies confirmées
    # ─────────────────────────────────────────────────────────────────────────
    @staticmethod
    def impute_missing_values(df: pd.DataFrame, confirmed_strategies: dict,
                              create_indicators: bool = False):
        """
        Applique les stratégies d'imputation confirmées par l'utilisateur.
        confirmed_strategies : {col: strategy}
        create_indicators    : si True, crée une colonne {col}_missing (0/1)
                               avant imputation pour chaque colonne traitée
                               (sauf drop_rows où la ligne disparaît de toute façon).

        Stratégies disponibles :
          median      · numérique  → médiane
          mean        · numérique  → moyenne
          constant    · num → -999 / cat → "unknown"
          mode        · catégoriel → valeur la plus fréquente
          ffill       · datetime   → propagation avant
          bfill       · datetime   → propagation arrière
          drop_rows   · toute      → supprime les lignes avec NaN sur cette colonne
          drop_column · toute      → supprime la colonne entière
        """
        report         = {}
        cols_to_drop   = []
        drop_rows_mask = pd.Series(False, index=df.index)
        indicators_created = []

        # ── Création des indicateurs AVANT imputation ────────────────────────
        if create_indicators:
            for col, strategy in confirmed_strategies.items():
                if col not in df.columns:
                    continue
                # drop_rows : la ligne disparaît — indicateur inutile
                # drop_column : la colonne disparaît — indicateur inutile
                # woe : NaN conservés intentionnellement comme bin '__missing__'
                if strategy in ('drop_rows', 'drop_column', 'woe'):
                    continue
                n_missing = int(df[col].isna().sum())
                if n_missing == 0:
                    continue
                indicator_name = f"{col}_missing"
                pos = df.columns.get_loc(col) + 1
                df.insert(pos, indicator_name, df[col].isna().astype(int))
                indicators_created.append(indicator_name)

        for col, strategy in confirmed_strategies.items():
            if col not in df.columns:
                continue

            n_missing = int(df[col].isna().sum())
            if n_missing == 0:
                continue

            dtype_str = str(df[col].dtype)

            try:
                if strategy == 'woe':
                    # NaN conservés intentionnellement — seront traités comme bin manquant en WOE
                    report[col] = {
                        'strategy': 'woe',
                        'missing_count': n_missing, 'dtype': dtype_str,
                    }
                    continue

                elif strategy == 'drop_column':
                    cols_to_drop.append(col)
                    report[col] = {
                        'strategy': 'drop_column',
                        'missing_count': n_missing, 'dtype': dtype_str,
                    }

                elif strategy == 'drop_rows':
                    drop_rows_mask |= df[col].isna()
                    report[col] = {
                        'strategy': 'drop_rows',
                        'missing_count': n_missing, 'dtype': dtype_str,
                    }

                elif strategy == 'median':
                    val    = df[col].median()
                    df[col] = df[col].fillna(val)
                    report[col] = {
                        'strategy': 'median', 'value': round(float(val), 4),
                        'missing_count': n_missing, 'dtype': dtype_str,
                    }

                elif strategy == 'mean':
                    val    = df[col].mean()
                    df[col] = df[col].fillna(val)
                    report[col] = {
                        'strategy': 'mean', 'value': round(float(val), 4),
                        'missing_count': n_missing, 'dtype': dtype_str,
                    }

                elif strategy == 'mode':
                    mode_s = df[col].mode()
                    if len(mode_s) > 0:
                        val = mode_s.iloc[0]
                        if dtype_str == 'category' and val not in df[col].cat.categories:
                            df[col] = df[col].cat.add_categories([val])
                        df[col] = df[col].fillna(val)
                        report[col] = {
                            'strategy': 'mode', 'value': str(val),
                            'missing_count': n_missing, 'dtype': dtype_str,
                        }

                elif strategy == 'constant':
                    val = -999 if pd.api.types.is_numeric_dtype(df[col]) else 'unknown'
                    if dtype_str == 'category' and val not in df[col].cat.categories:
                        df[col] = df[col].cat.add_categories([val])
                    df[col] = df[col].fillna(val)
                    report[col] = {
                        'strategy': 'constant', 'value': str(val),
                        'missing_count': n_missing, 'dtype': dtype_str,
                    }

                elif strategy == 'ffill':
                    df[col] = df[col].ffill().bfill()
                    report[col] = {
                        'strategy': 'ffill',
                        'missing_count': n_missing, 'dtype': dtype_str,
                    }

                elif strategy == 'bfill':
                    df[col] = df[col].bfill().ffill()
                    report[col] = {
                        'strategy': 'bfill',
                        'missing_count': n_missing, 'dtype': dtype_str,
                    }

                else:
                    report[col] = {
                        'strategy': 'ignored',
                        'missing_count': n_missing, 'dtype': dtype_str,
                    }

            except Exception as e:
                report[col] = {
                    'strategy': f'error: {str(e)}',
                    'missing_count': n_missing, 'dtype': dtype_str,
                }

        # Appliquer les suppressions en fin de boucle
        df = df.drop(columns=cols_to_drop, errors='ignore')
        df = df[~drop_rows_mask].reset_index(drop=True)

        rows_dropped = int(drop_rows_mask.sum())
        report['_meta'] = {
            'rows_dropped':        rows_dropped,
            'cols_dropped':        len(cols_to_drop),
            'cols_imputed':        len([k for k in report if k != '_meta' and report[k]['strategy'] not in ('drop_column', 'drop_rows', 'ignored')]),
            'rows_after':          len(df),
            'cols_after':          len(df.columns),
            'indicators_created':  indicators_created,
        }

        return df, report
