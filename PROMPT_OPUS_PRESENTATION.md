# Prompt pour Claude Opus — Génération du document de présoutenance

---

Tu es un expert en rédaction de documents professionnels et académiques. Je dois préparer une **présoutenance** d'un projet de développement réalisé au sein d'une entreprise. Le document doit être structuré, convaincant, et s'adresser à un jury académique et professionnel.

---

## Contexte du projet

**Entreprise d'accueil :** Eqancy Maroc — entreprise spécialisée dans le conseil et les services data/analytiques au Maroc.

**Clients concernés par le projet :** Grandes organisations marocaines telles que Marjane (grande distribution) et la CNSS (Caisse Nationale de Sécurité Sociale).

**Projet réalisé :** Développement from scratch d'un **module de scoring automatisé** — une application web complète permettant à Eqancy de construire des modèles de scoring pour ses clients, sans dépendance à des outils externes.

**Contexte de départ :** Avant ce projet, Eqancy ne disposait d'aucun outil de scoring interne. Les analyses étaient réalisées manuellement ou sous-traitées, ce qui représente un manque de compétitivité, un coût élevé et une absence de différenciation métier.

---

## Ce que le module de scoring construit

L'application développée est une interface web complète (React + Python/Flask) composée de plusieurs modules enchaînés :

### Module 1 — Data Quality
- Analyse automatique de la qualité d'un dataset CSV uploadé
- Score global sur 100 avec 6 dimensions : Complétude, Unicité, Cohérence, Validité, Précision, Actualité
- Rapport par colonne avec alertes automatiques
- Grade de qualité (A → E)

### Module 2 — Data Cleaning
Pipeline interactif en 4 étapes avec validation utilisateur à chaque étape :
1. **Correction des types** : détection et correction automatique des types sémantiques (booléen, numérique, date, catégoriel, identifiant)
2. **Suppression des doublons** : détection de clé primaire par cardinalité, proposition à l'utilisateur
3. **Traitement des outliers** : détection IQR par colonne numérique, stratégie winsorisation ou suppression
4. **Gestion des valeurs manquantes** : 8 stratégies d'imputation ou option de conserver les NaN pour encodage WOE

### Module 3 — Data Modelling (en cours)
- Sélection de la variable cible (binaire)
- Calcul du **WOE (Weight of Evidence)** et de l'**IV (Information Value)** par variable
- Les valeurs manquantes sont traitées comme un bin distinct — pas d'imputation requise
- Exclusion automatique des colonnes identifiantes (cardinalité ≥ 90%) et des indicateurs redondants
- Dataset transformé en valeurs WOE prêt pour la régression logistique

### Module 4 — Pipeline Complet (planifié)
Enchaînement automatisé bout-en-bout : Qualité → Nettoyage → Modélisation → Export

---

## Méthodologie technique utilisée

- **WOE/IV** : approche standard en scoring crédit (Basel II/III), permet de traiter les variables continues et catégorielles de façon uniforme, gère nativement les valeurs manquantes
- **Convention scoring crédit** : WOE = ln(% non-événements / % événements) — positif = profil sain, négatif = profil risqué
- **Architecture** : frontend React (Vite), backend Flask (Python), session stateful en mémoire, API REST

---

## Structure du document à produire

Génère un document de présoutenance structuré selon ces **5 sections exactes**, dans un style professionnel et académique, adapté à un jury :

---

### 1. MISSION
Décris en 1 paragraphe la mission confiée dans le cadre de ce projet de stage/PFE chez Eqancy Maroc. La mission doit être claire, précise et formulée comme un objectif assigné par l'entreprise.

---

### 2. ENJEUX
Présente les enjeux stratégiques, économiques et opérationnels pour Eqancy Maroc et ses clients.

**Consigne importante** : chiffre les enjeux autant que possible. Utilise des statistiques réelles ou des ordres de grandeur crédibles provenant de sources sectorielles (Banque Mondiale, BAD, rapports sectoriels Maroc/Afrique, études McKinsey, Accenture, etc.) pour contextualiser :
- L'importance du scoring dans la prise de décision
- Le coût des décisions non-scorées (mauvais dossiers, risque non maîtrisé)
- Le marché de l'analytics et du scoring en Afrique/Maroc
- Le gain potentiel pour des clients comme Marjane (fidélisation, risque crédit fournisseur) et la CNSS (détection d'anomalies, scoring des bénéficiaires)

---

### 3. PROBLÉMATIQUE

Articule en 3 sous-sections :

**3.1 Besoin identifié**
Quel besoin business Eqancy cherche-t-elle à couvrir pour ses clients ? Pourquoi le scoring est-il devenu nécessaire ?

**3.2 Problèmes constatés**
Quels problèmes concrets l'absence de scoring génère-t-elle ? (décisions non-objectivées, temps d'analyse long, dépendance à des outils tiers, manque de reproductibilité, etc.)

**3.3 Causes racines**
Pourquoi ces problèmes existaient-ils ? (absence d'outil interne, données non structurées, pas de pipeline de traitement, manque de compétence outillée, etc.)

---

### 4. OBJECTIFS ET VALEUR AJOUTÉE

**4.1 Objectifs du projet**
Liste les objectifs opérationnels et techniques du module de scoring développé (objectifs SMART si possible).

**4.2 Valeur ajoutée produite**
En quoi les résultats de ce projet permettent-ils à Eqancy d'avancer dans la résolution du problème ? Traite notamment :
- Ce que l'outil apporte concrètement (autonomie, reproductibilité, rapidité)
- Ce qu'il apporte aux clients finaux (Marjane, CNSS, etc.)
- La différenciation compétitive pour Eqancy
- La scalabilité (l'outil peut être réutilisé pour d'autres clients)

---

## Consignes de forme

- Ton **professionnel et académique**, adapté à une présoutenance devant jury
- Longueur : **3 à 5 pages** équivalent A4, dense et bien structuré
- Utilise des **titres et sous-titres** clairs
- Intègre des **chiffres, pourcentages ou benchmarks** dans la section Enjeux (cite les sources)
- Le document doit pouvoir servir de **support écrit** à une présentation orale
- Langue : **Français**
- Format de sortie : texte structuré prêt à être mis en page en PDF (utilise du Markdown avec titres H1/H2/H3, listes, et gras pour les chiffres clés)
