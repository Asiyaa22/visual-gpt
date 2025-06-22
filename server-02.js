// server.js
import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { scanStudentFolders } from './scanner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

let studentMap = {}; // Maps exact student name → path

async function initServer() {
  const scanned = await scanStudentFolders();

  scanned.forEach((student) => {
    if (!student.flags.includes('Missing HTML')) {
      // ✅ Store exact name (with spaces)
      studentMap[student.name] = student.basePath;
    }
  });

  //to list all students
  app.get('/students', (req, res) => {
  res.json(Object.keys(studentMap));
});

  // Route to serve index.html
  app.get('/student/:name', async (req, res) => {
    // ✅ Decode spaces from URL and use exact name
    const rawName = decodeURIComponent(req.params.name);
    const basePath = studentMap[rawName];
    
console.log("👀 Incoming request:", rawName);
  console.log("📁 Resolved folder path:", basePath);


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

  // Serve static assets too (CSS/images)
  // app.use('/student/:name', (req, res, next) => {
  //   const rawName = decodeURIComponent(req.params.name);
  //   const basePath = studentMap[rawName];

  //   if (!basePath) return res.status(404).send('Missing student folder.');
  //   express.static(basePath)(req, res, next);
  // });
  //updated for same logic
  // Serve static files like styles.css, images, JS
// app.use('/student/:name/*', (req, res, next) => {
//   const rawName = decodeURIComponent(req.params.name);
//   const basePath = studentMap[rawName];

//   if (!basePath) {
//     return res.status(404).send('Missing student folder.');
//   }

//   const assetPath = path.join(basePath, req.path.replace(`/student/${rawName}/`, ''));
//   res.sendFile(assetPath, err => {
//     if (err) {
//       console.error(`⚠️ Failed to serve asset ${assetPath}`, err);
//       res.status(404).send('Asset not found.');
//     }
//   });
// });
//again updated for styles
// ✅ Static asset handler: CSS, images, JS inside student folder
app.use('/student/:name/', (req, res, next) => {
  const rawName = decodeURIComponent(req.params.name);
  const basePath = studentMap[rawName];

  if (!basePath) {
    return res.status(404).send('Student folder not found.');
  }

  // Remove the `/student/:name/` part to get the file path inside the folder
  const relativePath = req.path.replace(`/student/${rawName}/`, '');
  const fullAssetPath = path.join(basePath, relativePath);

  res.sendFile(fullAssetPath, (err) => {
    if (err) {
      console.error(`❌ Asset not found: ${fullAssetPath}`);
      res.status(404).send('File not found.');
    }
  });
});


  app.listen(PORT, () => {
    console.log("🗂 Available student URLs:");
Object.keys(studentMap).forEach(name => {
  const encoded = encodeURIComponent(name);
  console.log(`🔗 http://localhost:${PORT}/student/${encoded}`);
});
    // console.log(`🚀 Server running at http://localhost:${PORT}`);
    // console.log(`💡 For spaces in folder names, use URL-encoded paths like:`);
    // console.log(`👉 http://localhost:3000/student/shiva%20test%203`);
  });
}


initServer().catch((err) => {
  console.error('❌ Server failed to start:', err);
});

