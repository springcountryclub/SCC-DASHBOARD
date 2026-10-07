"""Clubessential report email (Gmail RAW JSON) -> rows in the POS Excel export layout.
usage: python3 -I mail2rows.py <gmail_get_message_raw.json> <outdir>
writes <outdir>/report.pdf, report.txt, rows.json, meta.json ({"sentAt": ISO UTC, "subject": ...})"""
import base64, email, json, os, re, subprocess, sys
from datetime import datetime, timezone
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
j = json.load(open(src))
if 'data' in j and 'raw' not in j: j = j['data']
msg = email.message_from_bytes(base64.urlsafe_b64decode(j['raw'] + '=' * (-len(j['raw']) % 4)))
pdf = next((p.get_payload(decode=True) for p in msg.walk() if (p.get_filename() or '').lower().endswith('.pdf')), None)
if not pdf: sys.exit('no PDF attachment in this email')
open(f'{out}/report.pdf', 'wb').write(pdf)
subprocess.run(['pdftotext', '-layout', f'{out}/report.pdf', f'{out}/report.txt'], check=True)
sent = datetime.fromtimestamp(int(j['internalDate']) / 1000, timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
json.dump({'sentAt': sent, 'subject': msg.get('Subject', ''), 'id': j.get('id')}, open(f'{out}/meta.json', 'w'))

AR = ['Driving Range', 'Food Truck', 'Golf Shop - Disc Golf', 'Pickleball Shop', 'Beverage Cart', 'Banquets', 'Member Events', 'Administration']
num = lambda s: float(s.replace('$', '').replace(',', '').replace('(', '-').replace(')', ''))
rows, started = [], False
def row(**k):
    r = [None] * 18
    for i, v in k.items(): r[int(i[1:])] = v
    rows.append(r)
for l in open(f'{out}/report.txt').read().replace('\f', '').splitlines():
    s = l.strip()
    if not s: continue
    if not started:
        if s.startswith('From '): row(c0=s)
        if s.startswith('Item ') and 'Units Sold' in s: row(c0='Item', c4='Units Sold'); started = True
        continue
    if (s.startswith('Item ') and 'Units Sold' in s) or re.search(r'Page \d+/\d+$', s) or s.startswith('Date '): continue
    m = re.match(r'(\d+/\d+/\d{4})\s+(.*?)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)$', s)
    if m:   # detail line: Date, Member, Area, Ref #, Tkt #, Sales, Discount, Net
        a = next((x for x in AR if x.split(' - ')[0] in m.group(2)), 'Unknown')
        row(c1=m.group(1), c6=a, c11=int(m.group(3)), c12=int(m.group(4)), c14=num(m.group(5)), c16=num(m.group(6)), c17=num(m.group(7))); continue
    m = re.match(r'(.*?):?\s+(-?[\d.]+)\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+\S+\s+\S+)?$', s)
    if m and m.group(3).startswith(('$', '-$', '($')):   # item row or a Totals row
        name = m.group(1).strip()
        if name.endswith('Totals'): name += ':'
        row(c0=name, c4=float(m.group(2)), c7=num(m.group(3)), c13=num(m.group(5))); continue
    if len(l) - len(l.lstrip()) > 30: continue   # area name wrapped onto a second line ("Golf")
    row(c0=s)
json.dump(rows, open(f'{out}/rows.json', 'w'))
print(json.dumps({'rows': len(rows), 'sentAt': sent}))
