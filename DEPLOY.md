# Deployment Guide

---

# Synology NAS — Docker (Container Manager)

## What you need
- Synology with Docker / Container Manager installed
- SSH access to the NAS (enabled in DSM → Control Panel → Terminal & SNMP)
- The `jobtracker` user already created on the NAS

## 1. Copy the project to the NAS

From your Windows machine, copy the project folder to the NAS — **without** `node_modules/` or `jobs.db`:

```powershell
# From your Windows machine (adjust the NAS share path)
robocopy "Y:\Sena_Advertising\Job_Tracking_system" "\\NAS\homes\jobtracker\job-tracker" `
  /E /XD node_modules .git .claude /XF jobs.db *.db-shm *.db-wal
```

Or use File Station in DSM to drag-and-drop the folder (exclude `node_modules`).

Target path on the NAS: `/var/services/homes/jobtracker/job-tracker/`

## 2. Create the data directory

SSH into the NAS and create the persistent data directory:

```bash
sudo mkdir -p /volume1/docker/job-tracker/data
sudo chown jobtracker:users /volume1/docker/job-tracker/data
```

## 3. Generate a session secret

Still over SSH:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

If Node isn't available on the host, you can generate one on your Windows machine first.

## 4. Create `.env.docker` next to `docker-compose.yml`

On the NAS, create `/var/services/homes/jobtracker/job-tracker/.env.docker`:

```dotenv
SESSION_SECRET=paste-your-generated-secret-here
```

This file is gitignored and never baked into the image.

## 5. Build and start the container

```bash
cd /var/services/homes/jobtracker/job-tracker
sudo docker compose build
sudo docker compose up -d
```

The first build takes a few minutes — `better-sqlite3` compiles from source.

To confirm it's running:

```bash
sudo docker compose logs -f
```

You should see: `Sena Job Tracker running at http://localhost:3000/`

## 6. Access the app

Open a browser on any machine on the network:

```
http://<NAS-IP>:3000
```

The first visit shows the Create Admin Account screen.

## Updating the app

```bash
cd /var/services/homes/jobtracker/job-tracker

# Pull latest code (or copy updated files)
git pull

# Rebuild and restart (database is safe — it's on the mounted volume)
sudo docker compose build
sudo docker compose up -d
```

## Useful commands

```bash
sudo docker compose logs -f sena-job-tracker    # live logs
sudo docker compose restart                      # restart without rebuild
sudo docker compose down                         # stop and remove container
sudo docker compose up -d                        # start again
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
