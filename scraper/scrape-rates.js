const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AUD', 'CAD'];

const SOURCES = [
  { id: 'icici', name: 'ICICI Bank', url: 'https://www.icici.bank.in/corporate/global-markets/forex/forex-card-rate', type: 'html', column: 'TT Selling' },
  { id: 'axis', name: 'Axis Bank', url: 'https://application.axisbank.co.in/webforms/corporatecardrate/index.aspx', type: 'html', column: 'TT Sell' },
  { id: 'bob', name: 'Bank of Baroda', url: 'https://bankofbaroda.bank.in/business-banking/treasury/forex-card-rates', type: 'html', column: 'TT Selling' },
  { id: 'orient', name: 'Orient Exchange', url: 'https://www.orientexchange.in/', type: 'html', column: 'Education/Medical' },
  { id: 'hdfc', name: 'HDFC Bank', url: 'https://www.hdfc.bank.in/content/dam/hdfcbankpws/in/en/personal-banking/discover-products/interest-rates/hdfc-bank-treasury-forex-card-rates.pdf', type: 'pdf', column: 'T.T. Selling (O/w Rem)' },
  { id: 'sbi', name: 'SBI', url: 'https://sbi.co.in/documents/16012/1400784/FOREX_CARD_RATES.pdf', type: 'pdf', column: 'TT Sell' },
  { id: 'unionbank', name: 'Union Bank of India', url: 'https://www.unionbankofindia.bank.in/pdf/foreign-exchange-card-rates-applicable-to-various-forex-transactions.pdf', type: 'pdf', column: 'TT Selling' },
  { id: 'yesbank', name: 'Yes Bank', url: 'https://www.yesbank.in/sites/yesbank/pdf?name=forexcardratesenglish_pdf.pdf', type: 'pdf', column: 'TT Selling' },
  { id: 'kotak', name: 'Kotak Mahindra', url: 'https://www.kotak.bank.in/en/rates/forex-rates.html', type: 'js', column: 'TT Selling' },
  { id: 'idfc', name: 'IDFC First Bank', url: 'https://www.idfcfirstbank.com/personal-banking/forex/forex-rates', type: 'js', column: 'TT Selling' },
  { id: 'canara', name: 'Canara Bank', url: 'https://www.canarabank.bank.in/pages/forex-card-rates', type: 'js', column: 'TT Selling' },
  { id: 'thomascook', name: 'Thomas Cook', url: 'https://www.thomascook.in/foreign-exchange/forex-rate-card', type: 'js', column: 'Remittance' },
];

const CURRENCY_ALIASES = {
  'United States Dollar': 'USD', 'US Dollar': 'USD', 'US DOLLAR': 'USD', 'U.S.Dollar': 'USD',
  'DOLLAR': 'USD', 'USD': 'USD', 'USd': 'USD',
  'Euro': 'EUR', 'EURO': 'EUR', 'EUR': 'EUR',
  'Great Britain Pound': 'GBP', 'British Pound': 'GBP', 'Pound Sterling': 'GBP',
  'POUND STERLING': 'GBP', 'GBP': 'GBP', 'POUND': 'GBP', 'Pound': 'GBP',
  'Australian Dollar': 'AUD', 'AUSTRALIAN DOLLAR': 'AUD', 'AUD': 'AUD', 'Aus Dollar': 'AUD',
  'Canadian Dollar': 'CAD', 'CANADIAN DOLLAR': 'CAD', 'CAD': 'CAD', 'Can Dollar': 'CAD',
};

function normalizeCurrency(raw) {
  const trimmed = raw.trim();
  if (CURRENCY_ALIASES[trimmed]) return CURRENCY_ALIASES[trimmed];
  const upper = trimmed.toUpperCase();
  for (const [alias, code] of Object.entries(CURRENCY_ALIASES)) {
    if (upper === alias.toUpperCase()) return code;
  }
  for (const cur of CURRENCIES) {
    if (upper.includes(cur)) return cur;
  }
  return null;
}

