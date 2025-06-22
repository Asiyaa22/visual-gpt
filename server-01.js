// server.js
// Serves student folders under /student/:name using Express

import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { scanStudentFolders } from './scanner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

let studentMap = {}; // maps lowercase name → student folder path

async function initServer() {
  const scanned = await scanStudentFolders();

  scanned.forEach((student) => {
    if (!student.flags.includes('Missing HTML')) {
      studentMap[student.name.toLowerCase()] = student.basePath;
    }
  });

  // Serve HTML directly (index.html)
  app.get('/student/:name', async (req, res) => {
    const name = req.params.name.toLowerCase();
    const basePath = studentMap[name];

    if (!basePath) {
      return res.status(404).send('Student folder not found or missing HTML.');
    }

    const htmlPath = path.join(basePath, 'index.html');
    try {
      await fs.access(htmlPath);
      res.sendFile(htmlPath);
    } catch {
      res.status(404).send('index.html not found in student folder.');
    }
  });

  // Serve assets like CSS/images
  app.use('/student/:name', (req, res, next) => {
    const name = req.params.name.toLowerCase();
    const basePath = studentMap[name];

    if (!basePath) return res.status(404).send('Missing student folder.');
    express.static(basePath)(req, res, next);
  });

  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`🧪 Try opening: http://localhost:${PORT}/student/Alice`);
  });
}

initServer().catch((err) => {
  console.error('❌ Server failed to start:', err);
});
