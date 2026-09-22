# Orchestrateur sc_mod (Linux / macOS)
# Sur Windows utiliser : .\scripts\deploy.ps1 <commande>

.DEFAULT_GOAL := help
.PHONY: help check up down restart rebuild logs status ps clean shell-backend shell-python shell-frontend

help:  ## Liste les commandes disponibles
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

check:  ## Vérifie que Docker et Docker Compose sont installés
	@command -v docker >/dev/null 2>&1 || { echo "Docker introuvable — installe Docker Desktop / Engine"; exit 1; }
	@docker compose version >/dev/null 2>&1 || { echo "Plugin docker compose manquant"; exit 1; }
	@docker info >/dev/null 2>&1 || { echo "Docker daemon inaccessible"; exit 1; }
	@echo "OK : Docker prêt"

up: check  ## Build et démarre tous les conteneurs en arrière-plan
	docker compose up -d --build
	@docker compose ps
	@echo "\nFrontend : http://localhost:8080"

down:  ## Arrête les conteneurs (volumes conservés)
	docker compose down

restart:  ## Redémarre tous les services (ou make restart SERVICE=backend)
	docker compose restart $(SERVICE)

rebuild: check  ## Rebuild sans cache puis redémarre
	docker compose build --no-cache
	$(MAKE) up

logs:  ## Suit les logs (make logs SERVICE=backend pour un seul service)
	docker compose logs -f --tail=200 $(SERVICE)

status:  ## Affiche l'état + consommation ressources
	@docker compose ps
	@echo ""
	@docker stats --no-stream $$(docker compose ps -q)

ps:  ## Liste les conteneurs de la stack
	docker compose ps

clean:  ## Arrête et supprime volumes (uploads, reports) — DESTRUCTIF
	@read -p "Supprimer TOUS les volumes (uploads, reports) ? [o/N] " ans; \
	if [ "$$ans" = "o" ] || [ "$$ans" = "O" ]; then \
		docker compose down -v --remove-orphans; \
		echo "Nettoyage terminé"; \
	else echo "Annulé"; fi

shell-backend:  ## Ouvre un shell dans le conteneur backend
	docker compose exec backend sh

shell-python:  ## Ouvre un shell dans le conteneur python
	docker compose exec python bash

shell-frontend:  ## Ouvre un shell dans le conteneur frontend (nginx)
	docker compose exec frontend sh
