// "What's the point of this video?" One optional line per project (state.point). It steers what we pick: the score
// of every line, the Hook, Story and Tip picks, Let AI choose, the full edit and the clips. Local scoring is the
// overlap of the point's content words and phrases with a line (stemmed, stop words out). A model or your agent gets
// the same line in its prompt (kit/studio/cut.mjs scorePrompt, kit/studio/llm.mjs, MCP get_cuts and get_pieces).
import { contentStems } from './words.mjs';

export const POINT_MAX = 200;
export const POINT_BOOST = 18; // the most a line's score rises when it serves the point
export const FITS = 'Fits your point';
export const cleanPoint = v => String(v == null ? '' : v).replace(/—/g, ', ').replace(/\s+/g, ' ').trim().slice(0, POINT_MAX);

// a scorer for one point: fit(text) is 0 to 1, fits(text) says whether to show "Fits your point". null when the
// point has no content words (empty, or only small words)
export function pointScorer(point) {
  const G = contentStems(cleanPoint(point)); if (!G.length) return null;
  const set = new Set(G), pairs = new Set(); for (let i = 0; i + 1 < G.length; i++) pairs.add(G[i] + ' ' + G[i + 1]);
  const need = Math.min(set.size, 3), memo = new Map();
  const read = text => {
    const k = String(text || ''); if (memo.has(k)) return memo.get(k);
    const L = contentStems(k), hit = new Set(L.filter(w => set.has(w)));
    let phrases = 0; for (let i = 0; i + 1 < L.length; i++) if (pairs.has(L[i] + ' ' + L[i + 1])) phrases++;
    const r = { fit: Math.min(1, (hit.size + 0.5 * phrases) / need), hits: hit.size, phrases, words: [...hit] };
    memo.set(k, r); return r;
  };
  const fit = text => read(text).fit;
  // one shared word is not enough to say a line serves the point, unless the point is only a word or two
  const fits = text => { const r = read(text); return r.phrases > 0 || r.hits >= Math.min(2, set.size); };
  return { fit, fits, boost: text => Math.round(fit(text) * POINT_BOOST), words: [...set], read };
}
// the line a prompt carries, or '' when there is no point
export const pointLine = point => { const p = cleanPoint(point); return p ? `The point of this video, in the user's words: "${p}". Prefer the parts that serve it.` : ''; };
