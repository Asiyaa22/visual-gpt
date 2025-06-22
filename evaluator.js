// evaluator.js (Final Version with Visual Comparison, Missing File Handling, Dynamic Rubric, GitHub Clone Support)
// This backend automates HTML/CSS project grading using DOM + Visual + Behavioral evaluation.
// Facilitator provides: GitHub Repo URL, Expected Output URL, and Rubric in plain English.

import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { exec } from 'child_process';
import util from 'util';
import env from 'dotenv';
import { scanStudentFolders } from './scanner.js';

env.config();

const execPromise = util.promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const STUDENT_DIR = path.join(__dirname, 'students_project');
const EXPECTED_PATH = path.join(SCREENSHOT_DIR, 'expected.png');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 🔁 Clone GitHub repo from facilitator input
export async function cloneGitRepo(gitUrl) {
  if (await fs.stat(STUDENT_DIR).catch(() => false)) {
    await fs.rm(STUDENT_DIR, { recursive: true });
  }
  await execPromise(`git clone ${gitUrl} ${STUDENT_DIR}`);
  console.log('✅ Cloned student repo');
}

// 🧠 Convert rubric input from facilitator to JSON with types
export async function parseRubricWithSelectors(text) {
  const prompt = `Convert the following plain-text web project rubric into a JSON array. Each item should include: description, weight, type (visual, dom, behavior), and any inferred DOM checks.

Rubric:
${text}

Return only the JSON.`;
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
    console.error('❌ Failed to parse rubric JSON:', err);
    return [];
  }
}

// 🧪 DOM checks from rubric
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

// 🧠 Build Vision API prompt
function buildVisionPrompt(rubric, domResults, compareWithExpected = false) {
  let prompt = `You're grading assitant at Barabari. Use the screenshot, DOM/behavior info${compareWithExpected ? ' and compare it with expected design screenshot' : ''} to score.`;
  prompt += `\n\nRubric:`;
  rubric.forEach((r, i) => {
    prompt += `\n${i + 1}. ${r.description} (${r.weight} points)`;
  });
  prompt += `\n\nDOM Results:`;
  for (const [desc, passed] of Object.entries(domResults)) {
    prompt += `\n- ${desc}: ${passed ? '✅' : '❌'}`;
  }
  prompt += `\n\nPlease provide:`;
  prompt += `\n- Total score\n- Score breakdown\n- Specific feedback and suggestions\n- Flag if manual correction needed due to visual mismatch`
  return prompt;
}

export async function evaluateStudentsWithVision({ rubricText, expectedUrl, repoUrl }) {
  await cloneGitRepo(repoUrl);
  const rubric = await parseRubricWithSelectors(rubricText);
  console.log('📋 Rubric:', rubric);

  const students = await scanStudentFolders();
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext();

  // 🎯 Take screenshot of expected output
  const expectedPage = await context.newPage();
  await expectedPage.goto(expectedUrl, { waitUntil: 'load', timeout: 20000 });
  await expectedPage.screenshot({ path: EXPECTED_PATH, fullPage: true });
  await expectedPage.close();
  const expectedImg = await fs.readFile(EXPECTED_PATH);

  const results = [];

  for (const student of students) {
    const name = student.name;
    const encodedName = encodeURIComponent(name);
    const url = `http://localhost:3000/student/${encodedName}`;

    if (student.flags.length > 0) {
      results.push({
        name,
        error: student.flags.join(', '),
        score: 0,
        feedback: `Missing files: ${student.flags.join(', ')}`,
        manualCorrection: true,
      });
      continue;
    }

    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 15000 });
      const screenshotPath = path.join(SCREENSHOT_DIR, `${name.replace(/\s+/g, '_')}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      const domResults = await runDynamicDomChecks(page, rubric);
      const studentImage = await fs.readFile(screenshotPath);

      const visionPrompt = buildVisionPrompt(rubric, domResults, true);

      const visionRes = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: visionPrompt },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${studentImage.toString('base64')}` } },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${expectedImg.toString('base64')}` } }
            ]
          }
        ]
      });

      const response = visionRes.choices[0].message.content;
      const scoreMatch = response.match(/Score.*?(\d+(\.\d+)?)/i);
      const totalScore = scoreMatch ? parseFloat(scoreMatch[1]) : 0;
      const needsManualCorrection = /manual correction/i.test(response);

      results.push({
        name,
        score: totalScore,
        feedback: response,
        manualCorrection: needsManualCorrection || false
      });
    } catch (err) {
      results.push({ name, score: 0, error: err.message, manualCorrection: true });
    } finally {
      await page.close();
    }
  }

  await browser.close();
  await fs.writeFile(path.join(__dirname, 'final_scores.json'), JSON.stringify(results, null, 2), 'utf-8');
  console.log('📄 All evaluations saved to final_scores.json');
}

// CLI testing support
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sampleInput = {
    rubricText: `Applying background image correctly to hero section with no repeat - 2\nAll icons in nav correctly placed and styled - 1\nFavicon icon placed before title - 1\nForm Includes inputs, select, textarea with required fields - 1\nOn click icons navigate to twitter and reddit websites, Hover effects on buttons - 1`,
    expectedUrl: 'https://expected-design.vercel.app',
    repoUrl: 'https://github.com/your-org/student-submissions'
  };
  evaluateStudentsWithVision(sampleInput).catch(console.error);
}
