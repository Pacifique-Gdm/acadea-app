import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { roles, sections } from './sectionStagingPlan.mjs';
const directory = 'test-results/section-evidence';
const results = [];
for (const [role, allowed] of Object.entries(roles)) {
  const pdf = join(directory, `${role}-students.pdf`), prefix = join(directory, `${role}-render`);
  execFileSync('pdftoppm', ['-r', '180', '-png', pdf, prefix], { stdio: 'pipe' });
  const images = readdirSync(directory).filter(f => f.startsWith(`${role}-render-`) && f.endsWith('.png')).sort();
  if (!images.length) throw new Error('PDF sans pages rendues.');
  let text = '';
  for (const image of images) {
    const base = join(directory, image.slice(0, -4));
    execFileSync('tesseract', [join(directory, image), base, '-l', 'fra+eng'], { stdio: 'pipe' });
    text += readFileSync(`${base}.txt`, 'utf8').toUpperCase().replace(/\s/g, '');
  }
  for (const [i, section] of sections.entries()) {
    const present = text.includes(`FICTIF0${i}`);
    if (present !== allowed.includes(section)) throw new Error(`PDF ${role} : contenu de section non démontré par OCR.`);
    if (text.includes(`FICTIF1${i}`)) throw new Error('PDF contenant une autre école.');
  }
  results.push({ role, pages: images.length, scopedContent: 'PASS', visualReview: 'NON EXÉCUTÉ — images disponibles' });
  for (const kind of ['dashboard', 'financial']) {
    execFileSync('pdftoppm', ['-r', '150', '-png', join(directory, `${role}-${kind}.pdf`), join(directory, `${role}-${kind}-render`)], { stdio: 'pipe' });
    if (!readdirSync(directory).some(f => f.startsWith(`${role}-${kind}-render-`) && f.endsWith('.png'))) throw new Error('Export financier sans page.');
  }
}
writeFileSync(join(directory, 'pdf-checks.json'), JSON.stringify(results, null, 2));
