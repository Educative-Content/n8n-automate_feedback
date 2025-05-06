import puppeteer from 'puppeteer';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { readFile, writeFile } from 'fs/promises';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import fetch from 'node-fetch';

puppeteerExtra.use(StealthPlugin());

async function loadHeaders() {
  try {
    const headersJson = await readFile('headers.json', 'utf-8');
    return JSON.parse(headersJson);
  } catch (err) {
    console.warn('⚠️ Could not load headers.json. Using default headers.');
    return { 'Accept': 'text/html' };
  }
}

function findSlugByTitle(jsonData, targetTitle) {
  for (const category of jsonData.instance.details.toc.categories) {
    for (const page of category.pages) {
      if (page.title === targetTitle) {
        return page.id;
      }
    }
  }
  return null;
}

const turndownService = new TurndownService();
turndownService.addRule('headers', {
  filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  replacement: function (content, node) {
    const hLevel = Number(node.nodeName.charAt(1));
    return `${'#'.repeat(hLevel)} ${content}`;
  }
});

function convertKatexToMarkdown(html) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  doc.querySelectorAll('katex').forEach(katex => {
    const equation = katex.querySelector('[equation]');
    const eqText = equation?.getAttribute('equation') || katex.textContent.trim();
    katex.replaceWith(`$${eqText}$`);
  });
  return doc.body.innerHTML;
}

function fixLatex(text) {
  return `$$${text.replace(/\\/g, '\\').replace(/\n/g, '')}$$\n`;
}

async function fetchJsonWithPuppeteer(url, headers, fileName) {
  const browser = await puppeteerExtra.launch({
    executablePath: '/usr/bin/google-chrome-stable',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders(headers);

  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await page.waitForSelector('body', { timeout: 20000 });
    await page.waitForTimeout(2000);
  } catch (err) {
    console.warn('❌ Initial navigation failed, retrying once after delay...');
    await page.waitForTimeout(5000);
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
  }

  const rawJson = await page.evaluate(() => document.body.innerText);
  await browser.close();
  const parsed = JSON.parse(rawJson);
  await writeFile(fileName, JSON.stringify(parsed, null, 2), 'utf-8');
  return parsed;
}

async function fetchLessonAndParse(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
  const json = await res.json();
  const structuredContent = [];
  const title = `# ${json.summary.title}\n`;
  const summary = `${json.summary.description}\n---\n`;
  structuredContent.push(["SlateHTML", title + summary]);
  const fullMarkdown = structuredContent.map(item => item[1]).join('\n');
  await writeFile('lesson_output.md', fullMarkdown, 'utf-8');
  return fullMarkdown;
}

async function scrapeWithAuth(url, ...args) {
  const headersFromFile = await loadHeaders();

  const cookieArgs = [];
  for (const arg of args) {
    if (!arg.includes(':')) continue;
    const [key, value] = arg.split(':', 2).map(x => x.trim());
    cookieArgs.push(`${key}=${value}`);
  }

  const cookieFromFile = headersFromFile['cookie'] || headersFromFile['Cookie'] || '';
  const mergedCookie = [cookieFromFile, ...cookieArgs].filter(Boolean).join('; ');
  delete headersFromFile['cookie'];
  delete headersFromFile['Cookie'];

  const finalHeaders = {
    ...headersFromFile,
    Cookie: mergedCookie,
    'User-Agent': headersFromFile['User-Agent'] || headersFromFile['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  };

  console.log('🧠 Final headers sent:\n' + JSON.stringify(finalHeaders, null, 2));
  console.log('🍪 Final Cookie header:\n' + finalHeaders.Cookie);

  const browser = await puppeteerExtra.launch({
    executablePath: '/usr/bin/google-chrome-stable',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  await page.setExtraHTTPHeaders(finalHeaders);

  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await page.waitForSelector('body', { timeout: 20000 });
    await page.waitForTimeout(2000);
  } catch (err) {
    console.warn('❌ Navigation failed, retrying once after delay...');
    await page.waitForTimeout(5000);
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await page.waitForSelector('body', { timeout: 20000 });
  }

  await page.evaluate(() => {
    document.querySelectorAll('details').forEach(el => el.open = true);
  });

  await page.screenshot({ path: '403_debug.png' });
  const html = await page.content();
  await writeFile('403_debug.html', html, 'utf-8');
  await browser.close();

  const dom = new JSDOM(html);
  const document = dom.window.document;
  const title = document.querySelector('title');
  const ogImage = document.querySelector('meta[property="og:image"]');
  const description = document.querySelector('meta[name="description"]');
  const ogTitle = document.querySelector('meta[property="og:title"]');
  const ogImageUrl = ogImage?.getAttribute('content') || '';
  const baseImagePath = ogImageUrl.split('/image')[0];

  const metadata = {
    title: title?.textContent || '',
    description: description?.getAttribute('content') || '',
    ogImage: ogImageUrl,
    baseImagePath: baseImagePath,
    ogTitle: ogTitle?.getAttribute('content') || '',
  };

  await fetchJsonWithPuppeteer(baseImagePath, finalHeaders, 'downloaded_data.json');
  const data = JSON.parse(await readFile('downloaded_data.json', 'utf-8'));
  const slug = findSlugByTitle(data, metadata.title);
  const fullPageUrl = `${baseImagePath}/page/${slug}`;
  await fetchLessonAndParse(fullPageUrl);
  return metadata;
}

const [url, ...cookieArgs] = process.argv.slice(2);
if (!url) {
  console.error("❌ Please provide a URL: node my_parser.mjs <URL> [cf_bp:VALUE] [cf_clearance:VALUE]");
  process.exit(1);
}
scrapeWithAuth(url, ...cookieArgs).catch(err => {
  console.error("❌ Scraping failed:", err.message);
});
