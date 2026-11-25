// Builder plan routes (docs/specs/studio-builder.md). Mounted from kit/studio/server.mjs.
//   GET  /api/video-plan    the plan (the session's own, or one read from the session), its summary rows, what the
//                           engine cannot draw yet, and the paces
//   POST /api/video-plan    { plan } check it and set it; the same as POST /api/state { videoPlan }
//                           { pace } pick a pace only: read the plan from the session now, change what a pace sets, keep the rest
//                           { words } change some words choices (a builder step); only the picks they move change
//                           { transitions } { presenter } { graphics } { filters } { music } { notes } the same for
//                           Between shots, You on screen, Extras, Look, Sound and Your notes (notes is the text)
//   GET  /api/wizard/steps  the builder steps (kit/studio/wizard/steps.json)
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as VP from './plan.mjs';

export const STEPS_FILE = join(dirname(fileURLToPath(import.meta.url)), 'steps.json');
export const stepsOf = () => JSON.parse(readFileSync(STEPS_FILE, 'utf8'));
// the plan for a session, read from its picks as they are now (a classic step, the chat or an agent may have changed
// them), with the choices only the plan holds (notes, timings, repo links) kept from the plan as it was set
export const planOf = (s, cat) => VP.fromState(s, s.videoPlan || null, cat);
export const planView = (s, cat) => { const plan = planOf(s, cat); return { plan, summary: VP.summary(plan, cat), pending: VP.pending(plan), paces: VP.PACES, own: !!s.videoPlan }; };

export function mount({ C, json, readBody, view, pushState }) {
  async function route(p, M, u, req, res) {
    if (p === '/api/wizard/steps' && M === 'GET') { json(res, 200, stepsOf()); return true; }
    if (p !== '/api/video-plan') return false;
    if (M === 'GET') { json(res, 200, planView(C.load(), C.catalog())); return true; }
    if (M === 'POST') {
      const b = await readBody(req);
      if (b && typeof b.pace === 'string' && !('plan' in b)) {
        if (!Object.hasOwn(VP.PACES, b.pace)) { json(res, 400, { error: `pace: one of ${Object.keys(VP.PACES).join(', ')}` }); return true; }
        const s = C.load(), cat = C.catalog(), { plan, patch } = VP.pacePatch(planOf(s, cat), b.pace, s.videoPlan && s.videoPlan.pace), r = C.applyPatch(s, { ...patch, from: 'ui' });
        if (r.errs.length) { json(res, 400, { error: r.errs.join(' '), errs: r.errs }); return true; }
        s.videoPlan = plan; C.save(s); pushState();
        json(res, 200, { ...view(s), ...planView(s, cat), log: r.log }); return true;
      }
      if (b && b.words && typeof b.words === 'object' && !Array.isArray(b.words) && !('plan' in b)) {
        const s = C.load(), cat = C.catalog(), prev = planOf(s, cat), next = VP.withWords(prev, b.words), v = VP.validate(next, cat);
        if (!v.ok) { json(res, 400, { error: v.errs.join(' '), errs: v.errs }); return true; }
        const r = C.applyPatch(s, { ...VP.diffPatch(prev, next, cat), from: 'ui' });
        if (r.errs.length) { json(res, 400, { error: r.errs.join(' '), errs: r.errs }); return true; }
        s.videoPlan = VP.normalize(next); C.save(s); pushState();
        json(res, 200, { ...view(s), ...planView(s, cat), log: r.log }); return true;
      }
      const part = b && !('plan' in b) && VP.PARTS.find(k => k in b);
      if (part) {
        const val = b[part], okShape = part === 'presenter' ? Array.isArray(val) : part === 'notes' ? typeof val === 'string' : val && typeof val === 'object' && !Array.isArray(val);
        if (!okShape) { json(res, 400, { error: part === 'presenter' ? 'presenter: a list of { id, when }.' : part === 'notes' ? 'notes: plain text.' : `${part}: an object.` }); return true; }
        const s = C.load(), cat = C.catalog(), prev = planOf(s, cat), next = VP.withPart(prev, part, val), v = VP.validate(next, cat);
        if (!v.ok) { json(res, 400, { error: v.errs.join(' '), errs: v.errs }); return true; }
        const r = C.applyPatch(s, { ...VP.diffPatch(prev, next, cat), from: 'ui' });
        if (r.errs.length) { json(res, 400, { error: r.errs.join(' '), errs: r.errs }); return true; }
        s.videoPlan = VP.normalize(next); C.save(s); pushState();
        json(res, 200, { ...view(s), ...planView(s, cat), log: r.log }); return true;
      }
      if (!b || !('plan' in b)) { json(res, 400, { error: 'Send { plan }, { pace }, { words }, { transitions }, { presenter }, { graphics }, { filters }, { music }, { notes }, or { plan: null } to clear it.' }); return true; }
      const s = C.load(), r = C.applyPatch(s, { videoPlan: b.plan, from: 'ui' });
      if (r.errs.length) { json(res, 400, { error: r.errs.join(' '), errs: r.errs }); return true; }
      C.save(s); pushState();
      json(res, 200, { ...view(s), ...planView(s, C.catalog()), log: r.log }); return true;
    }
    return false;
  }
  return { route };
}