function parseRate(raw) {
  if (!raw) return null;
  const cleaned = raw.toString().replace(/[₹,\s]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

async function scrapeHTML(page, source) {
  console.log('  [HTML] ' + source.url);
  await page.goto(source.url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  const data = await page.evaluate((config) => {
    const results = {};
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const headers = [];
      const headerRow = table.querySelector('thead tr, tr:first-child');
      if (!headerRow) continue;
      headerRow.querySelectorAll('th, td').forEach((cell, idx) => {
        headers.push({ text: cell.innerText.trim(), idx });
      });
      let targetIdx = -1;
      for (const h of headers) {
        if (h.text.toLowerCase().includes(config.column.toLowerCase())) {
          targetIdx = h.idx; break;
        }
      }
      if (targetIdx === -1) continue;
      const rows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length <= targetIdx) return;
        const c = cells[0]?.innerText?.trim() || '';
        const r = cells[targetIdx]?.innerText?.trim() || '';
        if (c && r) results[c] = r;
      });
      if (Object.keys(results).length > 0) break;
    }
    return results;
  }, { column: source.column });
  const rates = {};
  for (const [rawCur, rawRate] of Object.entries(data)) {
    const cur = normalizeCurrency(rawCur);
    const rate = parseRate(rawRate);
    if (cur && CURRENCIES.includes(cur) && rate) rates[cur] = rate;
  }
  return rates;
}

async function scrapeOrient(page, source) {
  console.log('  [ORIENT] ' + source.url);
  await page.goto(source.url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  const data = await page.evaluate(() => {
    const results = {};
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const headers = [];
      const hCells = table.querySelectorAll('thead th, thead td, tr:first-child th, tr:first-child td');
      hCells.forEach((cell, idx) => { headers.push({ text: cell.innerText.trim().toLowerCase(), idx }); });
      let eduIdx = -1;
      for (const h of headers) {
        if (h.text.includes('education') || h.text.includes('medical')) { eduIdx = h.idx; break; }
      }
      if (eduIdx === -1) continue;
      const rows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length <= eduIdx) return;
        const c = cells[0]?.innerText?.trim() || '';
        const r = cells[eduIdx]?.innerText?.trim() || '';
        if (c && r) results[c] = r;
      });
      if (Object.keys(results).length > 0) break;
    }
    return results;
  });
  const rates = {};
  for (const [rawCur, rawRate] of Object.entries(data)) {
    const cur = normalizeCurrency(rawCur);
    const rate = parseRate(rawRate);
    if (cur && CURRENCIES.includes(cur) && rate) rates[cur] = rate;
  }
  return rates;
}

async function scrapePDF(page, source) {
  console.log('  [PDF] ' + source.url);
  const pdfParse = require('pdf-parse');
  let pdfBuffer;
  try {
    const response = await page.goto(source.url, { waitUntil: 'load', timeout: 30000 });
    pdfBuffer = await response.body();
  } catch (e) {
    const https = require('https');
    const http = require('http');
    pdfBuffer = await new Promise((resolve, reject) => {
      const mod = source.url.startsWith('https') ? https : http;
      mod.get(source.url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          mod.get(res.headers.location, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res2) => {
            const chunks = []; res2.on('data', c => chunks.push(c)); res2.on('end', () => resolve(Buffer.concat(chunks)));
          }).on('error', reject);
          return;
        }
        const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject);
    });
  }
  if (!pdfBuffer || pdfBuffer.length < 500) return {};
  let pdfData;
  try { pdfData = await pdfParse(pdfBuffer); } catch (e) { return {}; }
  const lines = pdfData.text.split('\n').map(l => l.trim()).filter(Boolean);
  const rates = {};
  for (const line of lines) {
    let foundCur = null;
    for (const cur of CURRENCIES) {
      const names = Object.entries(CURRENCY_ALIASES).filter(([_, code]) => code === cur).map(([name]) => name);
      for (const name of names) {
        if (line.includes(name) || line.toUpperCase().includes(name.toUpperCase())) { foundCur = cur; break; }
      }
      if (foundCur) break;
    }
    if (!foundCur || rates[foundCur]) continue;
    const numbers = line.match(/\d+\.\d{2,4}/g);
    if (!numbers) continue;
    const valid = numbers.map(n => parseFloat(n)).filter(n => {
      if (foundCur === 'USD') return n > 80 && n < 110;
      if (foundCur === 'EUR') return n > 90 && n < 130;
      if (foundCur === 'GBP') return n > 100 && n < 160;
      if (foundCur === 'AUD') return n > 50 && n < 90;
      if (foundCur === 'CAD') return n > 55 && n < 90;
      return n > 40 && n < 200;
    });
    if (valid.length === 0) continue;
    if (source.id === 'hdfc') rates[foundCur] = valid.length >= 5 ? valid[4] : valid[valid.length - 1];
    else if (source.id === 'sbi') rates[foundCur] = valid.length >= 2 ? valid[1] : valid[0];
    else rates[foundCur] = valid[0];
  }
  return rates;
}

