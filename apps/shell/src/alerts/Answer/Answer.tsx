/**
 * An agent's answer, rendered.
 *
 * NOT the pane app's `Markdown.tsx`, which was 326 lines and imported Mantine
 * and the context bus — bringing it back would restore the second component
 * library this app does without, which is most of why the build is ~231 kB.
 * What survives from it is the one lesson worth keeping:
 *
 * **THE ORDER OF THE INLINE RULES IS THE WHOLE DESIGN, and getting it wrong is
 * silent.** Flat left-to-right passes look fine and are broken: run the
 * ticket-key rule before emphasis and `**PAY-9031 → PAY-9032**` is split into
 * three fragments, after which the `**` pair is in two different strings and
 * can never match. Emphasis wraps and recurses, so emphasis goes first; a code
 * span owns its content and does not.
 *
 * A ticket key becomes a link to its record, because `DIRECTION.md` §9's second
 * rule is that the chat "cites like the page does" — an answer naming PAY-9031
 * as inert text is an answer you cannot check.
 *
 * A `[[wikilink]]` is rendered as plain text on purpose. Wikilinks are internal
 * to vault storage and appear nowhere else in this interface; the agent is told
 * to cite notes that way, and the right thing to show a reader is the name, not
 * a link to a page that does not exist.
 */

import { Fragment, type JSX, type ReactNode } from 'react';

import './Answer.css';

const KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/;

/**
 * Inline rules, in the only order that works. Each returns the matched node and
 * whether the remaining rules should recurse into its content.
 */
const INLINE: { re: RegExp; render: (m: RegExpMatchArray, key: number) => JSX.Element; wraps: boolean }[] = [
  {
    re: /\*\*([^*]+)\*\*/,
    render: (m, k) => <b key={k}>{inline(m[1]!, 0, k + 2)}</b>,
    wraps: true,
  },
  /**
   * Single-asterisk emphasis, and it has to sit HERE — second, straight after
   * bold and before every atom.
   *
   * The agent quotes people as `*"PAY-9031 is done"*` all the time and the
   * asterisks were rendering literally. Moving this rule after the ticket-key
   * rule looks harmless and is not: `KEY` would match inside the quotation
   * first, split the string, and leave the opening and closing `*` in two
   * different fragments that can never pair — the same failure the header
   * describes for code spans. Bold still wins because it needs two asterisks
   * and runs first.
   */
  {
    re: /\*([^*\n]+)\*/,
    render: (m, k) => <i key={k}>{inline(m[1]!, 0, k + 1)}</i>,
    wraps: true,
  },
  {
    re: /`([^`]+)`/,
    render: (m, k) => <code key={k}>{m[1]}</code>,
    wraps: false,
  },
  {
    re: /\[\[([a-z0-9-]+)\]\]/i,
    render: (m, k) => <i key={k}>{m[1]}</i>,
    wraps: false,
  },
  {
    re: KEY,
    render: (m, k) => (
      <a key={k} href={`/record/jira/${encodeURIComponent(m[1]!)}`}>
        {m[1]}
      </a>
    ),
    wraps: false,
  },
  /**
   * A Slack channel becomes a citation chip, exactly as the preview draws it:
   * the surface dot and the channel, in mono, on a pill.
   *
   * `DIRECTION.md` §9's second rule is that the chat "cites like the page
   * does". An answer saying a thing was discussed in #eng-payments as flat prose
   * makes the same claim as an evidence row and looks like an opinion, which is
   * the difference this product exists to hold.
   *
   * NOT a link, and deliberately: the alert page's own rule is that a citation
   * with a quote opens its record and an observation does not, and a channel
   * name in prose is not a record reference — there is no line to land on.
   *
   * The name must start with a letter or digit, so a markdown heading (`# `,
   * with the space) cannot match.
   */
  {
    re: /#([a-z0-9][a-z0-9._-]*)/i,
    render: (m, k) => (
      <span className="cited" key={k}>
        <i className="dot slack" aria-hidden="true" />#{m[1]}
      </span>
    ),
    wraps: false,
  },
];

/**
 * `->` separated nodes, each optionally tagged, drawn as the preview's chain.
 *
 * `DIRECTION.md` §9's third rule: "When the answer is a shape, it draws the
 * shape. A dependency chain read as prose is worse than seeing it." The preview
 * agrees in the answer's own words — *"I am showing you the chain rather than
 * describing it because the shape is the answer."*
 *
 * A FENCE RATHER THAN STRUCTURED OUTPUT, because the turn streams. Asking for
 * typed JSON would mean waiting for a whole answer before showing any of it,
 * and the SSE loop is the reason an answer appears to be typed. The model
 * decides *when* the answer is a shape; this decides how it looks.
 *
 * ```chain
 * what the topic is holding up          ← optional caption, when 2+ lines
 * Kafka topic · no ticket [missing] -> PAY-9031 · done -> PAY-9035 [at-risk]
 * ```
 */
