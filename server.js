// server.js (Updated Version: No scanner.js, evaluates via /evaluate API)
import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { evaluateStudentsWithVision } from './evaluator.js';
import { scanStudentFolders } from './scanner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));

// Serve static files (like screenshots or cloned repos if needed)
app.use('/static', express.static(path.join(__dirname, 'public')));


// Mount student folders for static serving based on scan results
async function mountStudentFolders() {
  const scanned = await scanStudentFolders();

  scanned.forEach((student) => {
    if (!student.flags.includes('Missing HTML')) {
      const route = `/student/${encodeURIComponent(student.name)}`;
      app.use(route, express.static(student.basePath));
      console.log(`🔗 http://localhost:${PORT}${route}`);
    }
  });
}
// Health check
app.get('/', (req, res) => {
  res.send('✅ Visual Evaluator Backend is running');
});

// POST /evaluate
// Body: { repoUrl: string, rubric: string, expectedUrl?: string }
app.post('/evaluate', async (req, res) => {
  const { repoUrl, rubric, expectedUrl } = req.body;
  console.log({ repoUrl, rubric, expectedUrl })

  if (!repoUrl || !rubric) {
    return res.status(400).json({ error: 'Missing required fields: repoUrl and rubric' });
  }

  try {
    const results = await evaluateStudentsWithVision({ repoUrl, rubricText: rubric, expectedUrl });
    res.json({ success: true, results });
  } catch (err) {
    if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body too large" });
  }
    console.error('❌ Evaluation failed:', err);
    res.status(500).json({ error: 'Evaluation failed', details: err.message });
  }
});

app.listen(PORT, async() => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  await mountStudentFolders();
});
