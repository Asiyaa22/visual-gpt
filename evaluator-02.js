// evaluator.js (Final Version with Missing File Handling + Dynamic Rubric)
// Uses GPT to parse plain-text rubric, runs DOM checks dynamically, and visually grades via Vision API.

import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import env from 'dotenv'
import { scanStudentFolders } from './scanner.js';

env.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://localhost:3000/student';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ✏️ Input: Facilitator-provided plain-text rubric
const plainRubric = `
Applying background image correctly to hero section with no repeat - 2
All icons in nav correctly placed and styled - 1
Favicon icon placed before title - 1
Form Includes inputs, select, textarea with required fields - 1
On click icons navigate to twitter and reddit websites, Hover effects on buttons - 1
`;

// 🧠 Ask GPT to convert rubric into structured JSON with selectors
async function parseRubricWithSelectors(text) {
  const prompt = `Convert the following plain-text web project rubric into a JSON array. 
Each item should include: description, weight, type (visual, dom, behavior), and any inferred DOM checks if applicable.

Rubric:
${text}

Return only the JSON.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'user', content: prompt }
    ],
    temperature: 0.2,
    max_tokens: 1000,
  });
const raw = response.choices[0].message.content.trim();

// Step 1: Strip Markdown ```json block safely
const cleaned = raw
  .replace(/^```json/i, '')
  .replace(/^```/, '')
  .replace(/```$/, '')
  .trim();

console.log("🪵 Cleaned rubric JSON string:\n", cleaned);



  try {
    const parsed = JSON.parse(cleaned);
  return parsed;
    // const raw = response.choices[0].message.content.trim();

// Fix: remove ```json and ``` from GPT response
// const jsonString = raw
//   .replace(/^```json\\s*/i, '')   // removes starting ```json
//   .replace(/```$/, '')            // removes ending ```
//   .trim();

// console.log("🪵 Raw rubric JSON string:\n", jsonString);

// return JSON.parse(jsonString);
    // const raw = response.choices[0].message.content.trim();

// Remove code block fences like ```json ... ```
// const jsonString = raw.replace(/^```json\\s*|```$/g, '').trim();

// return JSON.parse(jsonString);
    // return JSON.parse(response.choices[0].message.content);
  } catch (err) {
    console.error('Failed to parse rubric JSON from GPT:', err);
    return [];
  }
}

// 🧪 Evaluate DOM criteria from rubric dynamically
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

// 📋 Format full Vision API prompt
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
        feedback: `The following required files are missing: ${student.flags.join(', ')}. Please ensure the student folder includes all necessary HTML and CSS files.`
      });
      continue;
    }

    const page = await context.newPage();
    let totalScore = 0;
    let feedback = '';

    try {
      await page.goto(url, { waitUntil: 'load', timeout: 15000 });

      const screenshotPath = path.join(SCREENSHOT_DIR, `${name.replace(/\s+/g, '_')}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      const domResults = await runDynamicDomChecks(page, rubric);
      const prompt = buildVisionPrompt(rubric, domResults);
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
      const scoreMatch = content.match(/Score.*?(\d+(\.\d+)?)/i);
      totalScore = scoreMatch ? parseFloat(scoreMatch[1]) : 0;
      feedback = content;
    } catch (err) {
      console.error(`❌ Error evaluating ${name}:`, err);
      results.push({ name, error: err.message, score: 0 });
      continue;
    } finally {
      await page.close();
    }

    results.push({ name, score: totalScore, feedback });
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  evaluateStudentsWithVision().catch(console.error);
}
