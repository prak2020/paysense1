// Paysense FX Rate Scraper v2 — Site-specific extraction
// Runs via GitHub Actions every 3 hours
// Scrapes TT Selling / Remittance rates from 8 Indian banks & ADIIs

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AUD', 'CAD'];

const CURRENCY_ALIASES = {
  'United States Dollar': 'USD', 'US Dollar': 'USD', 'US DOLLAR': 'USD',
  'U.S.Dollar': 'USD', 'DOLLAR': 'USD', 'USD': 'USD', 'USd': 'USD',
  'U.S. Dollar': 'USD', 'US Dollars': 'USD',
  'Euro': 'EUR', 'EURO': 'EUR', 'EUR': 'EUR', 'Euros': 'EUR',
  'Great Britain Pound': 'GBP', 'British Pound': 'GBP', 'Pound Sterling': 'GBP',
  'POUND STERLING': 'GBP', 'GBP': 'GBP', 'POUND': 'GBP', 'Pound': 'GBP',
  'Pound Stg.': 'GBP', 'STG. POUND': 'GBP',
  'Australian Dollar': 'AUD', 'AUSTRALIAN DOLLAR': 'AUD', 'AUD': 'AUD',
  'Aus Dollar': 'AUD', 'Aus. Dollar': 'AUD', 'AUS DOLLAR': 'AUD',
  'Canadian Dollar': 'CAD', 'CANADIAN DOLLAR': 'CAD', 'CAD': 'CAD',
  'Can Dollar': 'CAD', 'Can. Dollar': 'CAD', 'CAN DOLLAR': 'CAD',
};

function normCur(raw) {
  const t = raw.trim();
  if (CURRENCY_ALIASES[t]) return CURRENCY_ALIASES[t];
  const u = t.toUpperCase();
  for (const [alias, code] of Object.entries(CURRENCY_ALIASES)) {
    if (u === alias.toUpperCase()) return code;
  }
  // Check if text contains a 3-letter code in parens or standalone
  const m = t.match(/\b(USD|EUR|GBP|AUD|CAD)\b/i);
  if (m) return m[1].toUpperCase();
  for (const cur of CURRENCIES) {
    if (u.includes(cur)) return cur;
  }
  return null;
}

function parseRate(raw) {
  if (!raw) return null;
  const cleaned = raw.toString().replace(/[₹,\s]/g, '').trim();
  // Handle ranges like "92.83-93.74" — take the first value
  const parts = cleaned.split('-');
  const num = parseFloat(parts[0]);
  return isNaN(num) || num < 20 || num > 200 ? null : num;
}

// ────────────────────────────────────────────
// 1. ICICI — HTML table, TT Selling = column 5
// ────────────────────────────────────────────
async function scrapeICICI(page) {
  console.log('  [ICICI] Navigating...');
  await page.goto('https://www.icicibank.com/corporate/global-markets/forex/forex-card-rate', {
    waitUntil: 'networkidle', timeout: 30000,
  });
  await page.waitForTimeout(2000);

  return page.evaluate(() => {
    const results = {};
    const rows = document.querySelectorAll('table tr');
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 9) continue;
      const curText = cells[0]?.innerText?.trim() || '';
      const rateText = cells[8]?.innerText?.trim() || ''; // TT Selling = column index 8
      if (curText && rateText && /\d/.test(rateText)) {
        results[curText] = rateText;
      }
    }
    return results;
  });
}

