"""
Import 2026 jobs from Excel into jobs.db
Run from the project root: python import_2026.py
"""
import sqlite3, pandas as pd, re, warnings
from pathlib import Path

warnings.filterwarnings('ignore')

DB_PATH = Path(__file__).parent / 'jobs.db'
XL_PATH = r'C:\Users\glenn\OneDrive\Desktop\JOBLIST CURRENT Thru 2016.xlsx'
ISCI_PAT = re.compile(r'SA([A-Z]{2,8})(\d{2})(\d{3})([HR])', re.IGNORECASE)

# ── Load & filter ──────────────────────────────────────────────────────────
df = pd.read_excel(XL_PATH, header=0)
df = df.dropna(subset=['JOB #'])
df.columns = ['date','job_num','billing_co','client','isci_title','folder','inv_date','inv_num','po','notes']
df['date_parsed'] = pd.to_datetime(df['date'], errors='coerce')
df26 = df[df['date_parsed'].dt.year == 2026].copy().reset_index(drop=True)
print(f"2026 rows to import: {len(df26)}")

# ── Connect ────────────────────────────────────────────────────────────────
con = sqlite3.connect(DB_PATH)
con.execute('PRAGMA foreign_keys = ON')
cur = con.cursor()

# ── Clients to seed ────────────────────────────────────────────────────────
# (billing entities for jobs + ISCI advertisers)
CLIENTS = [
    # name,                        code,    isci_code
    ('Sena Advertising',           'SENA',  'SA'),       # already exists — will upsert
    ('SDCCU',                      'SDCCU', 'DC'),
    ('Lawyer in Blue Jeans',       'LIBJ',  'LIBJ'),
    ('Spring Home Garden',         'MPP',   'MPP'),
    ('CA Homebuilding Foundation', 'CHF',   'CHF'),
    ('Bell Leadership Institute',  'SED',   'SED'),
    # ISCI advertisers (Sena-managed)
    ('Future Auto Group',          'FA',    'FA'),
    ('Future Ford Roseville/Sac',  'FFRS',  'FFRS'),
    ('Future Kia Clovis',          'FKC',   'FKC'),
    ('Future Toyota Yuba City',    'FTYC',  'FTYC'),
    ('Kearny Mesa Kia',            'KMK',   'KMK'),
    ('Kearny Mesa Subaru',         'KMS',   'KMS'),
    ('Maderas Golf Course',        'MAD',   'MAD'),
    ('Sunroad KM Land',            'SKML',  'SKML'),
]

print("\nUpserting clients...")
for name, code, isci_code in CLIENTS:
    cur.execute(
        'INSERT INTO clients (name, code, isci_code) VALUES (?,?,?) '
        'ON CONFLICT(code) DO UPDATE SET name=excluded.name, isci_code=excluded.isci_code',
        (name, code, isci_code)
    )

con.commit()

# Build code→id lookup
client_map = {row[1]: row[0] for row in cur.execute('SELECT id, code FROM clients').fetchall()}
print(f"Client IDs: {client_map}")

# ── Billing code → client code map ────────────────────────────────────────
# Maps the billing company code found in job_num to a client code in our DB
BILLING_TO_CODE = {
    'SENA':  'SENA',
    'SDCCU': 'SDCCU',
    'LIBJ':  'LIBJ',
    'MPP':   'MPP',
    'CHF':   'CHF',
    'SED':   'SED',
}

# ── Import jobs ────────────────────────────────────────────────────────────
print("\nImporting jobs...")
job_id_map = {}  # job_num_str → db id

