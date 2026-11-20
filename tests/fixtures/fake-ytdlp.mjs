#!/usr/bin/env node
// Stands in for yt-dlp in tests/studio-session.test.mjs: records its arguments in FAKE_YTDLP_LOG and saves FAKE_YTDLP_MP4
// as the requested output, printing the lines kit/studio/fetch.mjs reads.
import { appendFileSync, copyFileSync } from 'fs';
const a = process.argv.slice(2);
if (a.includes('--version')) { console.log('2026.01.01'); process.exit(0); }
if (a.includes('--help')) process.exit(0);
if (process.env.FAKE_YTDLP_LOG) appendFileSync(process.env.FAKE_YTDLP_LOG, JSON.stringify(a) + '\n');
const out = a[a.indexOf('-o') + 1].replace('%(ext)s', 'mp4');
copyFileSync(process.env.FAKE_YTDLP_MP4, out);
console.log('title fake reel'); console.log('file ' + out);
