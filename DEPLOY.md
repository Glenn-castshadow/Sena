# Deploying to Bluehost (senaadvertising.com/jobtrack)

## What you need
- Bluehost VPS or Cloud plan (shared hosting does not support Node.js or mod_proxy)
- SSH access to the server
- A domain already pointing to the server

---

## 1 — Upload the app

Upload the entire project folder to your server (e.g. via SFTP or Git):
```
/home/youruser/apps/job-tracker/
```
Do NOT upload `node_modules/` or `jobs.db` — those get created on the server.

---

## 2 — Create the production .env

SSH into the server and create `/home/youruser/apps/job-tracker/.env`:
```
SESSION_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
NODE_ENV=production
BASE_PATH=/jobtrack
PORT=3000
```

---

## 3 — Install dependencies & start with PM2

```bash
cd /home/youruser/apps/job-tracker
npm install --omit=dev
npm install -g pm2
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup   # follow the printed command to auto-start on reboot
```

---

## 4 — Configure Apache to proxy /jobtrack

On Bluehost VPS, Apache is the front-end web server. Add a proxy rule so that
requests to `senaadvertising.com/jobtrack` are forwarded to Node.js on port 3000.

**Option A — .htaccess** (if AllowOverride is on):
Copy `.htaccess` from this repo into your `public_html/` root.

**Option B — Virtual host config** (preferred on VPS):
Edit `/etc/apache2/sites-enabled/senaadvertising.com.conf` and add inside the `<VirtualHost>` block:

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

---

## 5 — First-run account setup

Visit `https://senaadvertising.com/jobtrack` in a browser.
The first visit shows the **Create Admin Account** screen — set your username and password.
This setup screen disappears permanently once an account exists.

---

## Updating the app

```bash
cd /home/youruser/apps/job-tracker
git pull          # or re-upload changed files
npm install --omit=dev
pm2 restart sena-job-tracker
```

---

## Useful PM2 commands

```bash
pm2 status                        # check if app is running
pm2 logs sena-job-tracker         # live log output
pm2 restart sena-job-tracker      # restart after code changes
pm2 stop sena-job-tracker         # stop the app
```
