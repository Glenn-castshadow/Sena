Sena Folder Helper
==================

This app runs on each Windows PC that accesses the Job Tracker over the network.
It lets the native folder-picker dialog open on YOUR screen instead of on the server.

──────────────────────────────────────────────────────────────────────────────
FOR END USERS (running the helper on your PC)
──────────────────────────────────────────────────────────────────────────────

1. Download SenaFolderHelper.exe from the Job Tracker:
      http://10.0.7.62:3000/helper

2. Double-click SenaFolderHelper.exe — a small console window opens:
      Sena Folder Helper v1.0.0
      Listening on http://127.0.0.1:3700

3. Keep that window open while you use the Job Tracker.
   Close it (or Ctrl+C) when done for the day.

No installation, no admin rights required. Windows 10/11 only.

OPTIONAL — Auto-start with Windows:
  1. Press Win+R, type:  shell:startup
  2. Right-click in that folder → New → Shortcut
  3. Target: full path to SenaFolderHelper.exe
  4. Click Finish

──────────────────────────────────────────────────────────────────────────────
FOR THE SERVER ADMIN (building the exe from source)
──────────────────────────────────────────────────────────────────────────────

Requirements: Node.js installed (https://nodejs.org)

Build steps:
  1. cd folder-helper
  2. Double-click build.bat   (or: npm install && npm run build)
  3. Output: folder-helper\dist\SenaFolderHelper.exe

The exe is ~40 MB (bundles Node.js 22 runtime, no install needed on target PCs).

Distribution options:
  A) Serve via Job Tracker (automatic after building):
        http://10.0.7.62:3000/helper   ← download page with instructions
  B) Copy dist\SenaFolderHelper.exe to a shared network folder manually.

The dist\ folder is .gitignored — rebuild whenever server.js changes.

──────────────────────────────────────────────────────────────────────────────
HOW IT WORKS
──────────────────────────────────────────────────────────────────────────────

• Listens on http://127.0.0.1:3700 (localhost only — not reachable from LAN)
• Browser at 10.0.7.62:3000 detects it on page load (500 ms ping)
• When you click "Create Folder", the browser calls the helper to:
    1. Show the native Windows folder-picker dialog on your machine
    2. Create the job folder + subfolders at the path you chose
    3. Report the final path back to the Job Tracker server (DB update only)
• Falls back silently to server-side dialog if helper isn't running

TROUBLESHOOTING
  "Port 3700 already in use"   — helper is already running; check taskbar
  Picker doesn't appear         — make sure the exe window is still open
  "Not trusted" SmartScreen    — click "More info" → "Run anyway" (unsigned exe)
