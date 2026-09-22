# sc_mod

Plateforme de préparation, modélisation et déploiement de modèles ML.
Stack : **React (Vite) + Nginx** • **Node/Express** • **Python/Flask + Gunicorn**
Le tout conteneurisé avec **Docker Compose**.

```
frontend (nginx:80)  ──►  backend (node:3001)  ──►  python (flask+gunicorn:5001)
```

---

## 🚀 Déploiement en une commande (Windows)

### Prérequis (à installer une seule fois par machine)

1. **[Docker Desktop pour Windows](https://www.docker.com/products/docker-desktop/)** — inclut Docker + Compose + WSL2
2. **[Git pour Windows](https://git-scm.com/download/win)**

Démarre Docker Desktop et attends que l'icône soit verte dans la barre des tâches.

### 1️⃣ Cloner le projet

```powershell
git clone <URL-DU-REPO> sc_mod
cd sc_mod
```

### 2️⃣ Tout lancer

```powershell
.\scripts\deploy.ps1 up
```

Cette commande :
1. Vérifie que Docker est disponible et démarré.
2. Build les 3 images (frontend, backend, python) — installe automatiquement toutes les dépendances (npm + pip).
3. Démarre les conteneurs en arrière-plan avec healthchecks.
4. Attend que chaque service soit **prêt** avant de démarrer le suivant.

⏱️ Le premier build prend **5–15 min** (téléchargement des libs Python ML : pandas, scikit-learn, xgboost, lightgbm, ydata-profiling…). Les builds suivants sont quasi instantanés grâce au cache Docker.

### 3️⃣ Accéder à l'application

- **App web** : http://localhost:8080

Les services `backend` et `python` ne sont **pas** exposés à l'hôte (accès uniquement via nginx pour des raisons de sécurité).

---

## 🛠️ Commandes utiles

Toutes les commandes se lancent depuis la racine du projet en PowerShell.

| Action                          | Commande                              |
|---------------------------------|---------------------------------------|
| Démarrer / builder              | `.\scripts\deploy.ps1 up`             |
| Arrêter (garde les données)     | `.\scripts\deploy.ps1 down`           |
| Voir l'état + healthchecks      | `.\scripts\deploy.ps1 status`         |
| Suivre tous les logs            | `.\scripts\deploy.ps1 logs`           |
| Logs d'un seul service          | `.\scripts\deploy.ps1 logs backend`   |
| Redémarrer                      | `.\scripts\deploy.ps1 restart`        |
| Rebuild sans cache              | `.\scripts\deploy.ps1 rebuild`        |
| Ouvrir un shell dans un service | `.\scripts\deploy.ps1 shell backend`  |
| Vérifier que Docker est OK      | `.\scripts\deploy.ps1 check`          |
| ⚠️ Tout supprimer (+volumes)    | `.\scripts\deploy.ps1 clean`          |

Équivalents `docker compose` bruts si besoin :
```powershell
docker compose up -d --build     # up
docker compose down              # down
docker compose ps                # status
docker compose logs -f           # logs
```

---

## 📂 Structure du projet

```
sc_mod/
├── docker-compose.yml     # orchestration des 3 services
├── scripts/
│   └── deploy.ps1         # commandes PowerShell tout-en-un
├── frontend/              # React + Vite, servi par nginx en prod
│   ├── Dockerfile         # multi-stage : build vite → nginx
│   └── nginx.conf         # SPA + proxy /api vers backend
├── backend/               # API Node/Express
│   └── Dockerfile         # multi-stage : deps → runtime
└── python/                # API Flask (traitement ML)
    ├── Dockerfile         # gunicorn en prod
    └── requirements.txt
```

---

## 💾 Persistance des données

Les uploads et rapports sont stockés dans des **volumes Docker nommés** :

| Volume             | Monté dans           | Contient                        |
|--------------------|----------------------|---------------------------------|
| `backend_uploads`  | `/app/uploads`       | Fichiers uploadés par l'user    |
| `backend_reports`  | `/app/reports`       | Rapports HTML générés           |

Ces données **survivent** aux `down` / `restart`. Elles sont supprimées uniquement avec `clean` ou `docker compose down -v`.

Pour sauvegarder les rapports :
```powershell
docker run --rm -v sc_mod_backend_reports:/data -v ${PWD}:/backup alpine tar czf /backup/reports-backup.tar.gz -C /data .
```

---

## 🔧 Configuration

Les variables d'environnement sont définies dans [docker-compose.yml](docker-compose.yml) :

| Service  | Variable            | Valeur                      |
|----------|---------------------|-----------------------------|
| backend  | `NODE_ENV`          | `production`                |
| backend  | `FLASK_URL`         | `http://python:5001`        |
| python   | `PYTHONUNBUFFERED`  | `1`                         |

Pour surcharger ponctuellement, crée un fichier `.env` à la racine (déjà ignoré par git et Docker).

---

## 🐛 Dépannage

### Le build Python est très long
Normal au premier lancement (téléchargement de xgboost, lightgbm, scikit-learn…). Les builds suivants utilisent le cache Docker.

### `Port 8080 already in use`
Un autre service utilise le port. Change le mapping dans [docker-compose.yml](docker-compose.yml) :
```yaml
frontend:
  ports:
    - "9090:80"   # au lieu de 8080:80
```

### Un service reste `unhealthy`
```powershell
.\scripts\deploy.ps1 logs <nom-du-service>
```

### Repartir de zéro
```powershell
.\scripts\deploy.ps1 clean
.\scripts\deploy.ps1 rebuild
```

### Docker Desktop refuse de démarrer
Vérifie que la virtualisation est activée dans le BIOS et que WSL2 est installé :
```powershell
wsl --install
```

### `execution of scripts is disabled on this system`
PowerShell bloque les scripts par défaut. Autorise-les pour ta session :
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

---

## 🧪 Développement local (sans Docker)

Pour itérer rapidement sur un seul service, tu peux le lancer en natif tout en gardant les autres dans Docker :

```powershell
# Ex : dev frontend en local avec hot-reload, backend/python dans Docker
docker compose up -d python backend
cd frontend
npm install
npm run dev   # http://localhost:5173, proxy /api vers docker:3001
```