/**
 * Every arrow a model plausibly writes. The prompt asks for `->`; models
 * produce `-->`, `=>`, `→` and an en-dash variant with no prompting at all, and
 * each unrecognised one silently collapsed the whole chain into ONE node —
 * a diagram rendered as a single box containing the sentence.
 *
 * The dash class has to come before the bare `>` alternative so `-->` is
 * consumed whole; otherwise every node but the last keeps a trailing dash.
 */
const ARROW = /[-–—]{1,2}>|=>|⇒|→|⟶|➔/;

/**
 * A node's optional risk tag. `/i` and a space are accepted, and the result is
 * NORMALISED, because the capture becomes a CSS class name.
 *
 * That is the trap here and it fails in the worst direction. `[MISSING]`
 * captured verbatim yields `class="node MISSING"`, which matches nothing —
 * `.node.missing` is case-sensitive — and `[at risk]` yields three classes,
 * `node at risk`. Both are strictly worse than not accepting the spelling at
 * all: the tag is stripped out of the label AND unstyled, so the one node the
 * reader is meant to look at renders identically to the others. So the class is
 * lower-cased, hyphenated, and then checked against the two the stylesheet
 * actually draws.
 */
const NODE_TAG = /\s*\[([a-z][a-z -]*)\]\s*$/i;
const TAGS = new Set(['missing', 'at-risk']);

function tagClass(raw: string): string | undefined {
  const m = NODE_TAG.exec(raw);
  if (!m) return undefined;
  const cls = m[1]!.toLowerCase().trim().replace(/\s+/g, '-');
  return TAGS.has(cls) ? cls : undefined;
}

