import numpy as np
import pandas as pd

_IV_THRESHOLDS = [
    (0.02, 'Inutile',  '#9ca3af'),
    (0.1,  'Faible',   '#f59e0b'),
    (0.3,  'Moyen',    '#3b82f6'),
    (0.5,  'Fort',     '#10b981'),
    (9999, 'Suspect',  '#ef4444'),
]


def _iv_meta(iv: float) -> tuple[str, str]:
    for threshold, label, color in _IV_THRESHOLDS:
        if iv < threshold:
            return label, color
    return 'Suspect', '#ef4444'


class ModellingService:

    # ─────────────────────────────────────────────────────────────────────────
    # 1. DÉTECTION DE LA VARIABLE CIBLE
    # ─────────────────────────────────────────────────────────────────────────
    @staticmethod
    def detect_target_candidates(df: pd.DataFrame) -> list:
        """
        Propose les colonnes binaires comme candidates pour la variable cible.
        Retourne la liste triée par taux d'événements le plus proche de 50%.
        """
        candidates = []
        for col in df.columns:
            if df[col].nunique() != 2:
                continue
            vals = sorted(df[col].dropna().unique(), key=str)
            event_val  = vals[1]
            n_missing  = int(df[col].isna().sum())
            # Taux calculé sur la population totale (manquants exclus du numérateur)
            event_rate = round(float((df[col] == event_val).sum() / len(df)), 4)
            candidates.append({
                "column":     col,
                "values":     [str(v) for v in vals],
                "event_val":  str(event_val),
                "event_rate": event_rate,
                "n_missing":  n_missing,
                "balance":    round(abs(0.5 - event_rate), 4),
            })
        # Meilleures candidates : taux le plus équilibré en premier
        candidates.sort(key=lambda x: x["balance"])
        return candidates

    # ─────────────────────────────────────────────────────────────────────────
    # 2. DISCRÉTISATION
    # ─────────────────────────────────────────────────────────────────────────
    @staticmethod
    def _bin_continuous(series: pd.Series, n_bins: int = 10) -> pd.Series:
        non_null = series.dropna()
        if non_null.nunique() <= n_bins:
            return series.apply(lambda x: str(x) if pd.notna(x) else '__missing__')
        try:
            binned = pd.qcut(series, q=n_bins, duplicates='drop', precision=2)
            result = binned.astype(str)
            result[series.isna()] = '__missing__'
            return result
        except Exception:
            return series.apply(lambda x: str(x) if pd.notna(x) else '__missing__')

    @staticmethod
    def _bin_categorical(series: pd.Series) -> pd.Series:
        return series.apply(lambda x: str(x) if pd.notna(x) else '__missing__')

    # ─────────────────────────────────────────────────────────────────────────
    # 3. CALCUL WOE / IV PAR COLONNE
    # ─────────────────────────────────────────────────────────────────────────
    @staticmethod
    def _woe_iv_for_col(df_work: pd.DataFrame, bin_col: str, target_col: str) -> tuple[list, float]:
        total_events     = int((df_work[target_col] == 1).sum())
        total_non_events = int((df_work[target_col] == 0).sum())

        if total_events == 0 or total_non_events == 0:
            return [], 0.0

        bins_stats = []
        for bin_label, group in df_work.groupby(bin_col, observed=True)[target_col]:
            n_events     = int((group == 1).sum())
            n_non_events = int((group == 0).sum())
            n_total      = len(group)

            # Lissage pour éviter log(0)
            distr_ev  = (n_events     + 0.5) / (total_events     + 0.5)
            distr_nev = (n_non_events + 0.5) / (total_non_events + 0.5)

            # Convention standard scoring crédit : ln(goods / bads) = ln(non-events / events)
            # WOE positif → bin sur-représenté en bons clients (faible risque)
            # WOE négatif → bin sur-représenté en mauvais clients (fort risque)
            woe        = float(np.log(distr_nev / distr_ev))
            iv_contrib = (distr_nev - distr_ev) * woe

            bins_stats.append({
                "bin":          str(bin_label),
                "n_total":      n_total,
                "n_events":     n_events,
                "n_non_events": n_non_events,
                "event_rate":   round(n_events / n_total, 4) if n_total > 0 else 0,
                "woe":          round(woe, 4),
                "iv_contrib":   round(iv_contrib, 4),
                "is_missing":   bin_label == '__missing__',
            })

        # Missing en dernier
        bins_stats.sort(key=lambda b: (b["is_missing"], b["bin"]))
        total_iv = round(sum(b["iv_contrib"] for b in bins_stats), 4)
        return bins_stats, total_iv

    # ─────────────────────────────────────────────────────────────────────────
    # 4. CALCUL WOE / IV GLOBAL
    # ─────────────────────────────────────────────────────────────────────────
    @staticmethod
    def compute_woe_iv(df: pd.DataFrame, target_col: str,
                       feature_cols: list = None, n_bins: int = 10) -> dict:
        """
        Calcule le WOE et l'IV pour chaque variable feature.
        Le bin '__missing__' regroupe les valeurs manquantes — pas d'imputation.
        Résultat trié par IV décroissant.
        """
        total = len(df)

        if feature_cols is None:
            feature_cols = [c for c in df.columns if c != target_col]

        # Exclure les colonnes indicatrices d'imputation ({col}_missing) :
        # leur information est déjà capturée par le bin '__missing__' de la variable parente.
        # Exclure aussi les colonnes catégorielles à haute cardinalité (≥ 90%) : identifiants sans signal prédictif.
        # Les colonnes numériques continues ont naturellement beaucoup de valeurs uniques — elles sont binnalisées, pas exclues.
        def _should_skip(col: str) -> bool:
            if col.endswith('_missing'):
                return True
            if not pd.api.types.is_numeric_dtype(df[col]) and df[col].nunique() / total >= 0.9:
                return True
            return False

        feature_cols = [c for c in feature_cols if not _should_skip(c)]

        # Encodage cible → 0 / 1
        target_series = df[target_col].dropna()
        vals = sorted(target_series.unique(), key=str)
        if len(vals) != 2:
            raise ValueError(f"La colonne cible doit être binaire ({len(vals)} valeurs trouvées).")

        target_map = {vals[0]: 0, vals[1]: 1}
        df_work = df.copy()
        df_work['__target__'] = df_work[target_col].map(target_map).astype('Int64')
        df_work = df_work.dropna(subset=['__target__'])
        df_work['__target__'] = df_work['__target__'].astype(int)

        results = {}

        for col in feature_cols:
            if col not in df_work.columns or col == target_col:
                continue

            is_numeric = pd.api.types.is_numeric_dtype(df_work[col])
            var_type   = 'continue' if is_numeric else 'catégorielle'

            if is_numeric:
                df_work['__bin__'] = ModellingService._bin_continuous(df_work[col], n_bins)
            else:
                df_work['__bin__'] = ModellingService._bin_categorical(df_work[col])

            bins_stats, iv = ModellingService._woe_iv_for_col(df_work, '__bin__', '__target__')
            iv_label, iv_color = _iv_meta(iv)

            results[col] = {
                "iv":              iv,
                "iv_label":        iv_label,
                "iv_color":        iv_color,
                "var_type":        var_type,
                "dtype":           str(df[col].dtype),
                "n_bins":          len(bins_stats),
                "has_missing_bin": any(b["is_missing"] for b in bins_stats),
                "bins":            bins_stats,
            }

        return dict(sorted(results.items(), key=lambda x: x[1]["iv"], reverse=True))

    # ─────────────────────────────────────────────────────────────────────────
    # 5. TRANSFORMATION WOE DU DATASET
    # ─────────────────────────────────────────────────────────────────────────
    @staticmethod
    def apply_woe_transform(df: pd.DataFrame, target_col: str,
                            woe_report: dict, n_bins: int = 10) -> pd.DataFrame:
        """
        Remplace chaque valeur de feature par son WOE.
        Les valeurs manquantes reçoivent le WOE du bin '__missing__'.
        La colonne cible est conservée telle quelle.
        Retourne un nouveau DataFrame avec les colonnes renommées {col}_woe.
        """
        df_out = pd.DataFrame(index=df.index)
        df_out[target_col] = df[target_col]

        for col, info in woe_report.items():
            if col not in df.columns:
                continue

            # Mapping bin_label → WOE
            bin_to_woe = {b["bin"]: b["woe"] for b in info["bins"]}
            missing_woe = bin_to_woe.get("__missing__", 0.0)

            if info["var_type"] == "continue":
                binned = ModellingService._bin_continuous(df[col], n_bins)
            else:
                binned = ModellingService._bin_categorical(df[col])

            df_out[f"{col}_woe"] = binned.map(
                lambda lbl: bin_to_woe.get(lbl, missing_woe)
            )

        return df_out
