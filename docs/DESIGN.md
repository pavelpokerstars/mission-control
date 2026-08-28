# The interface — a specification

The clickable preview is the reference for what Mission Control looks like and
how it behaves. This is that preview written down, so it can be built from
rather than copied by eye.

`DIRECTION.md` says what the product is and why. This says what the screen does.
Where a rule below has a reason attached, the reason is the point — most of them
were bought with a bug.

**The preview is committed, at `docs/design-preview.html`.** Open it straight
off disk — it is a standalone page, self-contained apart from Google Fonts, and
nothing generates or overwrites it. It is fixture-driven, carries a
`↺ reset the data` control so anyone can click around freely before a demo, and
every screen in it is described below.

Where this file and that one disagree, **the preview wins**: it is the version
that was tested in a browser.

---

## 1. The one idea

**The interface is greyscale. Every colour on the page means something.**

There are exactly two colour vocabularies, and nothing else is coloured at all:

| | |
|---|---|
| **Severity** | `crit` · `warn` · `ok` — how bad, on chips and the left stripe of a row |
| **Source** | Jira, Slack, Zoom, Confluence, Miro — which system a record came from |

Buttons are near-black on near-white (and inverted in dark). Links are
underlined text. There is no brand accent, no decorative gradient, no coloured
heading. If something on screen is coloured, a reader is entitled to ask what it
means — and there is an answer.

This is the direct answer to *"everything has to earn its place"*. It also makes
the alerting story legible: the only saturated thing on the front door is the
severity stripe on a row that needs you.

---

## 2. Tokens

Everything is a custom property on `:root`, redefined in **both** dark blocks —
`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` and
`:root[data-theme="dark"]`. Nothing is ever coloured with a literal.

```
ground app sunk line line-2      surfaces, hairlines
ink ink-2 ink-3                  text: body, secondary, muted
btn btn-ink                      the one solid control colour
crit warn ok  + …-bg             severity, and its tint
s-jira s-slack s-zoom s-conf s-miro s-vault
gutter                           the one horizontal measure — see §3
color-scheme                     light / dark — see §7
ic-chev ic-cal                   icon shapes, as masks — see §6
```

**Type.** One sans (`Instrument Sans`) for everything a person reads, one mono
(`IBM Plex Mono`) for anything machine-ish: timestamps, counts, labels, keys,
chips, source names. The split is doing real work — the mono face is how you
know a thing is data rather than prose.

**Contrast.** Every text/ground pair clears WCAG AA. `--ink-3` in particular was
tightened from `#828B96` to `#69727E` in light mode when it measured 3.45:1 on
white; it is used for small labels, which is exactly where a low ratio hurts.

---

## 3. Layout

### The app window

Every screen is one `.appwin` — a rounded, hairline-bordered panel with
`overflow: hidden`. Inside it, content is stacked in **bands**: a top bar, then
page-specific bands separated by 1px rules. There is no grid, no sidebar, no
column layout anywhere.

### One gutter

**Every band uses `var(--gutter)` for its horizontal padding.** 30px normally,
18px under 640px, changed in one place.

This is not tidiness. Before it existed, sixteen components hard-coded `30px`
and the breakpoint narrowed only four of them — so on a phone half the page sat
at 18px and half at 30px. Any new band must use the token, and the check is:
every content edge on every screen resolves to a **single x**.

**A row with a left stripe pulls its left padding back by the stripe width**
(`calc(var(--gutter) - 3px)`), because a border adds to layout and would
otherwise indent stripe rows 3px past every heading above them.

### The vertical rhythm is set at real density

A band pads `17px` and its label clears `10px`; a checklist row is `8px`, an
evidence card `11px`, and the gap between cards is `8px`. These were `24`, `16`,
`10`, `13` and `10` — drawn against a preview showing **three alerts with
one-line impacts**, and measured against the app they produced a missing-ticket
page 1606px tall whose `What now` band began 1051px down. On any laptop the
answer to the alert was below the fold on arrival, every time.

The rhythm is 119px of that, and it applies to every page: the same five rules
set Later, Ask, Sources and the note page. Nothing is reordered by it and
nothing is removed; the page simply stops spending a quarter of its height on
air before it answers.

**The other 137px was a band that was never in this document.** The alert is
head → checklist → evidence → actions → ask, and the app had grown a sixth —
`How it was recorded when it was said`, printing the vault note's body between
the evidence and the answer. Every clause of it was already on screen: measured
on one alert, the body's first sentence is the claim *and* the evidence quote
directly above it, the meeting is that quote's own label, the date clause is the
impact line, and the tail is both the impact's tail and the jira observation row.
Together the two changes take the page from 1606px to 1350px and put all four
actions on the first screen of a 1000px window.

