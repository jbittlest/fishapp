// Summarise a workflow result file (ports → review → fix) into tools/out/ports-summary.txt
import fs from 'node:fs';
const file = process.argv[2];
const r = JSON.parse(fs.readFileSync(file, 'utf8'));
const res = r.result;
const out = [];
for (const g of res) {
  const f = (g.rev && g.rev.findings) || [];
  const sev = (s) => f.filter((x) => x.severity === s).length;
  out.push(`=== ${g.group}`);
  out.push(`port checks: ${g.port && g.port.checks}`);
  out.push(`review: ${f.length} findings (critical ${sev('critical')}, high ${sev('high')}, medium ${sev('medium')}, low ${sev('low')})`);
  out.push(`fix: applied ${(g.fix.applied || []).length}, rejected ${(g.fix.rejected || []).length}; checks: ${g.fix.checks}`);
  out.push('DEVIATIONS:'); for (const d of (g.port.deviations || [])) out.push(' - ' + d);
  out.push('OPEN ISSUES:'); for (const d of (g.port.openIssues || [])) out.push(' - ' + d);
  out.push('SHARED REQUESTS:'); for (const d of (g.port.sharedRequests || [])) out.push(' - ' + d);
  out.push('REJECTED FINDINGS:'); for (const d of (g.fix.rejected || [])) out.push(' - ' + d);
  out.push('');
}
fs.mkdirSync('tools/out', { recursive: true });
fs.writeFileSync('tools/out/ports-summary.txt', out.join('\n'));
console.log(out.join('\n').length, 'chars');
