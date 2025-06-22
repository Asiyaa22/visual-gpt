// evaluator.js
// Final version: Uses Playwright for screenshot + interactivity checks,
// and OpenAI Vision API for human-like visual evaluation.

import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { scanStudentFolders } from './scanner.js';
import OpenAI from 'openai';
import env from 'dotenv';

env.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://localhost:3000/student';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Sample: facilitator plain rubric input (in real use, passed dynamically)
const plainRubric = `
Applying background image correctly to hero section with no repeat - 2
All icons in nav correctly placed and styled - 1
Favicon icon placed before title - 1
Form Includes inputs, select, textarea with required fields - 1
On click icons navigate to twitter and reddit websites, Hover effects on buttons - 1
`;

// Parse plain English rubric into structured criteria
function parseRubricText(text) {
  const lines = text.trim().split('\n');
  return lines.map(line => {
    const [desc, weight] = line.split('-').map(s => s.trim());
    return {
      description: desc,
      weight: parseInt(weight),
    };
  });
}

// Run Playwright checks for interactivity (forms, links, hovers)
async function runPlaywrightChecks(page) {
  const results = {
    formElements: {
      input: !!(await page.$('form input')),
      select: !!(await page.$('form select')),
      textarea: !!(await page.$('form textarea')),
    },
    socialLinks: {
      twitter: !!(await page.$("a[href*='twitter.com']")),
      reddit: !!(await page.$("a[href*='reddit.com']")),
    },
    hoverEffect: await page.evaluate(() => {
      const btn = document.querySelector('button');
      if (!btn) return false;
      const before = getComputedStyle(btn).backgroundColor;
      btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      const after = getComputedStyle(btn).backgroundColor;
      return before !== after;
    })
  };
  return results;
}

// Generate a Vision API prompt with rubric and DOM results
function buildVisionPrompt(rubric, domChecks) {
  let prompt = `You're a teacher grading web design assignments. Based on this screenshot and rubric, score fairly.`;
  prompt += `\n\nRubric:`;
  rubric.forEach((r, i) => {
    prompt += `\n${i + 1}. ${r.description} (${r.weight} points)`;
  });

  prompt += `\n\nDOM/Behavior results:`;
  prompt += `\n- Form elements found: input=${domChecks.formElements.input}, select=${domChecks.formElements.select}, textarea=${domChecks.formElements.textarea}`;
  prompt += `\n- Social links found: twitter=${domChecks.socialLinks.twitter}, reddit=${domChecks.socialLinks.reddit}`;
  prompt += `\n- Hover effect on button: ${domChecks.hoverEffect}`;

  prompt += `\n\nPlease provide:`;
  prompt += `\n- Score out of total`;
  prompt += `\n- Score breakdown per rubric item`;
  prompt += `\n- Specific feedback on what needs improvement if anything`;

  return prompt;
}

// Main runner function
export async function evaluateStudentsWithVision() {
  const rubric = parseRubricText(plainRubric);
  const students = await scanStudentFolders();
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const results = [];

  for (const student of students) {
    const name = student.name;
    const encodedName = encodeURIComponent(name);
    const url = `${BASE_URL}/${encodedName}`;
    let feedback = '', breakdown = '', totalScore = 0;
    let screenshotPath = null;

    if (student.flags.includes('Missing HTML')) {
      results.push({ name, error: 'Missing HTML', score: 0 });
      continue;
    }

    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 15000 });

      const screenshotFile = `${name.replace(/\s+/g, '_')}.png`;
      screenshotPath = path.join(SCREENSHOT_DIR, screenshotFile);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      const domChecks = await runPlaywrightChecks(page);
      const prompt = buildVisionPrompt(rubric, domChecks);

      const fileBytes = await fs.readFile(screenshotPath);

      const visionRes = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: { 
                  url: `data:image/png;base64,${fileBytes.toString('base64')}` 
                }
              }
            ]
          }
        ],
        max_tokens: 1000,
      });

      const content = visionRes.choices[0].message.content;
      const scoreMatch = content.match(/Score\s*out\s*of\s*\d+\s*:\s*(\d+)/i);
      totalScore = scoreMatch ? parseInt(scoreMatch[1]) : 0;
      feedback = content;

    } catch (err) {
      console.error(`❌ Error evaluating ${name}:`, err);
      results.push({ name, error: err.message });
      continue;
    } finally {
      await page.close();
    }

    results.push({ name, screenshot: screenshotPath, score: totalScore, feedback });
    console.log(`✅ Graded ${name}`);
  }

  await browser.close();
  await fs.writeFile(
    path.join(__dirname, 'final_scores.json'),
    JSON.stringify(results, null, 2),
    'utf-8'
  );

  console.log(`📄 All evaluations done. Saved to final_scores.json`);
}

// Auto run if directly invoked
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  evaluateStudentsWithVision().catch(console.error);
}
