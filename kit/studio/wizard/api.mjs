// Builder plan routes (docs/specs/studio-builder.md). Mounted from kit/studio/server.mjs.
//   GET  /api/video-plan    the plan (the session's own, or one read from the session), its summary rows, what the
//                           engine cannot draw yet, and the paces
//   POST /api/video-plan    { plan } check it and set it; the same as POST /api/state { videoPlan }
//                           { pace } pick a pace only: read the plan from the session now, change what a pace sets, keep the rest
//                           { words } change some words choices (a builder step); only the picks they move change
//                           { transitions } { presenter } { graphics } { filters } { music } { notes } the same for
//                           Between shots, You on screen, Extras, Look, Sound and Your notes (notes is the text)
//   GET  /api/wizard/steps  the builder steps (kit/studio/wizard/steps.json)
//   GET  /api/templates     the Template Library (kit/studio/templates.mjs list)
//   POST /api/templates     { name? } save the plan as it is now as a template; no notes
//   POST /api/templates/use { name, edit? } start this video's plan from a template (edit: a look's choices as your own)
//   POST /api/templates/rename { name, label }, /duplicate { name }, /delete { name }
//   GET  /api/templates/preview/<name>  a template's own picture (preview.jpg), when it has one
//   GET  /api/plan-check    the last plan check of this video (build/plan-check.json), or null
//   POST /api/plan-check    { fix? } run the measured checks (kit/plan-check.mjs) on the draft and the newest render;
//                           fix: apply what can be fixed, up to 3 rounds (the video changes on the next render)
//   GET  /api/plan-check/points   the moments to look at (for an agent's own look)
//   POST /api/plan-check/report   { looked: [{ id, selection, ok, note, time }] } an agent's looked-at checks
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as VP from './plan.mjs';
import * as TPL from '../templates.mjs';
import * as PC from '../../plan-check.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const lastPace = s => VP.lastPace(s);

export const STEPS_FILE = join(dirname(fileURLToPath(import.meta.url)), 'steps.json');
export const stepsOf = () => JSON.parse(readFileSync(STEPS_FILE, 'utf8'));
// the plan for a session, read from its picks as they are now (a classic step, the chat or an agent may have changed
// them), with the choices only the plan holds (notes, timings, repo links) kept from the plan as it was set
export const planOf = (s, cat) => VP.fromState(s, s.videoPlan || null, cat);
export const planView = (s, cat) => { const plan = planOf(s, cat); return { plan, summary: VP.summary(plan, cat), pending: VP.pending(plan), needed: VP.needed(plan), paces: VP.PACES, own: !!s.videoPlan }; };

