// evaluator_final_with_visual_diff.js
// ✅ Final Evaluator with:
// - Dynamic rubric parsing from plain text (via GPT)
// - DOM checks using selectors
// - Vision-based grading via screenshot
// - Visual comparison with expected screenshot
// - Missing file check
// - Flag for manual correction

import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import env from 'dotenv';
import { scanStudentFolders } from './scanner.js';

env.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://localhost:3000/student';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const EXPECTED_IMAGE_PATH = path.join(SCREENSHOT_DIR, 'expected.png');
const RESULTS_PATH = path.join(__dirname, 'final_scores.json');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ✅ Facilitator's rubric input (plain English)
const plainRubric = `
Applying background image correctly to hero section with no repeat - 2
All icons in nav correctly placed and styled - 1
Favicon icon placed before title - 1
Form Includes inputs, select, textarea with required fields - 1
On click icons navigate to twitter and reddit websites, Hover effects on buttons - 1
`;

// 🔁 Parse the rubric into structured JSON using OpenAI
async function parseRubricWithSelectors(text) {
  const prompt = `Convert the following plain-text web project rubric into a JSON array. 
Each item should include: description, weight, type (visual, dom, behavior), and any inferred DOM checks if applicable.

Rubric:\n${text}\n\nReturn only the JSON.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 1000,
  });

  const raw = response.choices[0].message.content.trim();
  const cleaned = raw.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('❌ Failed to parse rubric JSON from GPT:', err);
    return [];
  }
}

// ✅ Runs DOM-based checks dynamically from rubric
async function runDynamicDomChecks(page, rubric) {
  const results = {};
  for (const item of rubric) {
    if (item.type === 'dom' && item.checks) {
      for (const check of item.checks) {
        const key = `${item.description} :: ${check.selector}`;
        try {
          const found = await page.$(check.selector);
          results[key] = !!found;
        } catch {
          results[key] = false;
        }
      }
    }
  }
  return results;
}

// 📋 Build prompt for GPT Vision API
function buildVisionPrompt(rubric, domResults) {
  let prompt = `You're a web design teacher grading student websites visually. Use the screenshot and DOM check data to score and provide feedback.`;
  prompt += `\n\nRubric:`;
  rubric.forEach((r, i) => {
    prompt += `\n${i + 1}. ${r.description} (${r.weight} points)`;
  });
  prompt += `\n\nDOM/Behavior check results:`;
  for (const [desc, passed] of Object.entries(domResults)) {
    prompt += `\n- ${desc}: ${passed ? '✅ Passed' : '❌ Not Found'}`;
  }
  prompt += `\n\nPlease provide:`;
  prompt += `\n- Total score`;
  prompt += `\n- Score breakdown per rubric item`;
  prompt += `\n- Specific feedback and suggested improvements`;
  return prompt;
}

// 🧠 Visual comparison with expected design
async function compareWithExpected(expectedPath, studentPath) {
  const expectedImage = await fs.readFile(expectedPath);
  const studentImage = await fs.readFile(studentPath);

  const comparisonPrompt = `Compare the two screenshots. If layout, spacing, color, or structure differs significantly, reply ONLY with "DIFFERENT". Else reply "SIMILAR".`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: comparisonPrompt },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${expectedImage.toString('base64')}` } },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${studentImage.toString('base64')}` } },
        ]
      }
    ]
  });

  return response.choices[0].message.content.toLowerCase().includes('different')
    ? '✅ Needs manual correction (visual diff)'
    : '❌ No visual difference';
}

// 🚀 Main evaluator function
export async function evaluateStudentsWithVision() {
  const rubric = await parseRubricWithSelectors(plainRubric);
  console.log("📋 Parsed rubric from GPT:\n", rubric);

  const students = await scanStudentFolders();
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const results = [];

  for (const student of students) {
    const name = student.name;
    const encodedName = encodeURIComponent(name);
    const url = `${BASE_URL}/${encodedName}`;

    if (student.flags.length > 0) {
      results.push({
        name,
        error: student.flags.join(', '),
        score: 0,
        feedback: `The following required files are missing: ${student.flags.join(', ')}.`
      });
      continue;
    }

    const page = await context.newPage();
    let totalScore = 0;
    let feedback = '';
    let manualFlag = '';

    try {
      await page.goto(url, { waitUntil: 'load', timeout: 15000 });

      const screenshotPath = path.join(SCREENSHOT_DIR, `${name.replace(/\s+/g, '_')}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      const domResults = await runDynamicDomChecks(page, rubric);
      const visionPrompt = buildVisionPrompt(rubric, domResults);
      const fileBytes = await fs.readFile(screenshotPath);

      // 🧠 Vision scoring
      const visionRes = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: visionPrompt },
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
      const scoreMatch = content.match(/score.*?(\d+(\.\d+)?)/i);
      totalScore = scoreMatch ? parseFloat(scoreMatch[1]) : 0;
      feedback = content;

      // 🧠 Visual comparison flag
      manualFlag = await compareWithExpected(EXPECTED_IMAGE_PATH, screenshotPath);
    } catch (err) {
      console.error(`❌ Error evaluating ${name}:`, err);
      results.push({ name, error: err.message, score: 0 });
      continue;
    } finally {
      await page.close();
    }

    results.push({ name, score: totalScore, feedback, manualFlag });
    console.log(`✅ Graded ${name}`);
  }

  await browser.close();
  await fs.writeFile(RESULTS_PATH, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`📄 All evaluations done. Saved to final_scores.json`);
}

// 🔄 Run from terminal
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  evaluateStudentsWithVision().catch(console.error);
}
