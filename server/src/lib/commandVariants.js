/**
 * Rewrites a (normalized) shell command into "probably meant the same thing"
 * variants, each tagged with why it differs. nearMissService feeds every
 * variant back through the real grader: if a variant matches an accepted
 * pattern, the original was a near miss of that kind.
 *
 * Pure string manipulation, no shell parsing — good enough for the one-liners
 * an exam asks for.
 */

const REASON = Object.freeze({
  SPACING: 'spacing',
  TRAILING_SLASH: 'trailing_slash',
  HOME_PATH: 'home_path',
  FLAG_STYLE: 'flag_style',
  EQUIVALENT: 'equivalent',
});

const OPERATOR_RE = /\s*(\|\||&&|>>|\||;|>|<)\s*/g;
const PAGER_LIKE = new Set(['less', 'more', 'head', 'tail', 'grep', 'wc', 'sort', 'uniq']);
const MAX_FLAG_PERMUTE = 4; // -abcd -> 24 orders; longer groups are only sorted
const HOME_PREFIX_RE = /^(?:\$HOME|\$\{HOME\}|\/home\/[^/\s]+|\/root)\//;

const tokens = (cmd) => cmd.split(' ').filter(Boolean);
const join = (parts) => parts.join(' ');

function spacingVariants(cmd) {
  return [cmd.replace(OPERATOR_RE, ' $1 '), cmd.replace(OPERATOR_RE, '$1')].map((s) => s.trim());
}

function trailingSlashVariants(cmd) {
  const parts = tokens(cmd);
  const stripped = parts.map((p) => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p));
  const last = parts.length > 1 && !parts.at(-1).endsWith('/') ? [join([...parts.slice(0, -1), `${parts.at(-1)}/`])] : [];
  return [join(stripped), ...last];
}

const isPathArg = (p, i) => i > 0 && !p.startsWith('-') && !/^[|;&<>]/.test(p);

