# iOS Home redesign

Status (2026-10-14): prototyped on `feat/home-redesign`. After seeing it in
the simulator, the user dropped the Now card ("the big cards are a bit
pointless") and asked for the shortcuts at the top and smaller stop rows.
What shipped in the prototype: search, then the Go chip row, then "Your stops"
and "Near you" as grouped compact rows. The Now card sections below are kept
for the record only.

Original status: proposal, not started. Mock up the "Now" card and a full-screen
mockup first, and confirm before writing Swift (see the theme revert of
2026-09-25: neutral shadcn + Geist look stays).

Files: `ios/Transit/Views/Home/HomeView.swift`, `HomeCards.swift`,
`Views/Places/SavedPlacesViews.swift` (`SavedPlacesRow`),
`DesignSystem/Components.swift` (`SectionLabel`).

## What's wrong today

Home is four sections of equal weight: Places, Saved stops, Saved trips,
Nearby. Each one uses the same header (an all-caps label, a count pill and
an Edit/Manage action) and the same card.

**Why it feels cluttered**

- Every stop is its own bordered card with a 36 pt tile, a title, a chevron,
  a distance and two departure lines. With 3 saved stops and 3 nearby stops,
  that's six heavy cards stacked up.
- Three different layouts compete: a horizontal chip row (places), a
  horizontal card carousel (trips) and vertical cards (stops).
- A new user sees up to three dashed "hint" cards at once (no saved stops,
  no trips, no location). That's a page of empty states.
- Lots of small chrome: count pills, chevrons on every row, an
  "Edit"/"Manage" on every header, "Plan now →" on every trip card.

**Why it feels boring**

- Everything carries the same visual weight, so nothing answers the
  question you open the app with: *when's my bus?*
- The most useful number on the screen, the minutes until the next
  departure, is the smallest text on the screen (12 pt mono, pushed to the
  right edge).
- The page is all greyscale apart from route badges. The colour the
  network already supplies (route colours, plus the swatches riders pick
  for their stops) is shrunk into 11 pt badges and 36 pt tiles.

## Brief

- **Subject:** a live NZ public transport app (AT, Metlink and others).
- **Audience:** commuters who open it for a few seconds, often walking,
  often one-handed.
- **Primary job of Home:** show the next departure from the stop that
  matters right now. Second job: one tap to "get me home/to work".
- **Constraint:** keep the neutral Geist palette and type. Spend
  boldness on layout and hierarchy, not a new theme colour.

## Design tokens (unchanged palette, new hierarchy)

Colour: no new colours. Existing `Theme` tokens only.

| Role | Token | Hex (light / dark) |
| --- | --- | --- |
| Page | `groupedBackground` | #F2F2F4 / #171717 |
| Surfaces | `card` | #FFFFFF / #1F1F1F |
| Ink | `foreground` | #0A0A0A / #F5F5F5 |
| Secondary ink | `mutedForeground` | #737373 / #A3A3A3 |
| Live times | `live` | #2563EB / #60A5FA |
| Identity | route colour + rider swatch | from data |

**Principle:** the network supplies the colour. Route colours and the
rider's own stop swatches are the only accents. They get bigger, and the
chrome gets quieter.

Type (Geist + Geist Mono, both already bundled):

| Role | Face | Size | Notes |
| --- | --- | --- | --- |
| Now: minutes | Geist Mono, semibold | 44, `.largeTitle` relative | the one big thing on the page |
| Now: "min" unit | Geist Mono | 17 | sits on the baseline after the digits |
| Stop name (Now) | Geist semibold | 19 (`pageTitle`) | |
| Section heads | Geist semibold | 16 (`cardTitle`), sentence case | replaces the all-caps `SectionLabel` on Home |
| Row titles | Geist medium | 15 (`bodyMedium`) | |
| Times in rows | Geist Mono medium | 15 | up from 12; times are the content |
| Meta | Geist | 13 (`meta`) | |

Everything stays relative to a text style, so Dynamic Type keeps working
(see the accessibility-text-size note: normal sizes plus Dynamic Type, no
oversized fixed text).

## Layout

The page goes from four equal sections to three tiers, each lighter than
the one above:

```
┌─────────────────────────────────────┐
│ Auckland                     🔔  ☰  │  inline title + toolbar (unchanged)
│ ┌─────────────────────────────────┐ │
│ │ 🔍 Search stops                 │ │  search (unchanged)
│ └─────────────────────────────────┘ │
│                                     │
│ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │  1. NOW: one card, the stop that
│ ┃ ★ Britomart Train Station    3m ┃ │     matters right now
│ ┃                                 ┃ │
│ ┃ [EAST]  Manukau            4    ┃ │     next departure: big mono
│ ┃         Platform 2        min ⦿ ┃ │     minutes, live glyph
│ ┃ ─────────────────────────────── ┃ │
│ ┃ [WEST]  Swanson              9  ┃ │     two more, normal size
│ ┃ [ONE]   Onehunga            14  ┃ │
│ ┃                    ● ○ ○        ┃ │     swipe: next saved stop
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                     │
│ (⌂ Home) (💼 Work) (◆ Gym run) (+)  │  2. GO: places + saved trips as
│                                     │     one chip row
│ Your stops                     Edit │  3. LISTS: plain grouped rows,
│ ┌─────────────────────────────────┐ │     hairline separators,
│ │● Victoria Park     [NX1] 2  [82] 6 │ no per-row card, no chevron
│ │● Symonds St        [70]  5  [75] 11│
│ └─────────────────────────────────┘ │
│                                     │
│ Near you ⦿                     Map  │
│ ┌─────────────────────────────────┐ │
│ │🚌 Customs St E  120m [NX1] 1 [CTY] 4│
│ │🚌 Lower Albert  240m [83]  3 [881] 7│
│ │🚆 Britomart     260m [EAST] 4       │
│ └─────────────────────────────────┘ │
│   Show more                         │
└─────────────────────────────────────┘
```

Alignment: everything is left-aligned to one 16 pt gutter. Times are
right-aligned in a fixed-width mono column, so minutes line up down the
page like a departure board. Nothing is centred except the page dots.

### 1. Now card (the one bold thing)

- **Which stop:** the nearest saved stop within ~800 m of you. If there
  isn't one, the nearest stop. If location is off, the first saved stop.
  Swipe sideways (paged `ScrollView`, `.scrollTargetBehavior(.paging)`) to
  move through your other saved stops in sort order.
- **Next departure:** a large route badge, the headsign plus platform on
  two lines, and the minutes in 44 pt Geist Mono. It's `Theme.live` with
  the signal glyph when the time is tracked, plain ink when it's only
  scheduled. When it's under a minute, show "Now", never "0".
- **Then two more departures** at row size below a hairline.
- **Identity:** a 4 pt leading edge in the stop's swatch colour (rider's
  colour for a saved stop, the mode's route colour for a nearby one). This
  is the only place a block of colour appears.
- **Header line:** stop name, plus a walk time or distance on the right
  ("3 min walk"). Tap anywhere to open the full board. The context menu is
  the same as the saved-stop menu today.
- Polls every 30 s, as `HomeStopRow` does now (the `foregroundPoll`
  modifier). Fetch 3 departures instead of 2.
- **Motion:** when the minutes change, use
  `.contentTransition(.numericText())`. Nothing else animates. Respect
  Reduce Motion (plain swap).

### 2. Go row

- Merge `SavedPlacesRow` and `SavedTripsCarousel` into one chip row. Places
  plan from your location. Saved trips plan their stored origin to
  destination, and their chip gets a small swatch dot plus the trip name.
- The fat trip cards (from/to endpoints, "Plan now →") go away. The
  context menu still offers rename, colour and delete, and the endpoints
  move to the accessibility label.
- Add chips ("Add home", "Add work", "+") stay at the end of the row, but
  only while there are fewer than 2 places. After that, a single "+" chip.
- No section heading. The chips explain themselves.

### 3. Your stops / Near you

- **One container per section:** an inset grouped surface
  (`shadCardBackground` once, around the whole list) with hairline
  dividers. No card per row.
- **Row:** a small tile (24 pt: swatch star for saved stops, mode glyph for
  nearby ones), then the name with the distance in meta. Next departures
  sit on the **same line** as compact `badge + minutes` pairs. Drop the
  headsigns here, since the Now card and the board carry them.
- At accessibility sizes, the departures wrap onto a second line
  (`ViewThatFits`).
- **Headings:** sentence case at `cardTitle` size. No count pills. Saved
  stops get one "Edit" action and Nearby gets "Map", so the actions stay
  but the pills go.
- If the Now card is showing a stop, leave that stop out of the list below
  it so it isn't on screen twice.
- Near you shows 3 rows, with "Show more" expanding to 6, as today.

### Empty and first-run states

Replace the stack of dashed hints with one **"Set up Home" card** that
appears only when the rider has no saved stops *and* no places. It holds
three plain actions: "Add home", "Turn on location" (or "Turn on in
Settings" when location was refused) and "Save a stop from the map".
Each action disappears once it's done. Once any of them is done, the
remaining hints shrink to single inline text rows inside their section.

The Now card's own empty states:
- No location and nothing saved: the card isn't shown, and the setup card
  takes its place.
- No services: "No more departures today" plus the first departure
  tomorrow, if the board has it.
- Load failed: "Couldn't load departures. Pull to refresh." The stale
  "Times as of 8:42" behaviour stays as it is.

### iPad (regular width)

Two columns, as today. On the left: the Now card and the Go row. On the
right: Your stops and Near you. On iPad the Now card becomes a vertical
stack of every saved stop's card instead of paging sideways.

## Review against the brief: what changed and why

The first draft of this plan had a "Good morning" greeting header and a
big tinted hero with a gradient wash in the stop's colour. Both are generic
"dashboard app" moves. A greeting is filler for someone checking a bus
time, and a gradient is exactly the decoration the theme revert pushed
back on. They're replaced by the departure-board treatment: the big thing
is the *minutes*, set in the mono face the app already uses for times,
with colour only as a thin edge. That comes from transit signage rather
than a template.

The big number can also read as the stock "big stat + small label" pattern,
so it was checked against the brief: here the number *is* the job of the
screen (it's what a platform departure board shows at that size), so it
stays. It's the only large element on the page.

## Build phases

1. **Mockup (no Swift).** An HTML mockup of the new Home in light and dark,
   at phone width, with real Auckland data shapes. Get the user's sign-off
   on the direction.
2. **Now card.** `HomeNowCard` plus the stop-picking logic (a pure function
   in TransitCore, with unit tests for: saved stop nearby, none nearby, no
   location). Fetch 3 departures.
3. **Lists.** Swap `HomeStopRow` for a compact grouped row and drop the
   per-row cards and chevrons. Use a Home-only sentence-case section header.
   Other screens keep `SectionLabel` until we decide to change them too.
4. **Go row.** Merge places and trips into one chip row and remove the
   `SavedTripsCarousel` and `HomeTripCard` usage on Home. `ManageTripsSheet`
   stays.
5. **Empty states.** Add the setup card and cut the `HomeHint` stack.
6. **iPad, plus UI test and screenshot updates.** UI tests that look for
   "Saved trips" or the trip card labels will need new identifiers.

## Open questions for the user

- Should the Now card be allowed to pick a *nearby* stop you've never
  saved, or only ever show saved stops?
- Should saved trips stay as their own row of richer cards, or go into the
  chip row as proposed?
- Should the search field stay pinned, or scroll away with the page to
  give the Now card more room?
