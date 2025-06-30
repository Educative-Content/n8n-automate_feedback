import puppeteer from 'puppeteer';
import { readFile, writeFile } from 'fs/promises';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { join } from 'path';
import { existsSync } from 'fs';

dotenv.config(); // Enables .env support for local dev

async function loadHeaders() {
  const filePath = join(process.cwd(), 'headers.json');

  console.log("🔍 Looking for headers.json at:", filePath);
  console.log("🧾 File exists:", existsSync(filePath));

  let headers = { Accept: 'text/html' };

  try {
    const raw = await readFile(filePath, 'utf-8');
    const fileHeaders = JSON.parse(raw);
    headers = { ...headers, ...fileHeaders };
    console.log("✅ headers.json loaded and merged.");
  } catch (err) {
    console.warn("⚠️ Could not load headers.json. Falling back.");
    console.error("🛑 Error details:", err.message);
  }
if (process.env.CF_BP) {
    headers['cf_bp'] = process.env.CF_BP;
    console.log('🔐 Using secure cf_bp header from environment.');
  }
return headers;
}


function findSlugByTitle(jsonData, targetTitle) {
  for (const category of jsonData.instance.details.toc.categories) {
    for (const page of category.pages) {
      if (page.title === targetTitle) {
        return page.id;
      }
    }
  }
  return null; // Not found
}

const turndownService = new TurndownService();

// Optional: Configure ATX-style headers
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

async function fetchLessonAndParse(url) {
  let headers = { 'Accept': 'application/json' };
  try {
    const headerJson = await readFile('headers.json', 'utf-8');
    headers = { ...headers, ...JSON.parse(headerJson) };
  } catch (err) {
    console.warn('⚠️ Could not load headers.json. Proceeding with default headers.');
  }

  const res = await fetch(url, { headers });
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
  await writeFile('lesson_output.md', fullMarkdown, 'utf-8');
  //console.log('Markdown saved to lesson_output.md');
  console.log(await readFile('lesson_output.md', 'utf-8'));
  console.log(fullMarkdown);
  return fullMarkdown;
}

async function fetchJsonWithPuppeteer(url, headers, fileName) {
  const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders(headers);

  await page.goto(url, { waitUntil: 'networkidle0' });

  const rawJson = await page.evaluate(() => document.body.innerText);

  await browser.close();

  const parsed = JSON.parse(rawJson);
  await writeFile(fileName, JSON.stringify(parsed, null, 2), 'utf-8');
  //console.log('📥JSON saved to '+fileName);
  return parsed;
}

async function scrapeWithAuth(url) {
  const headers = await loadHeaders();

  const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  await page.setExtraHTTPHeaders(headers);
  await page.goto(url, { waitUntil: 'networkidle0' });

  await page.evaluate(() => {
    document.querySelectorAll('details').forEach(el => el.open = true);
  });

  const html = await page.content();

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

  await fetchJsonWithPuppeteer(baseImagePath, headers, 'downloaded_data.json');
  const data = JSON.parse(await readFile('downloaded_data.json', 'utf-8'));
  const slug = findSlugByTitle(data, metadata.title);
  const fullPageUrl = `${baseImagePath}/page/${slug}`;
  console.log(fullPageUrl);
  await fetchLessonAndParse(fullPageUrl);
  return metadata;
}

// CLI usage
const url = process.argv[2];
if (!url) {
  console.error("❌ Please provide a URL: node scrape_with_auth.js <URL>");
  process.exit(1);
}

scrapeWithAuth(url).catch(err => {
  console.error("❌ Scraping failed:", err.message);
});