function Chain({ lines }: { lines: string[] }): JSX.Element {
  /**
   * Line one is a caption only when it is not itself part of the chain.
   *
   * Counting lines alone got this wrong in both directions. A chain long enough
   * to wrap over two lines had its first half rendered as a 10px mono caption
   * and only its tail drawn — silently, and it looks deliberate. And mid-stream,
   * the frame where only the caption has arrived is one line, so the caption
   * flashed up as a node box before flipping.
   *
   * The test is "no arrow here, and an arrow later". Both halves matter: `no
   * arrow here` alone would make a one-line arrowless fence a caption with zero
   * nodes, which draws an empty box — a different silent failure, not a fix.
   */
  const isCaption = lines.length > 1 && !ARROW.test(lines[0]!) && lines.slice(1).some((l) => ARROW.test(l));
  const caption = isCaption ? lines[0]! : undefined;
  const nodes = (isCaption ? lines.slice(1) : lines)
    .join(' ')
    .split(ARROW)
    .map((n) => n.trim())
    .filter(Boolean);

  return (
    <div className="inline-graph">
      {caption ? <span className="cap">{caption}</span> : null}
      <div className="chain">
        {nodes.map((raw, i) => {
          const cls = tagClass(raw);
          // The tag is stripped only when it is one we can draw. An unknown one
          // stays visible in the label rather than being silently deleted.
          //
          // Then the separator, if the tag was standing where the state should
          // have been: a model asked for "key · state [tag]" and holding no
          // state writes "ORB-1620 · [at-risk]", and taking the tag off leaves a
          // node reading "ORB-1620 ·". A dangling separator is punctuation
          // promising a word that is not coming.
          const label = (cls ? raw.replace(NODE_TAG, '') : raw).trim().replace(/[·|,:—–-]+$/, '').trim();
          return (
            <Fragment key={i}>
              {i > 0 ? (
                <span className="arrow" aria-hidden="true">
                  →
                </span>
              ) : null}
              <span className={cls ? `node ${cls}` : 'node'}>{label}</span>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

/**
 * `base` is what makes a key unique, and it was missing.
 *
 * Every node was keyed on `m.index` — its offset within whatever SUBSTRING the
 * recursion was looking at — and the tail restarts at zero, so two siblings in
 * one returned array routinely carried the same key. React logged "encountered
 * two children with the same key" on essentially every agent answer and warned
 * that children "may be duplicated and/or omitted".
 *
 * Threading the offset down makes the key the character position in the WHOLE
 * answer, which is unique by construction — and stable across the re-render an
 * SSE frame causes, so a streaming answer reconciles instead of remounting the
 * text a reader is part-way through.
 */
function inline(text: string, depth = 0, base = 0): ReactNode[] {
  // Emphasis recurses; a runaway would be a bug rather than deep markup.
  if (depth > 4) return [text];
  for (const [i, rule] of INLINE.entries()) {
    const m = rule.re.exec(text);
    if (!m || m.index === undefined) continue;
    const before = text.slice(0, m.index);
    const after = text.slice(m.index + m[0].length);
    return [
      // Rules BEFORE this one cannot match what it skipped past — they already
      // ran on the whole string and did not fire.
      ...(before ? inlineFrom(before, i, depth + 1, base) : []),
      rule.render(m, base + m.index),
      ...(after ? inline(after, depth, base + m.index + m[0].length) : []),
    ];
  }
  return [text];
}

/** Continue from a given rule, so a partial match cannot be re-scanned forever. */
function inlineFrom(text: string, from: number, depth: number, base = 0): ReactNode[] {
  for (let i = from; i < INLINE.length; i++) {
    const rule = INLINE[i]!;
    const m = rule.re.exec(text);
    if (!m || m.index === undefined) continue;
    return [
      ...(m.index ? [text.slice(0, m.index)] : []),
      rule.render(m, base + m.index),
      ...inlineFrom(text.slice(m.index + m[0].length), i, depth + 1, base + m.index + m[0].length),
    ];
  }
  return [text];
}

/**
 * Blocks: paragraphs and lists, and nothing else.
 *
 * Anything unsupported falls through as a paragraph, which is what the panel
 * did before — this is never worse than plain text.
 */
export function Answer({
  text,
  chains = false,
}: {
  text: string;
  /**
   * MAY THIS ANSWER DRAW A CHAIN, and it defaults to NO.
   *
   * A drawn chain reads as a verified shape — boxes, arrows, per-node state —
   * and that is the whole point of drawing it. But the model writes the node
   * names and the states itself, so the drawing is only as good as what the
   * gateway put in front of it. On an alert that is the detector's own ordered
   * walk (`Finding.impact`) and the shape is exactly right. In a conversation
   * about nothing in particular there is no walk, and a small model asked for a
   * shape will supply one: measured on the deployed demo, a general question
   * produced `ORB-1627 · done -> ORB-1641 · to do -> ORB-1669 · to do ->
   * ORB-1627`, three tickets with no dependency edge between any of them and
   * three invented statuses, drawn with the same authority as the real thing.
   *
   * So this is a fact about the caller rather than a sentence in the prompt:
   * only a caller holding a subject passes `true`. Everywhere else the fence
   * still renders — as its own text, monospaced and unstyled — because
   * swallowing it would hide that the model answered with a shape at all.
   */
  chains?: boolean;
}): JSX.Element {
  const blocks: JSX.Element[] = [];
  const lines = text.split('\n');
  let para: string[] = [];
  let list: string[] = [];

  const flushPara = (): void => {
    if (!para.length) return;
    blocks.push(<p key={blocks.length}>{inline(para.join(' '))}</p>);
    para = [];
  };
  const flushList = (): void => {
    if (!list.length) return;
    blocks.push(
      <ul key={blocks.length}>
        {list.map((li, i) => (
          <li key={i}>{inline(li)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  /**
   * Fence state. An UNCLOSED fence still renders what has arrived — the answer
   * is streaming, so every intermediate frame has one, and holding the block
   * back until the closing ``` would make a chain appear only at the very end.
   */
  let fence: string[] | undefined;

  for (const raw of lines) {
    const line = raw.trimEnd();

    /**
     * `{3,}` on both, and the two must agree.
     *
     * Written as exactly three, a model that emitted ````chain — which they do,
     * to nest a fence — matched the closing test, was `continue`d, and opened
     * nothing. Both marker lines then vanished and the chain fell through as a
     * paragraph reading `A -> B -> C`. The worst available failure: it looks
     * like the model simply chose not to draw one.
     */
    if (/^\s*`{3,}/.test(line)) {
      if (fence) {
        blocks.push(
          chains ? (
            <Chain key={blocks.length} lines={fence} />
          ) : (
            <p key={blocks.length} className="quiet">
              <code>{fence.join(' ')}</code>
            </p>
          ),
        );
        fence = undefined;
      } else if (/^\s*`{3,}\s*chain\b/i.test(line)) {
        flushPara();
        flushList();
        fence = [];
      }
      // A fence of any other language is not ours; it opens nothing and the
      // lines inside it fall through as prose, which is what happened before.
      continue;
    }
    if (fence) {
      if (line.trim()) fence.push(line.trim());
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      list.push(bullet[1]!);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  // Truncated mid-chain, or still streaming: draw what arrived — under the same
  // permission as the closed fence above, or a chain the caller may not draw
  // would appear while the answer streamed and be replaced when it closed.
  if (fence?.length) {
    blocks.push(
      chains ? (
        <Chain key={blocks.length} lines={fence} />
      ) : (
        <p key={blocks.length} className="quiet">
          <code>{fence.join(' ')}</code>
        </p>
      ),
    );
  }

  return <Fragment>{blocks}</Fragment>;
}