// ────────────────────────────────────────────
// 2. AXIS — HTML table, TT Sell = column 4 (of rate columns)
//    URL may redirect; handle both old and new domains
// ────────────────────────────────────────────
async function scrapeAxis(page) {
  console.log('  [AXIS] Navigating...');
  // Try multiple URLs — Axis redirects between domains
  const urls = [
    'https://application.axisbank.co.in/webforms/corporatecardrate/index.aspx',
    'https://www.axisbank.com/forex/forex-card-rates',
  ];
  let loaded = false;
  for (const url of urls) {
    try {
      console.log('  [AXIS] Trying', url);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000); // Extra wait for JS/redirect
      loaded = true;
      break;
    } catch (e) {
      console.log('  [AXIS] Failed:', e.message.slice(0, 80));
    }
  }
  if (!loaded) return {};

  return page.evaluate(() => {
    const results = {};
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const headerCells = [];
      const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
      if (!headerRow) continue;
      headerRow.querySelectorAll('th, td').forEach((cell, idx) => {
        headerCells.push({ text: cell.innerText.trim().toLowerCase(), idx });
      });

      let ttSellIdx = -1;
      for (const h of headerCells) {
        if (h.text.includes('tt') && h.text.includes('sell')) {
          ttSellIdx = h.idx;
          break;
        }
      }
      if (ttSellIdx === -1) continue;

      const rows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length <= ttSellIdx) continue;
        const curText = cells[0]?.innerText?.trim() || '';
        const rateText = cells[ttSellIdx]?.innerText?.trim() || '';
        if (curText && rateText && /\d/.test(rateText)) {
          results[curText] = rateText;
        }
      }
      if (Object.keys(results).length > 0) break;
    }
    return results;
  });
}

// ────────────────────────────────────────────
// 3. BOB — HTML table, TT Selling column
// ────────────────────────────────────────────
async function scrapeBOB(page) {
  console.log('  [BOB] Navigating...');
  await page.goto('https://www.bankofbaroda.in/business-banking/treasury/forex-card-rates', {
    waitUntil: 'networkidle', timeout: 45000,
  });
  await page.waitForTimeout(3000);

  return page.evaluate(() => {
    const results = {};
    const tables = document.querySelectorAll('table');
    for (const table of tables) {
      const headerCells = [];
      const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
      if (!headerRow) continue;
      headerRow.querySelectorAll('th, td').forEach((cell, idx) => {
        headerCells.push({ text: cell.innerText.trim().toLowerCase(), idx });
      });

      let targetIdx = -1;
      for (const h of headerCells) {
        if ((h.text.includes('tt') && h.text.includes('sell')) || h.text.includes('tt selling')) {
          targetIdx = h.idx;
          break;
        }
      }
      if (targetIdx === -1) continue;

      const rows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length <= targetIdx) continue;
        const curText = cells[0]?.innerText?.trim() || '';
        const rateText = cells[targetIdx]?.innerText?.trim() || '';
        if (curText && rateText && /\d/.test(rateText)) {
          results[curText] = rateText;
        }
      }
      if (Object.keys(results).length > 0) break;
    }
    return results;
  });
}

// ────────────────────────────────────────────
// 4. ORIENT EXCHANGE — POST API /live_exchange_rates
//    Falls back to HTML table#summary, column 4 (Education/Medical)
// ────────────────────────────────────────────
async function scrapeOrient(page) {
  console.log('  [ORIENT] Trying API first...');

  // Try the API endpoint
  try {
    const apiRates = await page.evaluate(async () => {
      const res = await fetch('/live_exchange_rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'selLoc=&requestType=getLiveRates',
      });
      return res.json();
    });

    // Didn't work in evaluate context since we haven't navigated yet
    // Navigate first, then try
  } catch (_) {}

  await page.goto('https://www.orientexchange.in/', {
    waitUntil: 'networkidle', timeout: 30000,
  });
  await page.waitForTimeout(3000);

  // Try API via page context
  try {
    const apiResult = await page.evaluate(async () => {
      try {
        const res = await fetch('/live_exchange_rates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'selLoc=&requestType=getLiveRates',
        });
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const results = {};
          for (const item of data) {
            const code = (item.ccode || '').trim().toUpperCase();
            const rate = item.adtwo; // Education/Medical column
            if (code && rate) results[code] = String(rate);
          }
          return results;
        }
      } catch (_) {}
      return null;
    });

    if (apiResult && Object.keys(apiResult).length > 0) {
      console.log('  [ORIENT] Got rates from API');
      return apiResult;
    }
  } catch (_) {}

  // Fallback: scrape table#summary, Education/Medical = column 4 (index 3)
  console.log('  [ORIENT] API failed, scraping table...');
  return page.evaluate(() => {
    const results = {};
    const table = document.querySelector('#summary') || document.querySelector('table');
    if (!table) return results;

    const rows = table.querySelectorAll('tbody tr, tr');
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) continue;
      const curText = cells[0]?.innerText?.trim() || '';
      const rateText = cells[3]?.innerText?.trim() || ''; // Education/Medical = index 3
      if (curText && rateText && /\d/.test(rateText)) {
        results[curText] = rateText;
      }
    }
    return results;
  });
}

