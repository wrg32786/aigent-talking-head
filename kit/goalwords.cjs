// Goal words: the words that carry "the point of this video". The goal is one line the user writes ("Show beginners
// they can build an app with AI in a weekend"). We keep its content words (stopwords out, stemmed) and score any line
// or word of the take against them. Used by kit/lookplan.cjs (which words get a sticker), kit/autocaption.mjs (which
// word of a caption or title is the big one) and the Studio side. No dependencies.
//   stem(word)           a light stem: lower case, no plural, no -ing, -ed, -ly ("building", "builds" -> "build")
//   contentWords(text)   the stemmed content words of a text, each once, in order (stopwords out; numbers kept)
//   overlap(goal, line)  0..1: the share of the shorter side's content words that the other side has too. One word
//                        of the goal scores 1; a line with none of its words scores 0.
//   isGoalWord(goal, w)  true when the word is one of the goal's content words
//   isStop(w), isGeneric(w)   in STOPWORDS; in GENERIC (a word too common or too vague to stand alone on screen)
'use strict';

// function words, pronouns, helpers, fillers and light verbs: never a content word
const STOPWORDS = new Set((
  'a an the and or but nor so yet if then than that this these those there here ' +
  'i me my mine myself we us our ours ourselves you your yours yourself yourselves he him his himself she her hers herself ' +
  'it its itself they them their theirs themselves who whom whose which what when where why how ' +
  'am is are was were be been being do does did doing done have has had having will would shall should can could may might must ' +
  'not no yes of to in on at by for with from into onto out up down off over under about above below after before again ' +
  'against between both during each few more most other some such only own same too very just also even still ever never ' +
  'always often once all any every either neither as because while until through across around along among per via ' +
  'really actually basically literally simply maybe perhaps quite rather pretty kind sort lot lots bit much many ' +
  'okay ok yeah yep nope oh uh um hey hi hello well right like gonna wanna gotta kinda sorta ' +
  'get gets got getting gotten go goes going gone went come comes coming came make makes making made take takes taking took taken ' +
  'put puts putting let lets letting say says saying said tell tells telling told show shows showing showed shown ' +
  'see sees seeing saw seen look looks looking looked know knows knowing knew known think thinks thinking thought ' +
  'want wants wanting wanted need needs needing needed use uses using used try tries trying tried turn turns turning turned ' +
  'give gives giving gave given keep keeps keeping kept mean means meant seem seems feel feels felt ' +
  'thing things something anything everything nothing someone anyone everyone nobody somebody anybody everybody ' +
  'one ones way ways stuff here\'s there\'s that\'s it\'s i\'m i\'ve i\'ll i\'d you\'re you\'ve you\'ll we\'re we\'ve we\'ll they\'re don\'t doesn\'t didn\'t can\'t won\'t isn\'t aren\'t wasn\'t let\'s'
).split(/\s+/));

// real words, but too common or too vague to stand alone as a sticker: everyday nouns, verbs and describing words, and
// the nouns every video about making content says (video, post, headline, carousel). A goal word is never generic.
const GENERIC = new Set((
  'time times day days week weeks month months year years today tomorrow yesterday tonight morning night moment minute minutes hour hours ' +
  'people person man woman guy guys friend friends everybody world life place places home house room work job thing part parts piece pieces ' +
  'side end start top bottom back front middle point points case kind type types level number numbers amount couple bunch pair half rest whole ' +
  'idea ideas question questions answer answers problem problems reason reasons result results example examples step steps tip tips ' +
  'fact facts story stories name names word words line lines list lists title titles text page pages link links ' +
  'video videos reel reels clip clips post posts content caption captions headline headlines carousel carousels thumbnail thumbnails ' +
  'cover covers feed timeline channel account profile view views viewer viewers like likes comment comments follower followers follow ' +
  'audience share shares subscribe subscriber subscribers hook hooks edit edits effect effects sound sounds music screen frame shot shots camera phone ' +
  'good great nice best better bad worse worst big bigger biggest small little large huge long short new old easy hard simple quick fast slow ' +
  'cool awesome amazing crazy insane wild real true sure different important main next last whole entire other another every single ' +
  'start starts started starting stop stops stopped find finds found help helps helped work works worked working call calls called ' +
  'run runs running play plays played move moves moved change changes changed happen happens happened ' +
  'create creates created creating build builds built add adds added talk talks talking watch watches watching ' +
  'learn learns learned read reads write writes wrote ask asks asked open opens opened close closes closed ' +
  'before after around almost already probably definitely exactly especially usually sometimes together instead however ' +
  'everyone everything anything something nothing somewhere anywhere'
).split(/\s+/));

const bare = w => String(w == null ? '' : w).toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/^[^\p{L}\p{N}$%]+|[^\p{L}\p{N}$%]+$/gu, '');

// a light stem, the same for a word and its plain forms. Not a dictionary: good enough to match "posts" with "post"
// and "editing" with "edits".
function stem(word) {
  let w = bare(word).replace(/'s$/, '');
  if (w.length <= 3 || /\d/.test(w)) return w;
  if (/ies$/.test(w) && w.length > 4) w = w.slice(0, -3) + 'y';
  else if (/(sses|shes|ches|xes|zes)$/.test(w)) w = w.slice(0, -2);
  else if (/s$/.test(w) && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  let cut = false;
  if (w.length > 5 && /ing$/.test(w)) { w = w.slice(0, -3); cut = true; }
  else if (w.length > 4 && /ed$/.test(w)) { w = w.slice(0, -2); cut = true; }
  else if (w.length > 5 && /ly$/.test(w)) w = w.slice(0, -2);
  // "running" -> "run", "make" and "making" -> "mak"
  if (cut && /([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss|zz|ff)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 3 && /e$/.test(w)) w = w.slice(0, -1);
  return w;
}

const isStop = w => STOPWORDS.has(bare(w));
const STEMS_GENERIC = new Set([...GENERIC].map(stem));
const isGeneric = w => { const b = bare(w); return GENERIC.has(b) || STEMS_GENERIC.has(stem(b)); };

// the stemmed content words of a text, each once, in the order said
function contentWords(text) {
  const out = [];
  for (const raw of String(text == null ? '' : text).split(/[\s\u2014\u2013/]+/)) {
    const b = bare(raw);
    if (!b || isStop(b)) continue;
    const s = stem(b);
    if (s && !isStop(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

// 0..1: how much of the goal a line carries. The words both sides share, over the shorter side's count, so one goal
// word alone scores 1 and a long line is not marked down for its other words.
function overlap(goal, line) {
  const g = Array.isArray(goal) ? goal : contentWords(goal), l = contentWords(line);
  if (!g.length || !l.length) return 0;
  const hit = l.filter(w => g.includes(w)).length;
  return +(hit / Math.min(g.length, l.length)).toFixed(3);
}

const isGoalWord = (goal, word) => { const g = Array.isArray(goal) ? goal : contentWords(goal), s = contentWords(word); return s.length > 0 && s.every(w => g.includes(w)); };

module.exports = { contentWords, overlap, isGoalWord, stem, isStop, isGeneric, STOPWORDS, GENERIC };