for _, row in df26.iterrows():
    job_num_str = str(row['job_num']).strip()

    # Serial and billing code from job number
    m_serial = re.match(r'^(\d+)([A-Za-z]+)', job_num_str)
    if not m_serial:
        print(f"  SKIP (bad job number): {job_num_str}")
        continue

    serial    = int(m_serial.group(1))
    bill_code = m_serial.group(2).upper()
    client_code = BILLING_TO_CODE.get(bill_code, bill_code)
    client_id = client_map.get(client_code)
    if not client_id:
        print(f"  SKIP (unknown client code {client_code}): {job_num_str}")
        continue

    # Description: first non-empty line of isci_title, else folder name
    title_raw = str(row['isci_title']) if pd.notna(row['isci_title']) else ''
    first_line = next((l.strip() for l in title_raw.splitlines() if l.strip()), '')
    description = first_line if first_line else job_num_str

    # Folder
    folder_raw = str(row['folder']).strip() if pd.notna(row['folder']) else ''
    folder_created = 1 if folder_raw and folder_raw != 'nan' else 0

    # Job number string (use folder name if available, it's the canonical form)
    db_job_number = folder_raw if folder_created else job_num_str

    # Status
    inv_str = str(row['inv_date']).upper()
    status = 'voided' if 'VOID' in inv_str else 'active'

    # Notes: combine invoice + PO + original notes
    notes_parts = []
    if pd.notna(row['inv_date']) and 'VOID' not in str(row['inv_date']).upper():
        notes_parts.append(f"Invoiced: {row['inv_date']}")
    if pd.notna(row['inv_num']) and str(row['inv_num']).strip() not in ('', 'nan', 'VOID'):
        notes_parts.append(f"Invoice #: {row['inv_num']}")
    if pd.notna(row['po']) and str(row['po']).strip() not in ('', 'nan'):
        notes_parts.append(f"PO: {row['po']}")
    if pd.notna(row['notes']) and str(row['notes']).strip() not in ('', 'nan'):
        notes_parts.append(str(row['notes']).strip())
    notes = '\n'.join(notes_parts) if notes_parts else None

    # Date
    created_at = row['date_parsed'].strftime('%Y-%m-%d') if pd.notna(row['date_parsed']) else None

    try:
        cur.execute(
            'INSERT OR IGNORE INTO jobs '
            '(serial, job_number, client_id, description, folder_path, folder_created, status, notes, created_at) '
            'VALUES (?,?,?,?,?,?,?,?,?)',
            (serial, db_job_number, client_id, description, folder_raw or None,
             folder_created, status, notes, created_at)
        )
        if cur.rowcount:
            job_id = cur.lastrowid
            job_id_map[job_num_str] = job_id
            print(f"  + {db_job_number} [{status}]")
        else:
            existing = cur.execute('SELECT id FROM jobs WHERE serial=?', (serial,)).fetchone()
            if existing:
                job_id_map[job_num_str] = existing[0]
            print(f"  ~ already exists: {db_job_number}")
    except Exception as e:
        print(f"  ERROR {job_num_str}: {e}")

con.commit()

# ── Import ISCI codes ──────────────────────────────────────────────────────
print("\nImporting ISCI codes...")
# ISCI advertiser code → client code map
ISCI_CLIENT_MAP = {c[2]: c[1] for c in CLIENTS}  # isci_code → code

isci_inserted = 0
for _, row in df26.iterrows():
    job_num_str = str(row['job_num']).strip()
    job_id = job_id_map.get(job_num_str)
    title_raw = str(row['isci_title']) if pd.notna(row['isci_title']) else ''

    for m in ISCI_PAT.finditer(title_raw):
        advertiser_isci = m.group(1).upper()
        year            = m.group(2)
        serial_str      = m.group(3)
        media_type      = m.group(4).upper()
        full_code       = f'SA{advertiser_isci}{year}{serial_str}{media_type}'
        serial_num      = int(serial_str)

        # Find the client by ISCI code
        client_code = ISCI_CLIENT_MAP.get(advertiser_isci)
        if not client_code:
            # Try to find by code directly
            client_code = advertiser_isci
        client_id = client_map.get(client_code)
        if not client_id:
            # Fall back to SENA
            client_id = client_map.get('SENA')

        # Description: find the line in isci_title that contains this ISCI code
        desc = ''
        for line in title_raw.splitlines():
            if full_code.upper() in line.upper():
                desc = re.sub(re.escape(full_code), '', line, flags=re.IGNORECASE).strip()
                break

        try:
            cur.execute(
                'INSERT OR IGNORE INTO isci_codes '
                '(code, client_id, job_id, year, serial, media_type, description) '
                'VALUES (?,?,?,?,?,?,?)',
                (full_code, client_id, job_id, year, serial_num, media_type, desc or None)
            )
            if cur.rowcount:
                isci_inserted += 1
                print(f"  + {full_code}  ({desc[:50] if desc else ''})")
        except Exception as e:
            print(f"  ERROR {full_code}: {e}")

con.commit()

# ── Update next serial ─────────────────────────────────────────────────────
max_serial = df26['job_num'].str.extract(r'^(\d+)')[0].astype(float).max()
next_serial = int(max_serial) + 1
cur.execute("UPDATE settings SET value=? WHERE key='next_job_serial'", (str(next_serial),))
con.commit()

print(f"\nDone.")
print(f"  Jobs imported:      {len(job_id_map)}")
print(f"  ISCI codes added:   {isci_inserted}")
print(f"  Next job serial:    {next_serial}")
con.close()
