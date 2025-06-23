import puppeteer from 'puppeteer';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { readFile, writeFile } from 'fs/promises';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import fetch from 'node-fetch';

puppeteerExtra.use(StealthPlugin());

/**
 * ✅ Load Headers and Cookies
 * @param {string} headersJson - Headers JSON string from CLI
 * @returns {Object} - Final headers with cookies
 */

function loadHeadersAndCookies(headersJson) {
  let headers = {
    'Accept': 'text/html',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  };

  // ✅ Load Headers from JSON
  if (headersJson) {
    try {
      const parsedHeaders = JSON.parse(headersJson);
      headers = { ...headers, ...parsedHeaders };
    } catch (err) {
      console.error("❌ Invalid Headers JSON:", headersJson);
      process.exit(1);
    }
  }

  // ✅ Load Cookies from Environment (SECURE_COOKIE)
  const secureCookie = process.env.SECURE_COOKIE || '';
  if (secureCookie) {
    headers['Cookie'] = secureCookie;
    console.log('🍪 Cookies from ENV:', headers['Cookie']);
  } else {
    console.warn('⚠️ No cookies found in ENV.');
  }

  console.log('🧠 Final Headers:\n' + JSON.stringify(headers, null, 2));
  return headers;
}

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

async function fetchLessonAndParse(url, message, headers={}) {
  // const res = await fetch(url);
  const res = await fetch(url, {
    method: 'GET',
    headers
  });
  if (!res.ok) throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
  const json = await res.json();
  const structuredContent = [];
  const title = `# ${json.summary.title}\n`;
  const summary = `${json.summary.description}\n---\n`;
  structuredContent.push(["SlateHTML", title + summary]);

    for (const x of json.components) {
    let markdownContent = "";
    if (x.type === 'SlateHTML' || x.type === 'TableHTML') {
      const preProcessed = convertKatexToMarkdown(x.content.html);
      markdownContent = turndownService.turndown(preProcessed).replace(/\\_/g, '_');
    } else if (x.type === 'Latex') {
      markdownContent = fixLatex(x.content.text);
    } else if (x.type === 'MarkdownEditor') {
      markdownContent = x.content.text;
    } 
    else if (x.type === 'Code') {
    	const lang = x.content.language || '';
  	const caption = x.content.caption ? `**${x.content.caption}**\n\n` : '';
  	const learnerCode = x.content.content || '';
  	const solutionCode = x.content.solutionContent || '';
  	const showSolution = x.content.showSolution;

  	// Learner's code block
  	markdownContent = `${caption}\`\`\`${lang}\n${learnerCode.trim()}\n\`\`\`\n`;

  	// Add collapsible solution if present and allowed
  	if (showSolution && solutionCode.trim()) {
   		 markdownContent += `<details>\n<summary> Solution</summary>\n\n`;
    		markdownContent += `\`\`\`${lang}\n${solutionCode.trim()}\n\`\`\`\n</details>\n`;
  	}
    }

    else if (x.type === 'PromptAI') {
     // Skip AI logic blocks — not user-facing
     continue;
    }
    else if (x.type === 'LazyLoadPlaceholder') {
     // Skip AI logic blocks — not user-facing
     continue;
    }
    else if (x.type === 'Notepad') {
     continue;
    }
    else if (x.type === 'DrawIOWidget') {
     continue;
    }
    else if (x.type === 'Columns') {
       for (const col of x.content.comps || []) {
          if (col.type === 'MarkdownEditor') {
            markdownContent += col.content.text + '\n\n';
          } else {
            console.log(` Skipping column sub-type: ${col.type}`);
          }
      }
    }
    else if (x.type === 'Quiz') {
         const quiz = x.content;
         markdownContent += `### Quiz: ${quiz.title || ''}\n\n`;

         quiz.questions.forEach((q, i) => {
            markdownContent += `**Q${i + 1}: ${q.questionText}**\n`;

            q.questionOptions.forEach(opt => {
               const mark = opt.correct ? '[x]' : '[ ]';
               markdownContent += `- ${mark} ${opt.text}\n`;
            });

         markdownContent += '\n';
      });
    }
    
    else if (x.type === 'WebpackBin') {
  	let markdown = `### WebpackBin Playground\n`;

  	// Step 1: Note the framework and environment
  	const enabledLoader = Object.entries(x.content.loaders || {}).find(([key, loader]) => loader.enabled);
  	if (enabledLoader) {
    		const [loaderKey, loader] = enabledLoader;
    		markdown += `**Environment:** ${loader.title}\n\n`;
  	}

  	// Step 2: Loop through file structure
  	const allFiles = [];
  	const traverse = (children = []) => {
    		for (const node of children) {
      			if (node.leaf && node.data?.content) {
        			allFiles.push({
          				fileName: node.module,
          				code: node.data.content,
          				language: node.data.language || 'javascript'
        			});
      			} else if (node.children) {
        			traverse(node.children);
     		        }
    		}
  	};
  	traverse(x.content.codeContents.children);

  	for (const file of allFiles) {
    		markdown += `\n<details>\n<summary>${file.fileName}</summary>\n\n\`\`\`${file.language}\n${file.code}\n\`\`\`\n</details>\n`;
  	}

  	// Step 3: Mention if evaluation exists
  	if (x.content.codeContents.judge?.evaluationContent) {
    		markdown += `\n<details>\n<summary>🔍 Evaluation Code</summary>\n\n\`\`\`javascript\n${x.content.codeContents.judge.evaluationContent}\n\`\`\`\n</details>\n`;
 	 }

  	// Optional: Note on Docker Job
  	if (x.content.dockerJob?.name) {
    		markdown += `\n_This widget runs in a **Live Docker container**: \`${x.content.dockerJob.name}\`_\n`;
  	}

  	structuredContent.push([x.type, markdown]);
    }

    else if (x.type === 'MatchTheAnswers') {
  	markdownContent = `### Match the Answers\n\n`;

  	const pairs = x.content.content.statements?.[0] || [];

  	pairs.forEach((pair, idx) => {
    		const left = pair.left?.text?.trim() || '—';
    		const right = pair.right?.text?.trim() || 'None provided';
    		markdownContent += `**${idx + 1}.** ${left}\n Match: *${right}*\n\n`;
                if (pair.explanation) {
  			markdownContent += `> Explanation: ${pair.explanation}\n\n`;
		}
  	});
    }
    else if (x.type === 'Table') {
  	const rows = x.content.data;

  	if (rows.length > 0) {
   	 // Parse header row
    		const headerCells = rows[0].map(cellHtml => turndownService.turndown(cellHtml).trim());
    		const header = `| ${headerCells.join(' | ')} |`;
    		const divider = `| ${headerCells.map(() => '---').join(' | ')} |`;

    	// Parse remaining rows
    		const body = rows.slice(1).map(row => {
      		const cells = row.map(cellHtml => turndownService.turndown(cellHtml).trim());
     	 return `| ${cells.join(' | ')} |`;
    	});

    	markdownContent = `${header}\n${divider}\n${body.join('\n')}\n`;
  	}
    }
    else if (x.type === 'Permutation') {
  	const prompt = x.content.question_statement || 'Reorder the following steps:';
  	const options = x.content.options || [];
  	const protectedOrder = x.content.protected_content || [];

  	markdownContent = `### Reorder the Steps\n\n**${prompt}**\n\n`;

  	// Display unordered options as "cards"
        options.forEach(opt => {
           const stepText = opt.content?.data?.trim() || '—';
           markdownContent += `- ${stepText}\n`;
        });

        // Map for solution lookup
        const idToTextMap = Object.fromEntries(
         options.map(opt => [opt.hashid, opt.content?.data?.trim() || '—'])
        );

        // Add collapsible solution
        if (protectedOrder.length) {
          markdownContent += `\n<details>\n<summary> Solution</summary>\n\n`;
          protectedOrder.forEach((hashId, idx) => {
          const line = idToTextMap[hashId] || '(missing)';
          markdownContent += `${idx + 1}. ${line}\n`;
         });
        markdownContent += `\n</details>\n`;
       }
    } else if (x.type === 'CodeTest') {
  	let markdown = `### CodeTest: ${x.content.caption || ''}\n`;

  	const languageContents = x.content.languageContents || {};
  	const additionalFiles = x.content.additionalFiles || {};

  	// Loop through all languages (Python, Java, etc.)
  	for (const [lang, langBlock] of Object.entries(languageContents)) {
    		markdown += `\n#### Language: ${lang}\n`;

    		const mainFileName = langBlock.mainFileName || `main.${lang.toLowerCase()}`;
    		const mainCode = langBlock.codeContents?.content || '';

    		if (mainCode) {
      			markdown += `\n<details>\n<summary>${mainFileName}</summary>\n\n\`\`\`${lang.toLowerCase()}\n${mainCode}\n\`\`\`\n</details>\n`;
    		}

    		// Additional files for this language
    		const extras = additionalFiles[lang] || {};
    		for (const [fileName, fileObj] of Object.entries(extras)) {
      			const extraCode = fileObj.codeContents?.content || '';
      			if (extraCode) {
        			markdown += `\n<details>\n<summary>${fileName}</summary>\n\n\`\`\`${lang.toLowerCase()}\n${extraCode}\n\`\`\`\n</details>\n`;
      			}
    		}
  	}

  	// Include solution (if available)
  	if (x.content.solution?.content) {
    		const lang = x.content.solution.language || 'text';
    		markdown += `\n<details>\n<summary>💡 Solution</summary>\n\n\`\`\`${lang.toLowerCase()}\n${x.content.solution.content}\n\`\`\`\n</details>\n`;
 	 }

  	structuredContent.push([x.type, markdown]);
    }

    else {
      console.log("Unhandled type:", x.type);
    }
    if (!markdownContent.endsWith("\n")) markdownContent += "\n";
    structuredContent.push([x.type, markdownContent]);
  }
  const fullMarkdown = structuredContent.map(item => item[1]).join('\n');
  //await writeFile('lesson_output.md', fullMarkdown, 'utf-8');
    const n8nWebhookUrl = "https://daniaahmad13.app.n8n.cloud/webhook/scrape-result"; // or pass as an argument

  await fetch(n8nWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      fullMarkdown,
      message,
      source: 'github-ci',
      user: process.env.GITHUB_ACTOR || 'unknown',
      timestamp: Date.now(),
    })
  });
  return fullMarkdown;
}