// ────────────────────────────────────────────
// 5. HDFC — PDF, find T.T. Selling (O/w Rem) by header position
// ────────────────────────────────────────────
async function scrapeHDFC(page) {
  console.log('  [HDFC] Downloading PDF...');
  const pdfParse = require('pdf-parse');
  const url = 'https://www.hdfcbank.com/content/dam/hdfcbank/pdf/rates/hdfc-bank-treasury-forex-card-rates.pdf';

  let pdfBuffer;
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    pdfBuffer = await response.body();
  } catch (_) {
    // Try alternate URL pattern
    try {
      const response = await page.goto(
        'https://www.hdfcbank.com/content/dam/hdfcbank/pdf/forex/forex-card-rates.pdf',
        { waitUntil: 'load', timeout: 30000 }
      );
      pdfBuffer = await response.body();
    } catch (e2) {
      console.log('  [HDFC] PDF download failed:', e2.message);
      return {};
    }
  }

  if (!pdfBuffer || pdfBuffer.length < 500) return {};

  // Check if Cloudflare returned HTML instead of PDF
  const hdrH = pdfBuffer.slice(0, 20).toString();
  if (hdrH.includes('<!') || hdrH.includes('<html') || !hdrH.includes('%PDF')) {
    console.log('  [HDFC] Response is HTML/Cloudflare block, not PDF');
    return {};
  }

  const pdfData = await pdfParse(pdfBuffer);
  const lines = pdfData.text.split('\n').map(l => l.trim()).filter(Boolean);
  const rates = {};

  // Find header line to determine column position of "T.T. Selling" or "O/w Rem"
  let ttSellColIdx = -1;
  for (const line of lines) {
    if (/T\.?T\.?\s*Sell/i.test(line) || /O\/w\s*Rem/i.test(line)) {
      // Split header by whitespace and find position
      const parts = line.split(/\s{2,}/);
      for (let i = 0; i < parts.length; i++) {
        if (/T\.?T\.?\s*Sell.*O\/w|O\/w\s*Rem/i.test(parts[i])) {
          ttSellColIdx = i;
          break;
        }
        if (/T\.?T\.?\s*Sell/i.test(parts[i]) && !/Inw|Buy/i.test(parts[i])) {
          // Could be TT Selling (multiple TT columns exist), prefer O/w Rem
          ttSellColIdx = i;
        }
      }
      if (ttSellColIdx !== -1) break;
    }
  }

  console.log(`  [HDFC] Detected TT Sell column index: ${ttSellColIdx}`);

  for (const line of lines) {
    let foundCur = null;
    for (const cur of CURRENCIES) {
      const names = Object.entries(CURRENCY_ALIASES)
        .filter(([_, code]) => code === cur)
        .map(([name]) => name);
      for (const name of names) {
        if (line.toUpperCase().includes(name.toUpperCase())) {
          foundCur = cur;
          break;
        }
      }
      if (foundCur) break;
    }
    if (!foundCur || rates[foundCur]) continue;

    const numbers = line.match(/\d+\.\d{2,4}/g);
    if (!numbers || numbers.length === 0) continue;

    // Use detected column index, or if not found, use heuristic:
    // HDFC has ~8 rate columns. TT Selling (O/w Rem) is typically the last or second-to-last selling rate.
    // Columns: Cash Buy, Cash Sell, Bills Buy, Bills Sell, TT Buy, TT Sell(Inw), TT Sell(O/w), TC Buy, TC Sell
    // O/w Rem is typically index 6 (7th number, 0-based)
    let idx = ttSellColIdx !== -1 ? ttSellColIdx : -1;

    if (idx >= 0 && idx < numbers.length) {
      rates[foundCur] = parseFloat(numbers[idx]);
    } else {
      // Fallback: among all numbers in valid range, pick the one closest to expected TT selling
      // TT Selling is usually slightly above mid-market. Pick the highest selling-range number.
      const valid = numbers.map(n => parseFloat(n)).filter(n => {
        if (foundCur === 'USD') return n > 85 && n < 110;
        if (foundCur === 'EUR') return n > 95 && n < 130;
        if (foundCur === 'GBP') return n > 110 && n < 160;
        if (foundCur === 'AUD') return n > 55 && n < 90;
        if (foundCur === 'CAD') return n > 58 && n < 90;
        return false;
      });
      // TT Selling O/w Rem is typically the 2nd-highest selling rate (after TC Sell)
      if (valid.length >= 2) {
        valid.sort((a, b) => b - a);
        rates[foundCur] = valid[1]; // second highest
      } else if (valid.length === 1) {
        rates[foundCur] = valid[0];
      }
    }
  }
  return rates;
}

