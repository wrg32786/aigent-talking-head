// Words for the Cut step: one stopword list, a light stemmer and a tokenizer, shared by the point of the video
// (kit/studio/point.mjs) and the topics (kit/studio/topics.mjs). Plain rules, no model, nothing leaves this computer.

// function words, fillers and the vague verbs and adjectives that say nothing about the subject of a take
const LIST = `a about above after again against all almost also am an and any are as at be because been before being below
between both but by can could did do does doing done down during each either else even ever every few for from further
get gets getting go goes going gone gonna got gotta had has have having he her here hers herself him himself his how i if
in into is it its itself just kinda let lets like may maybe me might more most much must my myself no nor not now of off
on once only or other our ours ourselves out over own per same shall she should so some such than that the their theirs
them themselves then there these they this those though through to too under until up upon us very was we were what
when where which while who whom whose why will with within without would yes yet you your yours yourself yourselves
um uh erm hmm ah oh ok okay yeah yep nope hey hi well right alright anyway anyways basically literally actually really
honestly simply totally definitely probably obviously seriously pretty quite rather super still already always never
sometimes often usually today tomorrow yesterday soon later ago
thing things stuff lot lots bit kind sort way ways something anything everything nothing someone anyone everyone nobody
somebody anybody everybody one ones two three four five six seven eight nine ten first second third next last
able back different new old good great best better bad big small little long short whole sure real true same many
several couple enough less least own other another
come comes came coming want wants wanted know knows knew known think thinks thought need needs needed say says said
tell tells told see sees saw seen look looks looked feel feels felt make makes made take takes took taken give gives
gave given keep keeps kept put puts try tries tried use uses used help helps helped show shows showed mean means meant
start starts started work works worked talk talks talked happen happens happened seem seems guess wanna
dont doesnt didnt cant couldnt wont wouldnt shouldnt isnt arent wasnt werent havent hasnt hadnt aint
im ive id ill youre youve youll youd hes shes theyre theyve theyll weve were thats theres heres whats wheres whos lets
people person guys guy everyone folks time times day days year years week weeks month months minute minutes`;
export const STOP = new Set(LIST.split(/\s+/).filter(Boolean));
// small words that may sit inside a theme ("starting with ChatGPT", "friends and family")
export const JOIN = new Set('with of for to in on and your my the a an from at by as into or vs'.split(' '));

const IRREGULAR = { built: 'build', made: 'make', ran: 'run', wrote: 'write', written: 'write', sold: 'sell', bought: 'buy', taught: 'teach', grew: 'grow', grown: 'grow', began: 'begin', begun: 'begin', children: 'child', men: 'man', women: 'woman', beginners: 'begin', beginner: 'begin', apps: 'app' };
// a light stemmer: plurals, -ing, -ed, -ly and a final e, so build, builds, building and built meet
export function stem(w) {
  w = String(w || '').toLowerCase(); if (IRREGULAR[w]) return IRREGULAR[w];
  if (w.length <= 3 || /\d/.test(w)) return w;
  if (/ies$/.test(w) && w.length > 4) w = w.slice(0, -3) + 'y';
  else if (/sses$/.test(w)) w = w.slice(0, -2);
  else if (/s$/.test(w) && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (/ing$/.test(w) && w.length > 5) w = w.slice(0, -3);
  else if (/ed$/.test(w) && w.length > 4) w = w.slice(0, -2);
  else if (/ly$/.test(w) && w.length > 4) w = w.slice(0, -2);
  if (/([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss|ff)$/.test(w)) w = w.slice(0, -1);
  if (/e$/.test(w) && w.length > 3) w = w.slice(0, -1);
  return IRREGULAR[w] || w;
}
// the words of a text, in order: { raw (as written, punctuation off), w (lower case), stop, stem }. A contraction
// (you're, don't, it's) is a stop word whole, so "youre" or "dont" never comes out as a subject
export function tokens(text) {
  const out = [];
  for (const m of String(text || '').replace(/[‘’]/g, "'").matchAll(/[A-Za-z0-9][A-Za-z0-9'.-]*[A-Za-z0-9]|[A-Za-z0-9]/g)) {
    const raw = m[0].replace(/'s$/i, ''), w = raw.toLowerCase(), contraction = /'/.test(w);
    const stop = contraction || STOP.has(w) || (w.length < 2 && !/\d/.test(w));
    out.push({ raw, w, stop, stem: stop ? w : stem(w.replace(/[.'-]/g, '')), at: m.index });
  }
  return out;
}
// the stems of the words that carry meaning
export const contentStems = text => tokens(text).filter(t => !t.stop).map(t => t.stem);
