# Hero image prompt: UAT, your call

For article 43, `uat-long-form.md`. Give the prompt below to an image-generation model, save the result as `images/uat-hero.png` (the long-form already points at that path), 1200 x 630 px.

**Alt text:** A three-position setting for human UAT (never, by risk, always), with "never" marked as the product owner's call, leading to a briefing, a procedure and an execution record that a tester completes and that are saved to a recorded release.

## Style to match (the other DevAudit heroes)

- 1200 x 630 px (1.91:1), flat vector look, no photography, no 3D, no glossy effects.
- Background: deep navy gradient from `#0B1220` (top left) to `#141E33` (bottom right), with a faint square grid (`#1E293F`, 40 px cells, about 50% opacity).
- Accent: a blue-to-teal gradient from `#5B8DEF` to `#7FD1C8`. A secondary amber `#F5B642` used once, for the marker on the "never" position.
- Text: headline `#F5F7FA` bold sans-serif (Helvetica Neue / Arial look); subtitle `#94A3B8`; small labels `#CBD5E1`. Eyebrow in `#7FD1C8`, letter-spaced capitals.
- Cards are dark rounded rectangles `#1E293F` with a thin `#334155` outline.
- Two faint concentric circles in the top right corner, drawn with the accent gradient at 25-35% opacity.

## Idea in one line

UAT is a setting, not a given: a three-position selector on the left (never, by risk, always), and on the right what exists when it is on: a briefing, a procedure and a record, a tester, and a recorded release.

## Prompt

> A clean, flat vector illustration for a software blog header, 1200 by 630 pixels, in a dark navy theme. Background: a smooth gradient from #0B1220 to #141E33 with a subtle square grid in #1E293F at half opacity. Top left, a small letter-spaced eyebrow in teal #7FD1C8 reading "DEVAUDIT.AI • UAT", with a short blue-to-teal gradient underline beneath it. Below it, a two-line bold white headline, "UAT is your call." on the first line and "When it runs, it's recorded." on the second, the second line filled with a blue (#5B8DEF) to teal (#7FD1C8) gradient. Under the headline, one line of grey (#94A3B8) subtitle text: "Switch the human test pack off, set it by risk, or require it every time."
>
> Left column, below the subtitle: one rounded dark card (#1E293F with a thin #334155 outline) labelled "Human UAT pack". Inside it, a horizontal three-position selector drawn as a thin track with three tick marks labelled "never", "by risk" and "always", and a round blue-to-teal gradient handle sitting on "by risk" (labelled "default"). Above the "never" tick, one small amber (#F5B642) marker with the tiny label "owner's call, compliance cost". This is the only amber element.
>
> Right of the card, a left-to-right flow joined by a thin gradient line with small arrowheads, slightly dimmer at its start to show it only exists when the selector is on. Stage one: three stacked dark cards labelled "Briefing", "Procedure" and "Record", each with a few short light lines, and a tiny label "written from the acceptance criteria". Stage two: a simple person drawn as a circle head and rounded shoulders in teal (#7FD1C8), holding a small card of tick and cross boxes, labelled "Tester". Stage three: a dark card labelled "Recorded" with three small rows: "git", "evidence", "audit log", and a gradient check mark badge above a pill labelled "UAT approved".
>
> Two faint concentric circles in the top right corner drawn in the blue-to-teal gradient at low opacity. Generous spacing, strong contrast, crisp edges, readable text, no clutter.

## Negative prompt (for models that take one)

Photograph, photorealistic, 3D render, glossy, gradients on text other than the one headline line, robots with faces, humanoid robots, stock-photo people, real faces, company logos, trademarks, watermarks, signatures, handwriting, extra words, misspelled text, garbled text, blurry text, low contrast, light background, neon glow, clip art, gears, cogs, wrenches.

## If the model garbles small text

Image models often misspell small labels. Use this fallback and add the words afterwards in a design tool or by writing an SVG, as with the other heroes:

> The same illustration with all text areas left blank: a dark card on the left holding a thin three-position track with a round gradient handle on the middle tick and one small amber marker above the left tick, a left-to-right flow of three empty stacked cards, a teal circle-and-shoulders person holding a card of empty tick boxes, and a dark card with three empty rows and a gradient check badge, thin gradient arrows between the stages, and a clear empty area at the top left for a headline. No lettering anywhere.

Then add the headline, subtitle and labels listed above in the fonts and colours from the style section.
