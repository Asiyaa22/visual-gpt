// server.js (Updated Version: No scanner.js, evaluates via /evaluate API)
import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { evaluateStudentsWithVision } from './evaluator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

app.use(express.json());

// Serve static files (like screenshots or cloned repos if needed)
app.use('/static', express.static(path.join(__dirname, 'public')));

// Health check
app.get('/', (req, res) => {
  res.send('✅ Visual Evaluator Backend is running');
});

// POST /evaluate
// Body: { repoUrl: string, rubric: string, expectedUrl?: string }
app.post('/evaluate', async (req, res) => {
  const { repoUrl, rubric, expectedUrl } = req.body;

  if (!repoUrl || !rubric) {
    return res.status(400).json({ error: 'Missing required fields: repoUrl and rubric' });
  }

  try {
    const results = await evaluateStudentsWithVision({ repoUrl, rubric, expectedUrl });
    res.json({ success: true, results });
  } catch (err) {
    console.error('❌ Evaluation failed:', err);
    res.status(500).json({ error: 'Evaluation failed', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