A hand-written note can of course say more than the generated ones do, and one
in `fixtures/` does. The design's answer to that is not a band either: the
preview puts that same fact in an **answer** to a suggested question. The note
is untouched in the vault, it is what the agent reads, and the ask box is
directly below the actions.

### Back links own their space

`.back` supplies the gap beneath itself and the next band starts flush
(`.back + .head`, `.back + .greet`). Before this, two pages carried inline
`padding-top` patches to compensate.

### No inline styles

There are none in the preview, deliberately. Inline styles are where ad-hoc
spacing accumulates, and every spacing bug found so far started as one.

---

## 4. The pages, and how you move

A permanent **toolbar** of exactly three: `Alerts 3 · Later 2 · Ask 6`. The
counts are read from the data, never written down (see §8). **Three is the
ceiling** — a fourth entry and the toolbar starts reading as a launcher for tools
rather than as the two or three things you might want from anywhere.

**All three carry a count, and only two of them are work.** An alert is
something unanswered and a parked note is something that came back; a
conversation count is neither — it says how much you have said. So Ask's badge
is drawn in the same neutral as Later's and is **never** `hot`, because red in
this toolbar means somebody has to look at something.

Everything else is contextual:

| To reach | You |
|---|---|
| Mission Control | arrive from the notification, or the toolbar |
| An alert | click a row in the list |
| A conversation | open it from Ask, or from an alert's ask header |
| Later | the toolbar, or `2 parked for later` beside the list heading |
| A record | click a citation — **there is no other way in** |
| Sources | click the connector dots in the top bar |

**Sources is not in the toolbar.** The dots are already its live status and its
door; a page you set up once does not need a permanent seat beside the pages you
work in.

### Two back links, and they mean different things

- `← back to the list` / `← all notes` / `← all conversations` — **up** one
  level, from a thing to the list that holds it. Always top-left.
- `Open the alert` — **across**, to a related page. Right-hand side of a context
  bar, no arrow, and it is not a "back": you may never have been there.

Later and Sources have no back link at all, because the toolbar is their way out.

---

## 5. The two page shapes

Every page is one of two shapes. There is no third.

**A list** — a page header (title, sometimes a composer, a count line), then
rows. Mission Control, Ask, Later.

**A thing you opened** — a back link, a context bar saying what this is and
offering a related page, then the content. An alert, a conversation, a note, a
record.

### A row

```
[chip]  Title                                    meta
        subtitle · when                            ✕
```

Left stripe carries severity (or neutral). The whole row is a container, not a
button — a delete control cannot live inside the button that opens the row, so
the row holds a `.rowmain` button plus a sibling `.rowdel`. The `✕` appears on
hover and focus.

**Rows are labelled by what they are about.** A conversation about an issue is
titled with the *issue*, and the question you asked becomes the subtitle. This
was wrong for several revisions: a conversation opened from an alert was titled
with your first question, so the page you left and the page you arrived at named
the same thing differently.

### A context bar

`[chip] About <subject>` on the left, a related-page link on the right. On an
untied note the subject is an **editable name field** — text until you hover it,
so an unnamed note carries no chrome. On an untied conversation there is only
the chip; there was a filler sentence there and it was removed rather than
padded out.

---

## 6. Components

**Chips** carry a kind: an alert type in its severity colour, or `General` /
`Note` in neutral. A chip on a list row and the chip on the page it opens are
read from the same source, so they cannot disagree.

**Composers** are the primary action wherever creating something is the point —
Ask's `Ask anything…`, Later's `Park a note for later…`. Not a button in a
corner: the composer looks like the thing it makes.

**Icons are CSS masks**, not glyphs and not baked images:
`background: var(--ink-3)` + `mask: var(--ic-chev)`. That way the shape is
vector and the colour is a token, so icons follow the theme and hover like every
other muted control. They are drawn thin — 1.8–2px stroke, rounded caps — to
match the hairline rules; solid filled shapes read as the heaviest marks on the
page and look foreign.

**Selects use our own arrow.** `appearance: none`, a masked chevron positioned
by us, and enough right padding that text never runs under it.

**The calendar is ours.** The native date panel is browser chrome: it cannot be
restyled and opens in the wrong theme. A month grid — Monday first, today
outlined, past dates disabled, selection filled in `--btn` — using the app's own
surfaces. It measures on open and **flips upward when it would overflow**
`.appwin`, whose `overflow: hidden` would otherwise clip it.

---

## 7. Interaction rules

### Asking is not navigation; opening a conversation is

