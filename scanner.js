/**
 * scanner.js
 *
 * Scans student folders inside a root directory.
 * Each folder is assumed to be a student submission.
 * 
 * For each student:
 * - Finds the first .html file (as entry point)
 * - Finds all .css files
 * - Flags if any are missing
 * 
 * Outputs structured JSON for evaluation (screenshot, scoring, etc).
 */

import fs from "fs-extra";
//for async file operations
import { argv } from 'process';
import { fileURLToPath } from 'url';
import path from "path";
//for path manipulations
import { globby } from "globby";
//for recursive file seraching 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

//path to root directory where all the student folders are located
const student_root = path.join(__dirname, 'students_project');

/**
 * Scans all folders inside STUDENT_ROOT.
 * Each folder is treated as one student's submission.
 */

export const scanStudentFolders = async () => {
    //get all the entries
    const students = await fs.readdir(student_root);
    let results = [];

    for (const student of students) {

    // Skip hidden/system folders like .git, .DS_Store
    if (student.startsWith('.')) continue;
    const studentPath = path.join(student_root, student);
    const stat = await fs.stat(studentPath);

    // Skip non-directories
    if (!stat.isDirectory()) continue;

    // Recursively find .html and .css files inside student's folder
    const htmlFiles = await globby(['**/*.html'], {
      cwd: studentPath,
      absolute: true
    });

    const cssFiles = await globby(['**/*.css'], {
      cwd: studentPath,
      absolute: true
    });

    // Create flags if HTML or CSS is missing
    const flags = [];
    if (htmlFiles.length === 0) flags.push('Missing HTML');
    if (cssFiles.length === 0) flags.push('Missing CSS');

    // Add the result to our array
    results.push({
      name: student,               // folder name = student name
      html: htmlFiles[0] || null,  // use first .html file found
      css: cssFiles,               // list of all CSS files
      flags,                       // any missing file warnings
      basePath: studentPath        // useful for static serving
    });
  }

  return results;
}

// For test/debug: run script directly
if (process.argv[1] === __filename) {
  scanStudentFolders()
    .then(results => {
      console.log(JSON.stringify(results, null, 2));
    })
    .catch(err => {
      console.error('Error scanning folders:', err);
    });
}

// Export for use in other modules
export default {scanStudentFolders}




