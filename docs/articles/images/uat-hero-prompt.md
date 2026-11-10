# Hero image prompt: A Person Tried It and Wrote Down What Happened

For article 43, `uat-long-form.md`. Give the prompt below to an image-generation model, save the result as `images/uat-hero.png` (the long-form already points at that path), 1200 x 630 px.

**Alt text:** A briefing, a numbered test procedure and an execution record flowing from an agent to a human tester and into a recorded, approved release.

## Style to match (the other DevAudit heroes)

- 1200 x 630 px (1.91:1), flat vector look, no photography, no 3D, no glossy effects.
- Background: deep navy gradient from `#0B1220` (top left) to `#141E33` (bottom right), with a faint square grid (`#1E293F`, 40 px cells, about 50% opacity).
- Accent: a blue-to-teal gradient from `#5B8DEF` to `#7FD1C8`. A secondary amber `#F5B642` used once, for the human tester marker.
- Text: headline `#F5F7FA` bold sans-serif (Helvetica Neue / Arial look); subtitle `#94A3B8`; small labels `#CBD5E1`. Eyebrow in `#7FD1C8`, letter-spaced capitals.
- Cards are dark rounded rectangles `#1E293F` with a thin `#334155` outline.
- Two faint concentric circles in the top right corner, drawn with the accent gradient at 25-35% opacity.

## Idea in one line

Three documents (briefing, procedure, record) travel left to right: written by an agent, completed by one human, ending in a stamped, recorded release.

## Prompt

> A clean, flat vector illustration for a software blog header, 1200 by 630 pixels, in a dark navy theme. Background: a smooth gradient from #0B1220 to #141E33 with a subtle square grid in #1E293F at half opacity. Top left, a small letter-spaced eyebrow in teal #7FD1C8 reading "DEVAUDIT.AI • UAT", with a short blue-to-teal gradient underline beneath it. Below it, a two-line bold white headline, "A person tried it." on the first line and "Then wrote it down." on the second, the second line filled with a blue (#5B8DEF) to teal (#7FD1C8) gradient. Under the headline, one line of grey (#94A3B8) subtitle text: "A briefing, a procedure and a record, kept with the release."
>
> Across the lower two thirds, a left-to-right flow in three stages joined by a thin gradient line with small arrowheads. Stage one, on the left: a small geometric agent icon (a rounded square with two dots, no face) above three stacked dark cards (#1E293F, thin #334155 outline) labelled "Briefing", "Procedure" and "Record", each with a few short light lines. A tiny label reads "written from the acceptance criteria". Stage two, in the middle: a simple human figure drawn as a circle head and rounded shoulders in amber (#F5B642), the only amber element, holding a card with a row of small tick and cross boxes, labelled "Tester". A tiny label reads "not the author". Stage three, on the right: a dark card labelled "Recorded" with three small rows: "git", "evidence", "audit log", and a gradient check mark badge above a pill labelled "UAT approved".
>
> Two faint concentric circles in the top right corner drawn in the blue-to-teal gradient at low opacity. Generous spacing, strong contrast, crisp edges, readable text, no clutter.

## Negative prompt (for models that take one)

Photograph, photorealistic, 3D render, glossy, gradients on text other than the one headline line, robots with faces, humanoid robots, stock-photo people, real faces, company logos, trademarks, watermarks, signatures, handwriting, extra words, misspelled text, garbled text, blurry text, low contrast, light background, neon glow, clip art, gears, cogs, wrenches.

## If the model garbles small text

Image models often misspell small labels. Use this fallback and add the words afterwards in a design tool or by writing an SVG, as with the other heroes:

> The same illustration with all text areas left blank: a small agent icon above three stacked empty dark cards on the left, an amber circle-and-shoulders human figure holding a card of empty tick boxes in the middle, a dark card with three empty rows and a gradient check badge on the right, thin gradient arrows between the three stages, and a clear empty area at the top left for a headline. No lettering anywhere.

Then add the headline, subtitle and labels listed above in the fonts and colours from the style section.