Questions asked on an alert are answered **in place**, below the actions — no
route change, nothing to come back from. The inline thread is the **tail** of the
conversation and must be **capped** (say the last two exchanges, with the header
reading "showing the last 2 of 9"), or the alert page grows without bound.

`open full conversation` in the ask header is the one route to the full view, and
it is why that view can have a back link honestly.

Its label states what it will do, so clicking holds no surprise:

| conversations on this alert | label | behaviour |
|---|---|---|
| 0 | `no conversations yet · start one →` | a new chat, already tied |
| 1 | `1 earlier conversation · open it →` | straight into it |
| n | `n earlier conversations · see them →` | Ask, filtered to that issue |

### You read the message before it goes, and you may rewrite it

A drafted message is shown **in full**, in the result strip, in an editable box
with `Send it` beside the way out. The strip used to say *"Drafted. Read it
before it goes"* and then print a citation count, which is an instruction the
interface made impossible to follow.

**The report and the message are two voices, so they get two surfaces.** The
outcome sentence is the app speaking; the message is the artefact it is speaking
about. Run together in one weight they read as one paragraph — *"Sent to
jonas.jost and cleo.calder in #orbit-delivery."* straight into *"jonas.jost,
cleo.calder — ORB-1627 is called done and not done."* — so the message sits in a
labelled card (`THE MESSAGE`, or `WHAT WENT` once it has gone) on the page
surface inside the coloured panel, the same move `.ev article` makes for a
citation. A quoted record inside it is drawn with the left rule it has
everywhere else rather than the `>` it is typed with: the marker is Slack's
syntax, and the reader is looking at a record, not at markup.

Two things follow from the words going out over somebody's name. The draft names
who it is addressed to — read from the records, never guessed, and absent when
no record names anybody. And what is posted is what is in the box: we can say
who and quote what, and we cannot know the sentence this team would actually
use.

**`Send it` is not a fifth action.** The four are the answers to the alert; this
is what you press inside the result of one of them, on a draft already on
screen. It never appears in the `.acts` row.

### Delete acts, and stays undoable

No "are you sure?". Deleting removes the row immediately and puts an **undo strip
in the slot the row occupied** — the gap is the clearest possible label for what
will come back. Undo restores it at its original index.

A confirm dialog makes the safe path cost two clicks and catches almost nothing,
because you already decided before you read it. It also produced *"Delete Who
should I ask about the payments provider??"* — a question mark on a question.

**The offer lives until you leave the page it belongs to.** No timer: a strip
that vanishes after a few seconds is one you must react to rather than decide
about.

### Editing happens on a page, not in a row

Clicking a note opens it with room to write, its reminder picker, and its link to
the issue. The picker's first option is `Leave it — <current date>`, so opening a
note never silently reschedules it.

### Deferring is what creates a tied note

An alert has **four** actions and two of them are "no", because they are
different answers:

1. the primary action (create the ticket, show the loop, ask both)
2. a secondary action (ask someone)
3. **Not now** — asks for a note and when it should come back, then parks it
4. **Not needed** — dismisses it for good, and that is recorded as a decision

There is no other route to a Later note that is tied to an issue.

### Reminders can be events, not just dates

The picker has two groups, and the second is the one a generic snooze tool cannot
offer:

- **On a date** — tomorrow, Monday, in a week, in two weeks, pick a date
- **When something happens** — when the sprint ends, if anything changes on it,
  when the thing it waits on moves, if nobody has touched it in a week

Every dated option shows the date it resolves to. You are rarely waiting for
Tuesday; you are waiting for a person or a ticket, and this app is already
watching both.

---

## 8. Rules bought with bugs

Each of these was a real defect in the preview. They are cheap to honour and
expensive to rediscover.

**Anything that states a count reads it from the collection.** The toolbar badge
and the Later heading were both literals; deleting a note left them lying, twice,
on one page.

**Every date derives from one `TODAY` constant.** Hand-written dates produced a
sprint closing on a Saturday and a "Friday 22 August" that was a Saturday, and a
"Monday morning" option that resolved to a Tuesday. There is now an assertion
that parses each option label and checks the weekday against a real `Date`.

**`color-scheme` must be declared.** Without it native controls render in the
opposite theme — the date input's icon was invisible and its panel opened white.

**Balanced braces are not a valid stylesheet.** A regex that removed a selector
but left its declaration block kept the brace count even and silently swallowed
the next rule, so every conversation row fell back to browser-default button
styling. `verify-design.mts` walks every stylesheet and flags any block whose
selector is empty or ends in `;` or `}`.

