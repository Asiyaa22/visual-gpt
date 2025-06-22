// server.js
import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { scanStudentFolders } from './scanner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

let studentMap = {}; // exact name → path

async function initServer() {
  const scanned = await scanStudentFolders();

  // Map student names to their folder paths
  scanned.forEach((student) => {
    if (!student.flags.includes('Missing HTML')) {
      studentMap[student.name] = student.basePath;

      // ✅ Mount static server for this student
      const route = `/student/${encodeURIComponent(student.name)}`;
      app.use(route, express.static(student.basePath));
    }
  });

  // 🔁 List all working student URLs
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log("🗂 Available student URLs:");
    Object.keys(studentMap).forEach(name => {
      const encoded = encodeURIComponent(name);
      console.log(`🔗 http://localhost:${PORT}/student/${encoded}`);
    });
  });
}

initServer().catch(err => {
  console.error('❌ Server failed to start:', err);
});
