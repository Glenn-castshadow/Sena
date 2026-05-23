# Deployment Guide

---

# Synology NAS — Docker

## What you need
- Synology with Docker installed
- SSH access to the NAS (enabled in DSM → Control Panel → Terminal & SNMP)

## Actual paths

| Thing | Path |
|---|---|
| Project (source + compose) | `/volume1/Satellite_Project_work/Sena_Advertising/Job_Tracking_system` |
| Database volume | `/volume1/docker/job-tracker/data` |
| NAS IP | `10.0.7.62` |

## 1. Clone the repo

SSH in and clone to the project path:

```bash
git clone git@github.com:Glenn-castshadow/Sena.git \
  /volume1/Satellite_Project_work/Sena_Advertising/Job_Tracking_system
```

## 2. Create the data directory

```bash
sudo mkdir -p /volume1/docker/job-tracker/data
```

## 3. Create `.env.docker`

Create `.env.docker` next to `docker-compose.yml` — this file is gitignored and never baked into the image:

```bash
printf 'SESSION_SECRET=%s\n' "$(openssl rand -hex 32)" > \
  /volume1/Satellite_Project_work/Sena_Advertising/Job_Tracking_system/.env.docker
```

## 4. Build and start the container

```bash
cd /volume1/Satellite_Project_work/Sena_Advertising/Job_Tracking_system
sudo docker-compose up -d --build
```

The first build takes a few minutes — `better-sqlite3` compiles from source.

To confirm it's running:

```bash
sudo docker-compose logs -f
```

You should see: `Sena Job Tracker running at http://localhost:3000/`

## 5. Access the app

```
http://10.0.7.62:3000
```

The first visit shows the Create Admin Account screen.

## Updating the app

The Synology checkout has local config modifications (`.env`, `config.js`, etc.) that are never committed. Use stash to preserve them across pulls:

```bash
cd /volume1/Satellite_Project_work/Sena_Advertising/Job_Tracking_system

# Preserve local config, pull, restore
git stash
git pull origin main
git stash pop

# Rebuild and restart (database is safe — it lives on the mounted volume)
sudo docker-compose down
sudo docker-compose up -d --build
```

> **Note:** `docker-compose down` removes the stopped container before recreating it. If you skip it and the container is already stopped, `up` will fail with a "container name in use" conflict.

## Useful commands

```bash
sudo docker-compose logs -f sena-job-tracker    # live logs
sudo docker-compose restart                      # restart without rebuild
sudo docker-compose down                         # stop and remove container
sudo docker-compose up -d                        # start (image already built)
sudo docker-compose up -d --build               # rebuild image and start
```

---

# Deploying to Bluehost (`senaadvertising.com/jobtrack`)

## What you need
- Bluehost VPS or Cloud plan. Shared hosting does not support Node.js or `mod_proxy`.
- SSH access to the server.
- A domain already pointing to the server.

## 1. Upload the app

Upload the entire project folder to your server, for example:

```text
/home/youruser/apps/job-tracker/
```

Do not upload `node_modules/` or `jobs.db`.

## 2. Create the production `.env`

Create `/home/youruser/apps/job-tracker/.env`:

```dotenv
SESSION_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
NODE_ENV=production
BASE_PATH=/jobtrack
PORT=3000
```

Notes:
- `SESSION_SECRET` is now required in production.
- Production startup will fail fast if `SESSION_SECRET` is missing or shorter than 32 characters.
- `BASE_PATH` must start with `/` when set.

You can copy `.env.example` from this repo as your starting point.

## 3. Install dependencies and validate config

```bash
cd /home/youruser/apps/job-tracker
npm install --omit=dev
npm run check:config
```

`npm run check:config` prints the resolved startup settings and exits non-zero if production config is invalid.

## 4. Start with PM2

```bash
cd /home/youruser/apps/job-tracker
npm install -g pm2
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

After startup, confirm the app booted cleanly:

```bash
pm2 status
pm2 logs sena-job-tracker --lines 100
```

## 5. Configure Apache to proxy `/jobtrack`

Apache should forward `https://senaadvertising.com/jobtrack` to Node on port `3000`.

Option A: `.htaccess`

Copy `.htaccess` from this repo into your `public_html/` root if `AllowOverride` is enabled.

Option B: virtual host config

Add this inside your Apache `<VirtualHost>` block:

```apache
ProxyRequests Off
ProxyPreserveHost On
ProxyPass /jobtrack http://127.0.0.1:3000
ProxyPassReverse /jobtrack http://127.0.0.1:3000
```

Then enable modules and restart Apache:

```bash
sudo a2enmod proxy proxy_http
sudo systemctl restart apache2
```

## 6. First-run account setup

Visit [https://senaadvertising.com/jobtrack](https://senaadvertising.com/jobtrack).

On first run, the app shows the Create Admin Account screen. Once an account exists, that setup flow is permanently disabled.

## Updating the app

```bash
cd /home/youruser/apps/job-tracker
git pull
npm install --omit=dev
npm run check:config
pm2 restart sena-job-tracker
```

## Useful PM2 commands

```bash
pm2 status
pm2 logs sena-job-tracker
pm2 restart sena-job-tracker
pm2 stop sena-job-tracker
```