The stylesheet is now one file per component, which multiplies that risk by
seventeen: a rule lost out of a thirty-line file leaves the file parsing
perfectly and one screen rendering without it, and no typecheck sees a `.css`
file at all. Two more checks hold the split — every component stylesheet is
imported by its own component, and no two of them claim one scoping class, since
which would win is otherwise the order the module graph happened to import them
in. A class two components render belongs in `alerts/shared.css`.

**Verify by reading the DOM, not the screenshot.** The preview pane serves stale
frames often enough to mislead; computed styles and measured rectangles do not.

**A class name is a namespace.** `.askhead` came to mean two different things and
the second definition silently broke the first.

**Check `claude-cli.ts` as well as `claude.ts`.** Three provider bugs so far have
been one-sided, correct on the Messages API path and broken on the CLI path —
which is the rung a fresh checkout reaches first. See `KNOWN-GAPS.md` §1.

---

## 9. What the preview does not settle

> **Three of these have been built since, and three things now differ from the
> preview on purpose.** The list below is kept as the record of what was open at
> the time; the current state is marked inline.

### Where the built app knowingly differs from the preview

The preview wins by default, so a difference has to be argued rather than
allowed to drift. Four are:

- **A Miro citation opens the record, not the live board.** The preview's map
  card promises "the real board, framed on the stickies or arrows the alert is
  about". The app reads the graph instead, for the reason dependency truth does:
  a citation points at the sticky *we reasoned over*, and with a real token the
  board returns whatever is on the canvas today — so the live embed would show a
  reader something the alert was not built from. `CLAUDE.md` carries the full
  argument.
- **The map card says the alert has "three actions".** It has four, and the
  preview's own alert screen says four — *"Four actions, and two of them are
  'no' — because they are different answers."* The card is the stale half of a
  disagreement inside one document; the screen is the one that was tested.
- **A cycle's primary action is `Ask about the loop`, where the preview says
  `Show me the loop`.** The preview's result for it — *"framed on the four
  tickets, with everything else dimmed"* — **is** the evidence view, which is
  `DIRECTION.md` §1's one unbuilt promise. A button labelled "show me" that
  shows nothing is worse than one that does what it says, so the label states
  the effect the app can actually deliver. **This reverts to the preview's
  wording the moment the evidence view lands**, and it is the only alert whose
  primary label differs; every dismiss label matches the preview exactly.

- **The second action is an ask on every alert, where the preview gives each
  one its own.** The preview's second button is `Ask the platform team` on a
  missing ticket, `Ask dana about this morning's arrow` on a cycle, and on a
  disagreement it is not an ask at all — `Open MC-102`, whose result is *"opened,
  with both records pinned beside the ticket"*. That last one is a Jira write we
  do not make, and a button that merely **navigated** to the record would break
  two rules at once: §4's "a record — click a citation, there is no other way
  in", and the in-place rule `verify-design.mts` enforces, which is that an
  action resolves where it was pressed. So the slot stays an ask, and the
  difference between the two is made real rather than decorative: where the
  records name more than one person the primary asks all of them together and
  the second asks one alone — `Ask both, in one thread` beside `Ask jonas.jost
  only`. Where only one person is named the two do coincide, and the lead says
  so in the preview's own words: *"Both Ask buttons draft a Slack message… and
  send nothing until you read it."* **This reverts to the preview's per-alert
  buttons when there is something for them to do** — for the disagreement, that
  is pinning records on a ticket.

And one piece of the preview is **specified and not built**: Sources is where
"the animated brain" belongs — the preview says so twice, and it is the reason
that page is *"safe to make the impressive one"*. There is no brain in
`Sources.tsx`.

### Open at the time the preview was drawn

- **Empty and error states.** ✔ built — `explain()` turns a `TypeError: Failed to
  fetch` into "The gateway is not answering on :8787. Start it with `npm run dev`."
  Only Later had one in the preview.
- **The notification itself** beyond one Slack card — no email, no digest, no
  per-user preferences. Whether alerts are personal or program-level is still
  open (`DIRECTION.md` §2).
- **Keyboard and focus order** are correct per element but no shortcuts exist and
  no focus trap is defined for the calendar panel.
- **Loading.** Everything is instant on fixtures. A real summary takes 20–60
  seconds on the CLI provider, and nothing in the preview shows that.
- **The inline-thread cap.** ✔ the inline thread is built (`AskInline.tsx`) —
  asking happens on the alert and does not navigate.
- **Undo.** ✔ built for a deleted note: the row goes with no "are you sure?", the
  undo strip takes **the slot it occupied**, and undo restores it at its index.
  Dismissing an *alert* is still immediate — that one is a decision, and it is
  recoverable only in the sense that the finding stops being suppressed.
- **Mobile** below 640px changes only the gutter. The toolbar, context bars and
  the calendar are untested at that width.