async function postErrorToWebhook({ message, reason, htmlPreview }) {
  const n8nWebhookUrl = "https://daniaahmad13.app.n8n.cloud/webhook/scrape-result";
  try {
    const res = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        status: 'failed',
        reason,
        htmlPreview,
        user: process.env.GITHUB_ACTOR || 'unknown',
        timestamp: Date.now()
      })
    });
    const text = await res.text();
    console.log(`⚠️ Webhook error report response (${res.status}):`, text);
  } catch (err) {
    console.error('❌ Failed to notify webhook of error:', err.message);
  }
}

async function scrapeWithAuth(url, message, headers, cookieString = '') {
  const cookieArgs = [];
  if (cookieString && typeof cookieString === 'string') {
    const parts = cookieString.split(';').map(x => x.trim());
    for (const part of parts) {
      if (!part.includes('=')) continue;
      cookieArgs.push(part);
    }
  }

  const mergedCookie = cookieArgs.filter(Boolean).join('; ');
  delete headers['cookie'];
  delete headers['Cookie'];

  const finalHeaders = {
    ...headers,
    Cookie: mergedCookie,
    'User-Agent': headers['User-Agent'] || headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  };

  console.log('🧠 Final headers sent:\n' + JSON.stringify(finalHeaders, null, 2));
  console.log('🍪 Final Cookie header:\n' + finalHeaders.Cookie);

  const browser = await puppeteerExtra.launch({
    executablePath: '/usr/bin/google-chrome-stable',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setExtraHTTPHeaders(finalHeaders);
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await page.waitForSelector('body', { timeout: 20000 });
    await page.waitForTimeout(3000);
  } catch (err) {
    console.warn('❌ Navigation failed, retrying...');
    await page.waitForTimeout(3000);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (err2) {
      console.error('❌ Second navigation failed:', err2.message);
      await postErrorToWebhook({ message, reason: 'navigation_failed', htmlPreview: '' });
      await browser.close();
      return null;
    }
  }

  await page.evaluate(() => {
    document.querySelectorAll('details').forEach(el => el.open = true);
  });

  const html = await page.content();
  await writeFile('403_debug.html', html, 'utf-8');
  await page.screenshot({ path: '403_debug.png' });
  console.log('📄 HTML saved, screenshot taken.');

  let dom, document;
  try {
    dom = new JSDOM(html);
    document = dom.window.document;
  } catch (err) {
    console.error('❌ JSDOM parsing failed:', err.message);
    await browser.close();
    await postErrorToWebhook({ message, reason: 'jsdom_parse_failed', htmlPreview: html.slice(0, 1000) });
    return null;
  }

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
    baseImagePath,
    ogTitle: ogTitle?.getAttribute('content') || '',
  };

  await browser.close();

  if (!metadata.title || !baseImagePath) {
    console.warn('❌ Missing metadata. Skipping fetch.');
    await postErrorToWebhook({
      message,
      reason: 'missing_metadata',
      htmlPreview: html.slice(0, 1000)
    });
    return null;
  }

  try {
    await fetchJsonWithPuppeteer(baseImagePath, finalHeaders, 'downloaded_data.json');
    const data = JSON.parse(await readFile('downloaded_data.json', 'utf-8'));
    const slug = findSlugByTitle(data, metadata.title);
    const fullPageUrl = `${baseImagePath}/page/${slug}`;

    console.log('📘 Fetching full lesson page:', fullPageUrl);
    await fetchLessonAndParse(fullPageUrl, message, finalHeaders);
    return metadata;
  } catch (err) {
    console.error('❌ Lesson parse failed:', err.message);
    await postErrorToWebhook({
      message,
      reason: 'lesson_parse_failed',
      htmlPreview: html.slice(0, 1000)
    });
    return null;
  }
}
//const [url, message, ...cookieArgs] = process.argv.slice(2);
/*const [url, message, headersJson, ...cookieArgs] = process.argv.slice(2);
if (!url) {
  console.error("❌ Please provide a URL: node my_parser.mjs <URL> [cf_bp:VALUE] [cf_clearance:VALUE]");
  process.exit(1);
}*/
const [rawInput] = process.argv.slice(2);
let parsed;
try {
  parsed = JSON.parse(rawInput);
} catch (e) {
  console.error("❌ Could not parse JSON input:", e.message);
  process.exit(1);
}

const { url, message, headersJson, cookieArgs } = parsed;
//const headers = loadHeadersAndCookies(headersJson);
  let headers = {
    'Accept': 'text/html',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  };

  // ✅ Load Headers from JSON
  if (headersJson) {
    try {
      const parsedHeaders = JSON.parse(headersJson);
      headers = { ...headers, ...parsedHeaders };
    } catch (err) {
      console.error("❌ Invalid Headers JSON:", headersJson);
      process.exit(1);
    }
}
scrapeWithAuth(url, message, headers, cookieArgs).catch(err => {
  console.error("❌ Scraping failed:", err.message);
});
