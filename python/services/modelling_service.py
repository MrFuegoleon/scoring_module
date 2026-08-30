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
    def build_target_map(series: pd.Series, positive_class=None) -> tuple[dict, list]:
        """
        Construit le mapping {modalité: 0/1} de la variable cible.

        positive_class : modalité représentant l'ÉVÉNEMENT modélisé (défaut, fraude…).
                         Comparaison sur str(), la valeur transitant par le formulaire.
        Si None ou introuvable → repli sur la 2ᵉ modalité par ordre alphabétique
        (convention historique, conservée pour les sessions et bundles antérieurs).

        Ce choix n'a aucun effet sur l'AUC, qui est symétrique, mais il détermine
        le signe du WOE, l'orientation de la matrice de confusion, la courbe de
        lift, les déciles et le libellé de décision renvoyé au déploiement.

        Retourne (target_map, class_names) avec class_names = [négatif, positif].
        """
        vals = sorted(pd.Series(series).dropna().unique(), key=str)
        if len(vals) != 2:
            raise ValueError(f"La colonne cible doit être binaire ({len(vals)} valeurs trouvées).")

        idx = 1
        if positive_class is not None:
            for i, v in enumerate(vals):
                if str(v) == str(positive_class):
                    idx = i
                    break

        pos, neg = vals[idx], vals[1 - idx]
        return {neg: 0, pos: 1}, [str(neg), str(pos)]

    @staticmethod
    def detect_target_candidates(df: pd.DataFrame) -> list:
        """
        Propose les colonnes binaires comme candidates pour la variable cible.
        Retourne la liste triée par taux d'événements le plus proche de 50%.
        """
        candidates = []
        total = len(df)
        for col in df.columns:
            if df[col].nunique() != 2:
                continue
            vals   = sorted(df[col].dropna().unique(), key=str)
            counts = {str(v): int((df[col] == v).sum()) for v in vals}

            # En scoring, l'événement modélisé (défaut, fraude, impayé) est presque
            # toujours la modalité rare → proposée par défaut. L'utilisateur tranche :
            # un ordre alphabétique ferait de « good » l'événement sur une cible bad/good.
            suggested  = min(vals, key=lambda v: counts[str(v)])
            n_missing  = int(df[col].isna().sum())
            # Taux calculé sur la population totale (manquants exclus du numérateur)
            event_rate = round(counts[str(suggested)] / total, 4) if total else 0

            candidates.append({
                "column":             col,
                "values":             [str(v) for v in vals],
                "value_counts":       counts,
                "suggested_positive": str(suggested),
                "event_val":          str(suggested),
                "event_rate":         event_rate,
                "n_missing":          n_missing,
                "balance":            round(abs(0.5 - event_rate), 4),
            })
        # Meilleures candidates : taux le plus équilibré en premier
        candidates.sort(key=lambda x: x["balance"])
        return candidates

    # ─────────────────────────────────────────────────────────────────────────
    # 2. DISCRÉTISATION
    # ─────────────────────────────────────────────────────────────────────────
    @staticmethod
    def _fit_edges(series: pd.Series, n_bins: int = 10, target: pd.Series = None,
                   monotonic: bool = True):
        """
        Mode FIT (train uniquement) : calcule les bornes de discrétisation par quantiles.
        Retourne None si la variable doit être traitée en discret (faible cardinalité
        ou échec qcut). Les bornes extérieures sont mises à ±inf pour couvrir les valeurs
        hors-range rencontrées en test / prédiction.

        Si `monotonic` et `target` fourni : fusionne les bins adjacents qui cassent la
        tendance monotone du taux d'événement (best practice scoring crédit).
        """
        non_null = series.dropna()
        if non_null.nunique() <= n_bins:
            return None
        try:
            _, edges = pd.qcut(non_null, q=n_bins, duplicates='drop', retbins=True)
            edges = [float(e) for e in edges]
            if len(edges) < 3:
                return None
        except Exception:
            return None

        if monotonic and target is not None:
            edges = ModellingService._merge_monotonic(series, target, edges)

        edges[0]  = float('-inf')
        edges[-1] = float('inf')
        return edges

    @staticmethod
    def _merge_monotonic(series: pd.Series, target: pd.Series, edges: list) -> list:
        """
        Fusionne itérativement les bins adjacents qui violent la monotonie du taux
        d'événement, jusqu'à obtenir une tendance monotone (ou 2 bins restants).
        La direction (croissante/décroissante) est déduite de la corrélation
        rang(bin) ↔ taux d'événement.
        """
        edges  = list(edges)
        y_vals = np.asarray(target, dtype=float)

        def _event_rates(eds):
            codes = pd.cut(series, bins=eds, include_lowest=True, labels=False)
            c = np.asarray(codes, dtype=float)
            mask = ~np.isnan(c)
            d = pd.DataFrame({'c': c[mask], 'y': y_vals[mask]})
            return d.groupby('c')['y'].mean()

        er = _event_rates(edges)
        if len(er) < 3:
            return edges

        # Direction de la tendance
        try:
            corr = np.corrcoef(er.index.astype(float), er.values)[0, 1]
        except Exception:
            corr = 1.0
        sign = 1.0 if (np.isnan(corr) or corr >= 0) else -1.0

        # Fusion itérative : retire la borne intérieure entre deux bins en conflit
        while True:
            rates = _event_rates(edges).values
            if len(rates) <= 2:
                break
            violated = None
            for i in range(len(rates) - 1):
                diff = rates[i + 1] - rates[i]
                if (sign > 0 and diff < 0) or (sign < 0 and diff > 0):
                    violated = i
                    break
            if violated is None:
                break
            del edges[violated + 1]

        return edges

    @staticmethod
    def _apply_edges(series: pd.Series, edges: list) -> pd.Series:
        """
        Mode TRANSFORM : discrétise via des bornes FIXES (issues du train).
        Garantit des labels identiques entre train et test → WOE portable.
        NaN → '__missing__' ; hors-range couvert par les bornes ±inf.
        """
        binned = pd.cut(series, bins=edges, include_lowest=True)
        out = binned.astype(str)
        out[series.isna()] = '__missing__'
        return out

    @staticmethod
    def _bin_categorical(series: pd.Series) -> pd.Series:
        """
        Étiquette discrète pour le WOE ; les NaN forment le bin '__missing__'.

        Le astype(object) est indispensable : sur un dtype 'category',
        Series.apply/map n'opère que sur les catégories et renvoie une catégorie
        où les NaN restent NaN. Le groupby(observed=True) les écarterait alors
        silencieusement — pas de bin '__missing__' et lignes perdues du calcul.
        """
        return series.astype(object).map(
            lambda x: str(x) if pd.notna(x) else '__missing__'
        )

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
                       feature_cols: list = None, n_bins: int = 10,
                       positive_class=None) -> dict:
        """
        Calcule le WOE et l'IV pour chaque variable feature.
        Le bin '__missing__' regroupe les valeurs manquantes — pas d'imputation.
        positive_class : modalité de la cible traitée comme l'événement (cf.
        build_target_map) — elle fixe le signe du WOE.
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

        # Encodage cible → 0 / 1 (l'événement vaut 1)
        target_map, _ = ModellingService.build_target_map(df[target_col], positive_class)
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

            # Bornes calculées sur le train et STOCKÉES → réappliquées à l'identique au test.
            # Binning monotone : fusion des bins cassant la tendance de risque.
            edges = ModellingService._fit_edges(
                df_work[col], n_bins, target=df_work['__target__'], monotonic=True
            ) if is_numeric else None
            if edges is not None:
                df_work['__bin__'] = ModellingService._apply_edges(df_work[col], edges)
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
                "edges":           edges,   # None si discret/catégoriel
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

            # Bornes stockées au fit → mêmes labels qu'au train (WOE portable, pas de leakage)
            edges = info.get("edges")
            if edges is not None:
                binned = ModellingService._apply_edges(df[col], edges)
            else:
                binned = ModellingService._bin_categorical(df[col])

            df_out[f"{col}_woe"] = binned.map(
                lambda lbl: bin_to_woe.get(lbl, missing_woe)
            )

        return df_out
