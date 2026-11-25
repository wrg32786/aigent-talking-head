// Builder plan routes (docs/specs/studio-builder.md). Mounted from kit/studio/server.mjs.
//   GET  /api/video-plan    the plan (the session's own, or one read from the session), its summary rows, what the
//                           engine cannot draw yet, and the paces
//   POST /api/video-plan    { plan } check it and set it; the same as POST /api/state { videoPlan }
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
      const b = await readBody(req); if (!b || !('plan' in b)) { json(res, 400, { error: 'Send { plan }, or { plan: null } to clear it.' }); return true; }
      const s = C.load(), r = C.applyPatch(s, { videoPlan: b.plan, from: 'ui' });
      if (r.errs.length) { json(res, 400, { error: r.errs.join(' '), errs: r.errs }); return true; }
      C.save(s); pushState();
      json(res, 200, { ...view(s), ...planView(s, C.catalog()), log: r.log }); return true;
    }
    return false;
  }
  return { route };
}
