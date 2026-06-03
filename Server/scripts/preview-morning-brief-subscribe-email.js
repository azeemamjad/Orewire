#!/usr/bin/env node
/**
 * Write Morning Brief subscribe confirmation HTML to stdout or a file.
 * Usage: node scripts/preview-morning-brief-subscribe-email.js [out.html]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { renderMorningBriefSubscribeEmail } = require('../lib/email-templates');

const { subject, html } = renderMorningBriefSubscribeEmail();
const out = process.argv[2];
if (out) {
  fs.writeFileSync(path.resolve(out), html, 'utf8');
  console.log(`Subject: ${subject}`);
  console.log(`Wrote ${out}`);
} else {
  console.log(`Subject: ${subject}\n`);
  process.stdout.write(html);
}