// ────────────────────────────────────────────
// 6. SBI — PDF, TT Selling column
// ────────────────────────────────────────────
async function scrapeSBI(page) {
  console.log('  [SBI] Downloading PDF...');
  const pdfParse = require('pdf-parse');
  // sbi.co.in redirects to sbi.bank.in
  const url = 'https://sbi.bank.in/documents/16012/1400784/FOREX_CARD_RATES.pdf';

  let pdfBuffer;
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    pdfBuffer = await response.body();
  } catch (e) {
    console.log('  [SBI] PDF download failed, trying fetch...');
    const https = require('https');
    pdfBuffer = await new Promise((resolve, reject) => {
      https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          https.get(res.headers.location, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res2) => {
            const chunks = [];
            res2.on('data', c => chunks.push(c));
            res2.on('end', () => resolve(Buffer.concat(chunks)));
          }).on('error', reject);
          return;
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject);
    });
  }

  if (!pdfBuffer || pdfBuffer.length < 500) return {};

  // Check if response is HTML instead of PDF
  const hdrS = pdfBuffer.slice(0, 20).toString();
  if (hdrS.includes('<!') || hdrS.includes('<html') || !hdrS.includes('%PDF')) {
    console.log('  [SBI] Response is HTML, not PDF — site may be blocking');
    return {};
  }

  let pdfData;
  try {
    pdfData = await pdfParse(pdfBuffer);
  } catch (e) {
    console.warn('  [SBI] pdf-parse error:', e.message);
    return {};
  }

  const lines = pdfData.text.split('\n').map(l => l.trim()).filter(Boolean);
  const rates = {};

  // SBI PDF structure: Currency | TT Buy | TT Sell | Bill Buy | Bill Sell | Forex Card | ...
  // Find header to get TT Sell position
  let ttSellIdx = -1;
  for (const line of lines) {
    if (/TT\s*Sell/i.test(line)) {
      const parts = line.split(/\s{2,}/);
      for (let i = 0; i < parts.length; i++) {
        if (/TT\s*Sell/i.test(parts[i]) && !/Buy/i.test(parts[i])) {
          ttSellIdx = i;
          break;
        }
      }
      if (ttSellIdx !== -1) break;
    }
  }

  console.log(`  [SBI] Detected TT Sell column index: ${ttSellIdx}`);

  for (const line of lines) {
    let foundCur = null;
    for (const cur of CURRENCIES) {
      const names = Object.entries(CURRENCY_ALIASES)
        .filter(([_, code]) => code === cur)
        .map(([name]) => name);
      for (const name of names) {
        if (line.toUpperCase().includes(name.toUpperCase())) {
          foundCur = cur;
          break;
        }
      }
      if (foundCur) break;
    }
    if (!foundCur || rates[foundCur]) continue;

    const numbers = line.match(/\d+\.\d{2,4}/g);
    if (!numbers || numbers.length === 0) continue;

    // Use detected column position or fallback to index 1 (TT Sell is usually 2nd number)
    let idx = ttSellIdx !== -1 && ttSellIdx < numbers.length ? ttSellIdx : 1;
    if (idx < numbers.length) {
      const val = parseFloat(numbers[idx]);
      // Sanity check
      if (foundCur === 'USD' && val > 85 && val < 110) rates[foundCur] = val;
      else if (foundCur === 'EUR' && val > 95 && val < 130) rates[foundCur] = val;
      else if (foundCur === 'GBP' && val > 110 && val < 160) rates[foundCur] = val;
      else if (foundCur === 'AUD' && val > 55 && val < 90) rates[foundCur] = val;
      else if (foundCur === 'CAD' && val > 58 && val < 90) rates[foundCur] = val;
      // If sanity check fails, try all numbers
      else {
        for (const n of numbers) {
          const v = parseFloat(n);
          if (foundCur === 'USD' && v > 85 && v < 110) { rates[foundCur] = v; break; }
          if (foundCur === 'EUR' && v > 95 && v < 130) { rates[foundCur] = v; break; }
          if (foundCur === 'GBP' && v > 110 && v < 160) { rates[foundCur] = v; break; }
          if (foundCur === 'AUD' && v > 55 && v < 90) { rates[foundCur] = v; break; }
          if (foundCur === 'CAD' && v > 58 && v < 90) { rates[foundCur] = v; break; }
        }
      }
    }
  }
  return rates;
}