async function scrapeJS(page, source) {
  console.log('  [JS] ' + source.url);
  try { await page.goto(source.url, { waitUntil: 'networkidle', timeout: 45000 }); } catch (e) {}
  await page.waitForTimeout(5000);
  const data = await page.evaluate((config) => {
    const results = {};
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const headers = [];
      const allRows = table.querySelectorAll('tr');
      if (allRows.length === 0) continue;
      let headerRow = table.querySelector('thead tr');
      if (!headerRow) headerRow = allRows[0];
      headerRow.querySelectorAll('th, td').forEach((cell, idx) => { headers.push({ text: cell.innerText.trim(), idx }); });
      let targetIdx = -1;
      const colLower = config.column.toLowerCase();
      for (const h of headers) {
        const hLower = h.text.toLowerCase();
        if (hLower.includes(colLower) ||
            (colLower === 'tt selling' && hLower.includes('tt') && hLower.includes('sell')) ||
            (colLower === 'remittance' && hLower.includes('remit'))) {
          targetIdx = h.idx; break;
        }
      }
      if (targetIdx === -1) continue;
      for (let i = 1; i < allRows.length; i++) {
        const cells = allRows[i].querySelectorAll('td');
        if (cells.length <= targetIdx) continue;
        const c = cells[0]?.innerText?.trim() || '';
        const r = cells[targetIdx]?.innerText?.trim() || '';
        if (c && r && /\d/.test(r)) results[c] = r;
      }
      if (Object.keys(results).length > 0) break;
    }
    return results;
  }, { column: source.column });
  const rates = {};
  for (const [rawCur, rawRate] of Object.entries(data)) {
    const cur = normalizeCurrency(rawCur);
    const rate = parseRate(rawRate);
    if (cur && CURRENCIES.includes(cur) && rate) rates[cur] = rate;
  }
  return rates;
}

async function main() {
  console.log('Paysense Rate Scraper — ' + new Date().toISOString());
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const results = { updated: new Date().toISOString(), updated_ist: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }), rates: {}, errors: [] };

  for (const source of SOURCES) {
    console.log('\n' + source.name + ' (' + source.id + ')...');
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
    const page = await context.newPage();
    try {
      let rates = {};
      if (source.id === 'orient') rates = await scrapeOrient(page, source);
      else if (source.type === 'html') rates = await scrapeHTML(page, source);
      else if (source.type === 'pdf') rates = await scrapePDF(page, source);
      else if (source.type === 'js') rates = await scrapeJS(page, source);
      if (Object.keys(rates).length > 0) {
        results.rates[source.id] = rates;
        console.log('  OK: ' + JSON.stringify(rates));
      } else {
        results.errors.push({ id: source.id, error: 'No rates extracted' });
        console.log('  FAIL: No rates');
      }
    } catch (e) {
      results.errors.push({ id: source.id, error: e.message });
      console.error('  ERR: ' + e.message);
    }
    await context.close();
  }

  await browser.close();
  const outPath = path.join(__dirname, '..', 'rates.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log('\nDone — ' + Object.keys(results.rates).length + ' sources, ' + results.errors.length + ' errors');
  if (Object.keys(results.rates).length < 4) process.exit(1);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