function homePathVariants(cmd) {
  const parts = tokens(cmd);
  const relative = parts.map((p, i) => (isPathArg(p, i) ? p.replace(/^~\//, '').replace(HOME_PREFIX_RE, '') : p));
  const tilde = parts.map((p, i) =>
    isPathArg(p, i) && !p.startsWith('/') && !p.startsWith('~') && !p.startsWith('$') ? `~/${p}` : p
  );
  const canonical = parts.map((p) => p.replace(HOME_PREFIX_RE, '~/'));
  return [join(relative), join(tilde), join(canonical)];
}

function permutations(letters) {
  if (letters.length <= 1) return [letters];
  return letters.flatMap((ch, i) =>
    permutations([...letters.slice(0, i), ...letters.slice(i + 1)]).map((rest) => [ch, ...rest])
  );
}

function flagStyleVariants(cmd) {
  const out = [
    cmd.replace(/(^|\s)-([a-zA-Z])(\d+)(?=\s|$)/g, '$1-$2 $3'), // -n5 -> -n 5
    cmd.replace(/(^|\s)-([a-zA-Z]) (\d+)(?=\s|$)/g, '$1-$2$3'), // -n 5 -> -n5
    cmd.replace(/(^|\s)-n ?(\d+)(?=\s|$)/g, '$1-$2'), // head -n 5 -> head -5
    cmd.replace(/(^|\s)-(\d+)(?=\s|$)/g, '$1-n $2'), // head -5 -> head -n 5
  ];
  const parts = tokens(cmd);
  const flagIdx = parts.map((p, i) => (/^-[a-zA-Z]{2,}$/.test(p) ? i : -1)).filter((i) => i >= 0);
  for (const i of flagIdx) {
    const letters = [...parts[i].slice(1)];
    out.push(join([...parts.slice(0, i), ...letters.map((l) => `-${l}`), ...parts.slice(i + 1)])); // -la -> -l -a
    const orders = letters.length <= MAX_FLAG_PERMUTE ? permutations(letters) : [[...letters].sort()];
    for (const order of orders) out.push(join([...parts.slice(0, i), `-${order.join('')}`, ...parts.slice(i + 1)]));
  }
  // -l -a -> -la (merge consecutive single-letter flags)
  out.push(cmd.replace(/(^|\s)-([a-zA-Z])((?:\s+-[a-zA-Z](?=\s|$))+)/g, (m, lead, first, rest) =>
    `${lead}-${first}${rest.replace(/\s+-/g, '')}`));
  return out;
}

function equivalentVariants(cmd) {
  const out = [];
  const catPipe = /^cat\s+(\S+)\s*\|\s*(\S+)(.*)$/.exec(cmd); // cat f | less -> less f
  if (catPipe) out.push(`${catPipe[2]}${catPipe[3]} ${catPipe[1]}`.replace(/\s+/g, ' ').trim());
  const direct = /^(\S+)((?:\s+-\S+)*)\s+([^\s|;&<>-]\S*)$/.exec(cmd); // less f -> cat f | less
  if (direct && PAGER_LIKE.has(direct[1])) out.push(`cat ${direct[3]} | ${direct[1]}${direct[2]}`);
  out.push(cmd.replace(/^ls\s+-[a-zA-Z]+\s*\|/, 'ls |')); // ls -l | grep x -> ls | grep x
  out.push(cmd.replace(/^(\S+)((?:\s+-[a-zA-Z]+)+)(?=\s|$)/, '$1')); // ls -l Music -> ls Music (extra flags)
  out.push(cmd.replace(/grep\s+(-\S+\s+)?\\?\.?\*?\.?(\w+)\$?$/, 'grep $1$2').replace(/\s+/g, ' ')); // grep \.txt$ -> grep txt
  const lsGlob = /^ls\s+(?:-\S+\s+)?\*\.?(\w+)$/.exec(cmd); // ls *.txt -> ls | grep txt
  if (lsGlob) out.push(`ls | grep ${lsGlob[1]}`);
  out.push(cmd.replace(/^cd\s+(~|\$HOME)\/?$/, 'cd'));
  out.push(cmd.replace(/^mkdir\s+-p\s+/, 'mkdir '));
  out.push(cmd.replace(/^rm\s+-[rRfv]*d?\s+/, 'rmdir '), cmd.replace(/^rmdir\s+/, 'rm -r '));
  out.push(cmd.replace(/\s*;\s*/g, ' && '), cmd.replace(/\s*&&\s*/g, ' ; '));
  return out;
}

const GENERATORS = [
  [REASON.SPACING, spacingVariants],
  [REASON.TRAILING_SLASH, trailingSlashVariants],
  [REASON.HOME_PATH, homePathVariants],
  [REASON.FLAG_STYLE, flagStyleVariants],
  [REASON.EQUIVALENT, equivalentVariants],
];

function firstLevel(cmd) {
  const out = [];
  for (const [reason, gen] of GENERATORS) {
    for (const variant of gen(cmd)) if (variant && variant !== cmd) out.push({ command: variant, reasons: [reason] });
  }
  return out;
}

/**
 * All variants up to two rewrites deep (a command can differ in two ways,
 * e.g. `cat ~/f|less`). Deduplicated; each carries the reasons that produced it.
 * @returns {Array<{command: string, reasons: string[]}>}
 */
function commandVariants(cmd) {
  const seen = new Map();
  const add = (v) => {
    if (v.command !== cmd && !seen.has(v.command)) seen.set(v.command, v);
  };
  const level1 = firstLevel(cmd);
  level1.forEach(add);
  for (const v of level1) {
    for (const w of firstLevel(v.command)) {
      add({ command: w.command, reasons: [...new Set([...v.reasons, ...w.reasons])] });
    }
  }
  return [...seen.values()];
}

/**
 * Canonical form for example-to-command comparison: lower case, one space
 * around operators, no trailing slashes, `~/`/$HOME stripped, single-letter
 * flags merged and sorted. Two commands with equal canonical forms differ
 * only cosmetically.
 */
function canonicalCommand(cmd) {
  const spaced = cmd.toLowerCase().replace(/["']/g, '').replace(OPERATOR_RE, ' $1 ').trim();
  return tokens(spaced)
    .map((p) => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p))
    .map((p) => p.replace(HOME_PREFIX_RE, '').replace(/^~\//, ''))
    .map((p) => (/^-[a-z]{2,}$/.test(p) ? `-${[...p.slice(1)].sort().join('')}` : p))
    .join(' ')
    .replace(/(^|\s)-([a-z])\s(\d+)(?=\s|$)/g, '$1-$2$3');
}

module.exports = { REASON, commandVariants, canonicalCommand };
