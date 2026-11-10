# Hero image prompt: One Process, Many Shapes

For article 42, `configurable-sdlc-long-form.md`. Give the prompt below to an image-generation model, save the result as `images/configurable-sdlc-hero.png` (the long-form already points at that path), 1200 x 630 px.

**Alt text:** Four adjustable settings (who approves, what blocks, where it runs, which standards) around a fixed audit shape that does not change, with four presets along the bottom.

## Style to match (the other DevAudit heroes)

- 1200 x 630 px (1.91:1), flat vector look, no photography, no 3D, no glossy effects.
- Background: deep navy gradient from `#0B1220` (top left) to `#141E33` (bottom right), with a faint square grid (`#1E293F`, 40 px cells, about 50% opacity).
- Accent: a blue-to-teal gradient from `#5B8DEF` to `#7FD1C8`. A secondary amber `#F5B642` used once, for the recorded-gap marker.
- Text: headline `#F5F7FA` bold sans-serif (Helvetica Neue / Arial look); subtitle `#94A3B8`; small labels `#CBD5E1`. Eyebrow in `#7FD1C8`, letter-spaced capitals.
- Cards are dark rounded rectangles `#1E293F` with a thin `#334155` outline.
- Two faint concentric circles in the top right corner, drawn with the accent gradient at 25-35% opacity.

## Idea in one line

Four things you can adjust (drawn as sliders and chips) on the right, one thing you cannot (a fixed, locked card) on the left, and four presets as a row of chips along the bottom.

## Prompt

> A clean, flat vector illustration for a software blog header, 1200 by 630 pixels, in a dark navy theme. Background: a smooth gradient from #0B1220 to #141E33 with a subtle square grid in #1E293F at half opacity. Top left, a small letter-spaced eyebrow in teal #7FD1C8 reading "DEVAUDIT.AI • THE SDLC", with a short blue-to-teal gradient underline beneath it. Below it, a two-line bold white headline, "One process." on the first line and "Many shapes." on the second, the second line filled with a blue (#5B8DEF) to teal (#7FD1C8) gradient. Under the headline, one line of grey (#94A3B8) subtitle text: "Choose who approves, what blocks and where it runs. The evidence format never changes."
>
> Left column, below the subtitle: one rounded dark card (#1E293F with a thin #334155 outline) that looks fixed and locked. A small geometric padlock icon in the blue-to-teal gradient sits at its top, and a small label reads "The audit shape". Three tiny light lines inside the card read "37 evidence types", "5 standards", "Approval gate: always on". The card has no sliders and no handles; it is visibly still.
>
> Right column: four stacked rounded dark cards, each holding one adjustable control drawn as a thin track with a round gradient handle. Card one is labelled "Who approves": a track with the ends "Author" and "Different person", the handle near the middle, and one small amber (#F5B642) marker above the "Author" end labelled "gap recorded". Card two is labelled "What blocks": a track with three tick marks labelled "Smoke", "Critical", "Full". Card three is labelled "Where it runs": three small rounded chips labelled "Railway", "Vercel", "Custom". Card four is labelled "Which standards": five small rounded chips labelled "SOC 2", "ISO 27001", "ISO 29119", "GDPR", "EU AI Act". Thin teal lines run from each of the four cards toward the fixed card on the left and stop just short of it, to show that the settings surround the audit shape without changing it.
>
> Along the bottom edge, a row of four small round preset chips labelled "A", "B", "C", "D", and a fifth outlined chip labelled "custom", joined by a thin gradient line, with a tiny light caption above them reading "start from a preset". Two faint concentric circles in the top right corner drawn in the blue-to-teal gradient at low opacity. Generous spacing, strong contrast, crisp edges, readable text, no clutter.

## Negative prompt (for models that take one)

Photograph, photorealistic, 3D render, glossy, gradients on text other than the one headline line, robots with faces, humanoid robots, stock-photo people, real faces, company logos, trademarks, watermarks, signatures, handwriting, extra words, misspelled text, garbled text, blurry text, low contrast, light background, neon glow, clip art, gears, cogs, wrenches.

## If the model garbles small text

Image models often misspell small labels. Use this fallback and add the words afterwards in a design tool or by writing an SVG, as with the other heroes:

> The same illustration with all text areas left blank: a fixed dark card with a padlock icon on the left, four dark cards on the right holding thin tracks with round gradient handles and rounded empty chips, one small amber marker above the left end of the first track, a row of five empty round chips along the bottom, thin teal lines from the right-hand cards toward the left card, and a clear empty area at the top left for a headline. No lettering anywhere.

Then add the headline, subtitle and labels listed above in the fonts and colours from the style section.