// ────────────────────────────────────────────
// 7. UNION BANK — PDF, TT Selling = first number column
// ────────────────────────────────────────────
async function scrapeUnion(page) {
  console.log('  [UNION] Downloading PDF...');
  const pdfParse = require('pdf-parse');
  const url = 'https://www.unionbankofindia.co.in/pdf/foreign-exchange-card-rates-applicable-to-various-forex-transactions.pdf';

  let pdfBuffer;
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    pdfBuffer = await response.body();
  } catch (_) {
    const https = require('https');
    pdfBuffer = await new Promise((resolve, reject) => {
      https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          https.get(res.headers.location, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res2) => {
            const chunks = [];
            res2.on('data', c => chunks.push(c));
            res2.on('end', () => resolve(Buffer.concat(chunks)));
          }).on('error', reject);
          return;
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject);
    });
  }

  if (!pdfBuffer || pdfBuffer.length < 500) return {};

  // Check if response is HTML instead of PDF
  const hdr = pdfBuffer.slice(0, 20).toString();
  if (hdr.includes('<!') || hdr.includes('<html') || !hdr.includes('%PDF')) {
    console.log('  [UNION] Response is HTML, not PDF — site may be blocking');
    return {};
  }

  const pdfData = await pdfParse(pdfBuffer);
  const lines = pdfData.text.split('\n').map(l => l.trim()).filter(Boolean);
  const rates = {};

  for (const line of lines) {
    let foundCur = null;
    for (const cur of CURRENCIES) {
      const names = Object.entries(CURRENCY_ALIASES)
        .filter(([_, code]) => code === cur)
        .map(([name]) => name);
      for (const name of names) {
        if (line.toUpperCase().includes(name.toUpperCase())) {
          foundCur = cur;
          break;
        }
      }
      if (foundCur) break;
    }
    if (!foundCur || rates[foundCur]) continue;

    const numbers = line.match(/\d+\.\d{2,4}/g);
    if (!numbers || numbers.length === 0) continue;

    // Union Bank: TT Selling is typically the first number
    const val = parseFloat(numbers[0]);
    rates[foundCur] = val;
  }
  return rates;
}

