# Deploy Chore Game on a DigitalOcean Droplet (k3s) + Cloudflare

## 1. Prepare the droplet
Use Ubuntu 22.04+ and open ports: `22`, `80`, `443`.

Install k3s:
```bash
curl -sfL https://get.k3s.io | sh -
sudo chmod 644 /etc/rancher/k3s/k3s.yaml
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get nodes
```

## 2. Install ingress controller
k3s usually ships Traefik by default. If you use Traefik, update `k8s/ingress.yaml`:
- `ingressClassName: traefik`

If you prefer NGINX ingress, install it and keep `ingressClassName: nginx`.

## 3. Install cert-manager (for TLS)
```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.17.1/cert-manager.yaml
```

Create a cluster issuer (`letsencrypt-prod`) as needed for your email/domain.

## 4. Build and push app image
From your project:
```bash
docker build -t ghcr.io/yothman/chore-game:1.0.0 .
docker push ghcr.io/yothman/chore-game:1.0.0
```

If private registry is used, create `imagePullSecrets` in Kubernetes.

## 5. Configure secrets
Create your runtime secret file:
```bash
cp k8s/secret.example.yaml k8s/secret.yaml
```
Edit values in `k8s/secret.yaml`.

## 6. Deploy app + postgres
```bash
kubectl apply -f k8s/secret.yaml
kubectl apply -k k8s
kubectl -n chore-game get pods
kubectl -n chore-game get svc
kubectl -n chore-game get ingress
```

## 7. Cloudflare DNS
In Cloudflare DNS for `yothman.com`:
- create `A` record for `chore` -> your droplet public IP
- proxy can be ON or OFF (start OFF while validating ingress, then turn ON)

App URL:
- `https://chore.yothman.com`

If you want root domain instead, change `host` in `k8s/ingress.yaml` from `chore.yothman.com` to `yothman.com`.

## 8. Verify
```bash
curl -I https://chore.yothman.com/healthz
```
Expected: `200 OK`.
