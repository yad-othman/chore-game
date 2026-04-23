# Chore Game

This app now includes:
- Login (cookie-based auth)
- Server-side database persistence in PostgreSQL
- Docker packaging for deployment
- Kubernetes manifests for DigitalOcean/k3s deployment

## Tech Stack
- Frontend: static HTML/CSS/JS (`public/index.html`)
- Backend: Node.js + Express (`server.js`)
- DB: PostgreSQL

## Local Run
1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy env file and update secrets:
   ```bash
   cp .env.example .env
   ```
3. Start app:
   ```bash
   npm start
   ```
4. Open:
   - `http://localhost:3000`

## Docker Run
```bash
docker build -t chore-game:1.0.0 .
docker run --rm -p 3000:3000 --env-file .env chore-game:1.0.0
```

## Kubernetes Deployment (DigitalOcean Droplet + k3s)
See `k8s/DO_DEPLOY.md` for full commands.

Quick summary:
1. Install k3s on your droplet.
2. Build and push the image (for example: `ghcr.io/yothman/chore-game:1.0.0`).
3. Update image in `k8s/app.yaml` if needed.
4. Create `k8s/secret.yaml` from `k8s/secret.example.yaml`.
5. Apply:
   ```bash
   kubectl apply -f k8s/secret.yaml
   kubectl apply -k k8s
   ```
6. Point Cloudflare DNS to your ingress external IP.

## Notes
- This deployment path uses containers, not RPMs. For Kubernetes on a droplet, Docker image tags are the correct release unit.
- Default admin user is controlled by `ADMIN_USERNAME` and `ADMIN_PASSWORD` in environment variables.
