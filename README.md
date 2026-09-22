# sc_mod

Plateforme de préparation, modélisation et déploiement de modèles ML.
Stack : **React (Vite) + Nginx** • **Node/Express** • **Python/Flask + Gunicorn**
Le tout conteneurisé avec **Docker Compose**.

```
frontend (nginx:80)  ──►  backend (node:3001)  ──►  python (flask+gunicorn:5001)
```

---

## 🚀 Déploiement en une commande

### Prérequis (à installer une seule fois par machine)

| OS               | À installer                                                                 |
|------------------|-----------------------------------------------------------------------------|
| Windows / macOS  | [Docker Desktop](https://www.docker.com/products/docker-desktop/) (inclut Compose) |
| Linux            | `docker` + `docker compose` plugin (via [get.docker.com](https://get.docker.com)) |

Vérifie que Docker est bien démarré avant de continuer.

### 1️⃣ Cloner le projet

```bash
git clone <URL-DU-REPO> sc_mod
cd sc_mod
```

### 2️⃣ Lancer tout d'un coup

**Windows (PowerShell)** :
```powershell
.\scripts\deploy.ps1 up
```

**Linux / macOS** :
```bash
make up
```

**Ou directement avec Docker Compose** (universel) :
```bash
docker compose up -d --build
```

La commande :
1. Vérifie que Docker est disponible.
2. Build les 3 images (frontend, backend, python) — installe automatiquement toutes les dépendances (npm, pip).
3. Démarre les conteneurs en arrière-plan avec healthchecks.
4. Attend que chaque service soit **prêt** avant de démarrer le suivant.

⏱️ Le premier build prend **5–15 min** (téléchargement des libs Python ML : pandas, scikit-learn, xgboost, lightgbm, ydata-profiling…).

### 3️⃣ Accéder à l'application

- **App web** : http://localhost:8080

Les services `backend` et `python` ne sont **pas** exposés à l'hôte (accès uniquement via nginx pour des raisons de sécurité).

---

## 🛠️ Commandes utiles

| Action                          | Windows                              | Linux / macOS                | Docker Compose brut                 |
|---------------------------------|--------------------------------------|------------------------------|-------------------------------------|
| Démarrer                        | `.\scripts\deploy.ps1 up`            | `make up`                    | `docker compose up -d --build`      |
| Arrêter                         | `.\scripts\deploy.ps1 down`          | `make down`                  | `docker compose down`               |
| Voir l'état + healthchecks      | `.\scripts\deploy.ps1 status`        | `make status`                | `docker compose ps`                 |
| Suivre tous les logs            | `.\scripts\deploy.ps1 logs`          | `make logs`                  | `docker compose logs -f`            |
| Logs d'un seul service          | `.\scripts\deploy.ps1 logs backend`  | `make logs SERVICE=backend`  | `docker compose logs -f backend`    |
| Redémarrer                      | `.\scripts\deploy.ps1 restart`       | `make restart`               | `docker compose restart`            |
| Rebuild sans cache              | `.\scripts\deploy.ps1 rebuild`       | `make rebuild`               | `docker compose build --no-cache`   |
| Ouvrir un shell dans un service | `.\scripts\deploy.ps1 shell backend` | `make shell-backend`         | `docker compose exec backend sh`    |
| ⚠️ Tout supprimer (+volumes)    | `.\scripts\deploy.ps1 clean`         | `make clean`                 | `docker compose down -v`            |

---

## 📂 Structure du projet

```
sc_mod/
├── docker-compose.yml     # orchestration des 3 services
├── Makefile               # commandes make (Linux/macOS)
├── scripts/
│   └── deploy.ps1         # commandes PowerShell (Windows)
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

Pour sauvegarder :
```bash
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
Un autre service utilise le port. Change le mapping dans `docker-compose.yml` :
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

### Docker Desktop refuse de démarrer sur Windows
Vérifie que la virtualisation est activée dans le BIOS et que WSL2 est installé :
```powershell
wsl --install
```

---

## 🧪 Développement local (sans Docker)

Pour itérer rapidement sur un seul service, tu peux le lancer en natif tout en gardant les autres dans Docker :

```powershell
# Ex : dev frontend en local avec hot-reload, backend/python dans Docker
docker compose up -d python backend
cd frontend
npm install
npm run dev   # http://localhost:5173, proxy /api vers docker:3001 via VITE_PROXY_TARGET
```
