// Load one Clubessential report into the tracker's day record and rebuild the staff board summary.
// usage: node ingest.js <tracker.html> <rows.json> <meta.json> <daysDir> <outDir>
//   daysDir: this month's days/<YYYY-MM-DD>.json documents as read from the tracker database
//   writes outDir/day-<date>.json (only when there is something new), outDir/board.json, outDir/data.json
process.env.TZ = 'America/Chicago';
const fs = require('fs'), path = require('path');
const [html, rowsF, metaF, daysDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const js = fs.readFileSync(html, 'utf8').split('<script>\n')[1].split('</script>')[0];
const head = js.split('// ═══ STATE')[0];
const parser = js.split('// ═══ PARSER ═')[1].replace(/^═*/, '').split('function readXLSX')[0];
const api = new Function('const state={month:{}};' + head + '\n' + parser + ';return {parseRows,dayKey,fromKey};')();
const maxTix = u => u && u.tix && u.tix.length ? u.tix[u.tix.length - 1][0] : (u && u.maxTkt) || null;
const meta = fs.existsSync(metaF) ? JSON.parse(fs.readFileSync(metaF)) : { sentAt: new Date().toISOString() };
const p = api.parseRows(fs.existsSync(rowsF) ? JSON.parse(fs.readFileSync(rowsF)) : [], 'Clubessential email ' + new Date(meta.sentAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + '.pdf');
const keys = Object.keys(p.days).sort(); let summary0 = null;
if (!keys.length) summary0 = 'no-report';   // still rebuild the board from what the database holds
const readDoc = k => { const f = path.join(daysDir, k + '.json'); if (!fs.existsSync(f)) return null; const d = JSON.parse(fs.readFileSync(f)); return d.data && d.data.uploads ? d.data : d; };
const sentDay = api.dayKey(new Date(meta.sentAt)), summary = { sentAt: meta.sentAt, report: summary0 || 'ok', days: [] };
for (const k of keys) {
  const d = p.days[k], doc = readDoc(k) || { date: k, uploads: [] }, ups = doc.uploads || [];
  const isToday = k === sentDay;
  const at = isToday ? meta.sentAt : new Date(api.fromKey(k).getTime() + (23 * 60 + 59) * 6e4).toISOString();
  const latest = ups.map(u => u.at).sort().pop();
  if (ups.some(u => u.at === at)) { summary.days.push({ date: k, status: 'already-loaded', total: d.total }); continue; }
  if (isToday && latest && latest > at) { summary.days.push({ date: k, status: 'newer-upload-exists', total: d.total }); continue; }
  const up = { at, total: d.total, groups: d.groups, areas: d.areas, tickets: d.tickets, tix: d.tix || null, file: p.file };
  if (d.emp) up.emp = d.emp;
  const out = { ...doc, date: k, uploads: isToday ? [...ups.map(u => ({ ...u, maxTkt: maxTix(u), tix: null })), up].slice(-60) : [up] };
  for (const u of out.uploads) if (u.maxTkt == null) delete u.maxTkt;
  fs.writeFileSync(path.join(outDir, 'day-' + k + '.json'), JSON.stringify(out));
  fs.writeFileSync(path.join(daysDir, k + '.json'), JSON.stringify(out));   // so the board below sees it
  summary.days.push({ date: k, status: 'new', total: d.total, people: Object.keys(d.emp || {}).length, unknownAreas: p.unknown });
}
(async () => {
  let pw; try { pw = require('playwright'); } catch { pw = require(path.join(__dirname, 'node_modules', 'playwright')); }
  const exe = ['/opt/pw-browsers/chromium'].find(f => fs.existsSync(f));
  const b = await pw.chromium.launch(exe ? { executablePath: exe } : {});
  const page = await b.newPage({ timezoneId: 'America/Chicago' });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const today = api.dayKey(new Date()), mk = today.slice(0, 7), month = {};
  for (const f of fs.readdirSync(daysDir)) if (f.startsWith(mk) && f.endsWith('.json')) { const k = f.slice(0, 10), d = readDoc(k); if (d && Array.isArray(d.uploads)) month[k] = d; }
  await page.route(/^https?:/, r => /cdnjs|jsdelivr|unpkg|fonts\./.test(r.request().url()) ? r.continue() : r.abort());
  await page.addInitScript(([k, v]) => { localStorage.setItem(k, v); }, ['scc_m_' + mk, JSON.stringify(month)]);
  await page.goto('file://' + path.resolve(html)); await page.waitForTimeout(1500);
  const board = await page.evaluate(() => typeof boardData === 'function' ? boardData() : null);
  await b.close();
  if (!board || !board.teams || board.today == null || !board.todayPeople) { console.log(JSON.stringify({ ...summary, board: 'failed', errs })); process.exit(3); }
  fs.writeFileSync(path.join(outDir, 'board.json'), JSON.stringify({ ...board, savedAt: new Date().toISOString() }));
  fs.writeFileSync(path.join(outDir, 'data.json'), JSON.stringify(board, null, 1) + '\n');
  console.log(JSON.stringify({ ...summary, board: { today: board.today, sold: board.sold, asOf: board.asOf }, errs }));
})();