// ────────────────────────────────────────────
// 8. THOMAS COOK — JS-rendered, Remittance column
// ────────────────────────────────────────────
async function scrapeThomasCook(page) {
  console.log('  [THOMASCOOK] Navigating...');
  try {
    await page.goto('https://www.thomascook.in/foreign-exchange/forex-rate-card', {
      waitUntil: 'networkidle', timeout: 45000,
    });
  } catch (_) {
    console.log('  [THOMASCOOK] Nav timeout, trying to extract anyway...');
  }
  await page.waitForTimeout(5000);

  return page.evaluate(() => {
    const results = {};
    const tables = document.querySelectorAll('table');

    for (const table of tables) {
      const headerCells = [];
      const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
      if (!headerRow) continue;
      headerRow.querySelectorAll('th, td').forEach((cell, idx) => {
        headerCells.push({ text: cell.innerText.trim().toLowerCase(), idx });
      });

      let targetIdx = -1;
      for (const h of headerCells) {
        if (h.text.includes('remit') || (h.text.includes('sell') && h.text.includes('rate'))) {
          targetIdx = h.idx;
          break;
        }
      }
      if (targetIdx === -1) continue;

      const rows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length <= targetIdx) continue;
        const curText = cells[0]?.innerText?.trim() || '';
        const rateText = cells[targetIdx]?.innerText?.trim() || '';
        if (curText && rateText && /\d/.test(rateText)) {
          results[curText] = rateText;
        }
      }
      if (Object.keys(results).length > 0) break;
    }
    return results;
  });
}

// ────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────
const SCRAPERS = [
  { id: 'icici',      name: 'ICICI Bank',       fn: scrapeICICI },
  { id: 'axis',       name: 'Axis Bank',        fn: scrapeAxis },
  { id: 'bob',        name: 'Bank of Baroda',   fn: scrapeBOB },
  { id: 'orient',     name: 'Orient Exchange',  fn: scrapeOrient },
  { id: 'hdfc',       name: 'HDFC Bank',        fn: scrapeHDFC },
  { id: 'sbi',        name: 'SBI',              fn: scrapeSBI },
  { id: 'unionbank',  name: 'Union Bank',       fn: scrapeUnion },
  { id: 'thomascook', name: 'Thomas Cook',      fn: scrapeThomasCook },
];

async function main() {
  console.log('Paysense Rate Scraper v2 — Starting...');
  console.log(`Time: ${new Date().toISOString()}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const results = {
    updated: new Date().toISOString(),
    updated_ist: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    rates: {},
    errors: [],
  };

  for (const { id, name, fn } of SCRAPERS) {
    console.log(`\nScraping ${name} (${id})...`);
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    try {
      const rawRates = await fn(page);
      const rates = {};
      for (const [rawCur, rawRate] of Object.entries(rawRates)) {
        const cur = normCur(rawCur);
        const rate = parseRate(String(rawRate));
        if (cur && CURRENCIES.includes(cur) && rate) {
          rates[cur] = rate;
        }
      }

      const count = Object.keys(rates).length;
      if (count > 0) {
        results.rates[id] = rates;
        console.log(`  OK: ${count} rates —`, JSON.stringify(rates));
      } else {
        results.errors.push({ id, error: 'No rates extracted' });
        console.log(`  FAIL: No rates found`);
      }
    } catch (e) {
      results.errors.push({ id, error: e.message });
      console.error(`  FAIL: ${e.message}`);
    }

    await context.close();
  }

  await browser.close();

  const outPath = path.join(__dirname, '..', 'rates.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nWrote rates.json — ${Object.keys(results.rates).length}/${SCRAPERS.length} sources OK`);
  if (results.errors.length) {
    console.log('Errors:', results.errors.map(e => `${e.id}: ${e.error}`).join(' | '));
  }

  // Exit with error only if fewer than 4 sources worked
  if (Object.keys(results.rates).length < 4) {
    console.error('CRITICAL: Fewer than 3 sources succeeded');
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