export function mount({ C, json, readBody, view, pushState }) {
  async function route(p, M, u, req, res) {
    if (p === '/api/wizard/steps' && M === 'GET') { json(res, 200, stepsOf()); return true; }
    if (p === '/api/templates' && M === 'GET') { json(res, 200, { templates: TPL.list(C.catalog()) }); return true; }
    const pm = p.match(/^\/api\/templates\/preview\/([a-z0-9][a-z0-9-]{0,59})$/);
    if (pm && M === 'GET') {
      const f = TPL.thumbOf(pm[1]); let buf = null; try { buf = f && readFileSync(f); } catch {}
      if (!buf) { json(res, 404, { error: 'no picture' }); return true; }
      res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': buf.length, 'cache-control': 'no-cache' }); res.end(buf); return true;
    }
    const tm = p.match(/^\/api\/templates\/(use|rename|duplicate|delete)$/);
    if (tm && M === 'POST') {
      const b = (await readBody(req)) || {}, cat = C.catalog();
      try {
        if (tm[1] === 'use') {
          // a reference (Influence, Recreate or Copy the look, broken down or still being read) would win over the template,
          // so it steps aside first, with its own clean-up, and the template goes on after (picking it again brings it back)
          const plan = TPL.planFor(b.name, cat, { edit: b.edit === true }), s = C.load(), ref = s.reference || {}, aside = !!(ref.mode && ref.mode !== 'off' && (ref.extracted || ref.url || ref.file));
          if (aside) { const off = C.applyPatch(s, { reference: { mode: 'off' }, from: 'ui' }); if (off.errs.length) { json(res, 400, { error: off.errs.join(' '), errs: off.errs }); return true; } }
          const r = C.applyPatch(s, { videoPlan: plan, from: 'ui' }); if (aside) r.log.unshift('the reference steps aside so the template is used');
          if (r.errs.length) { json(res, 400, { error: r.errs.join(' '), errs: r.errs }); return true; }
          C.save(s); pushState(); json(res, 200, { ...view(s), ...planView(s, cat), log: r.log }); return true;
        }
        const out = tm[1] === 'rename' ? TPL.rename(b.name, b.label, cat) : tm[1] === 'duplicate' ? TPL.duplicate(b.name, cat) : TPL.remove(b.name, cat);
        json(res, 200, { ok: true, template: out === true ? null : out, templates: TPL.list(cat) }); return true;
      } catch (e) { json(res, typeof e.code === 'number' ? e.code : 500, { error: e.message }); return true; }
    }
    if (p === '/api/templates' && M === 'POST') {
      const b = await readBody(req), s = C.load(), cat = C.catalog();
      try { const t = TPL.save(b && typeof b.name === 'string' ? b.name : '', { plan: planOf(s, cat), from: { kind: 'builder' }, cat });
        // its picture: a still from this video's newest render, when there is one
        try { const outs = (C.outputsOf ? C.outputsOf(s) : []).map(f => join(ROOT, f)).filter(f => existsSync(f)).sort((x, y) => statSync(y).mtimeMs - statSync(x).mtimeMs); if (outs[0]) TPL.setThumb(t.name, outs[0]).catch(() => {}); } catch {}
        json(res, 200, { template: t }); }
      catch (e) { json(res, typeof e.code === 'number' ? e.code : 500, { error: e.message }); }
      return true;
    }
    if (p === '/api/plan-check' || p === '/api/plan-check/points' || p === '/api/plan-check/report') {
      const s = C.load(); if (!s.job) { json(res, 400, { error: 'name the job first' }); return true; }
      const build = join(ROOT, 'jobs', s.job, 'build'), read = () => { try { return JSON.parse(readFileSync(join(build, 'plan-check.json'), 'utf8')); } catch { return null; } };
      if (p === '/api/plan-check' && M === 'GET') { json(res, 200, { report: read(), job: s.job }); return true; }
      if (!existsSync(join(build, 'cut.json'))) { json(res, 400, { error: 'Make a draft first.' }); return true; }
      try {
        if (p === '/api/plan-check/points' && M === 'GET') { const st = PC.load(build); json(res, 200, { points: PC.checkpoints(st.cut, st.caps, build) }); return true; }
        if (p === '/api/plan-check/report' && M === 'POST') { const b = (await readBody(req)) || {}; if (!Array.isArray(b.looked)) { json(res, 400, { error: 'looked: a list of { id, selection, ok, note, time }.' }); return true; } json(res, 200, { report: PC.report(build, b.looked) }); return true; }
        if (p === '/api/plan-check' && M === 'POST') {
          const b = (await readBody(req)) || {};
          // a fix writes cut.json and captions.js: never while a draft or render is writing them too
          if (b.fix === true && s.task && s.task.status === 'running') { json(res, 409, { error: 'Wait for the draft or render to finish, then fix.' }); return true; }
          // the plan as it is now beside the draft, then the newest render for the stills
          mkdirSync(build, { recursive: true }); writeFileSync(join(build, 'video-plan.json'), JSON.stringify(planOf(s, C.catalog()), null, 1));
          const outs = (C.outputsOf ? C.outputsOf(s) : []).map(f => join(ROOT, f)).filter(f => existsSync(f)).sort((x, y) => statSync(y).mtimeMs - statSync(x).mtimeMs);
          json(res, 200, { report: PC.run(build, { fix: b.fix === true, video: outs[0] || null, state: { finishWhen: s.finishWhen, transitionsWhen: s.transitionsWhen, keyWords: s.keyWords } }), job: s.job }); return true;
        }
      } catch (e) { json(res, 400, { error: e.message }); return true; }
      return false;
    }
    if (p !== '/api/video-plan') return false;
    if (M === 'GET') { json(res, 200, planView(C.load(), C.catalog())); return true; }
    if (M === 'POST') {
      const b = await readBody(req);
      if (b && typeof b.pace === 'string' && !('plan' in b)) {
        if (!Object.hasOwn(VP.PACES, b.pace)) { json(res, 400, { error: `pace: one of ${Object.keys(VP.PACES).join(', ')}` }); return true; }
        const s = C.load(), cat = C.catalog(), { plan, patch } = VP.pacePatch(planOf(s, cat), b.pace, lastPace(s)), r = C.applyPatch(s, { ...patch, from: 'ui' });
        if (r.errs.length) { json(res, 400, { error: r.errs.join(' '), errs: r.errs }); return true; }
        delete plan.goalPace; delete plan.guessed; // a pace you pick here is yours: a run_wizard goal leaves it alone
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
