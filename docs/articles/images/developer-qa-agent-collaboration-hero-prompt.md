# Hero image prompt: Humans Decide, the Agent Does the Work

For article 41, `developer-qa-agent-collaboration-long-form.md`. Give the prompt below to an image-generation model, save the result as `images/developer-qa-agent-collaboration-hero.png` (the long-form already points at that path), 1200 x 630 px.

**Alt text:** A developer and a QA reviewer holding the decision points of a five-stage lifecycle while a coding agent carries the plan, code, tests and evidence between them.

## Style to match (the other DevAudit heroes)

- 1200 x 630 px (1.91:1), flat vector look, no photography, no 3D, no glossy effects.
- Background: deep navy gradient from `#0B1220` (top left) to `#141E33` (bottom right), with a faint square grid (`#1E293F`, 40 px cells, about 50% opacity).
- Accent: a blue-to-teal gradient from `#5B8DEF` to `#7FD1C8`. A secondary amber `#F5B642` used once, for the human decision marks.
- Text: headline `#F5F7FA` bold sans-serif (Helvetica Neue / Arial look); subtitle `#94A3B8`; small labels `#CBD5E1`. Eyebrow in `#7FD1C8`, letter-spaced capitals.
- Cards are dark rounded rectangles `#1E293F` with a thin `#334155` outline.
- Two faint concentric circles in the top right corner, drawn with the accent gradient at 25-35% opacity.

## Prompt

> A clean, flat vector illustration for a software blog header, 1200 by 630 pixels, in a dark navy theme. Background: a smooth gradient from #0B1220 to #141E33 with a subtle square grid in #1E293F at half opacity. Top left, a small letter-spaced eyebrow in teal #7FD1C8 reading "DEVAUDIT.AI • THE SDLC", with a short blue-to-teal gradient underline beneath it. Below it, a two-line bold white headline, "Humans decide." on the first line and "The agent does the work." on the second, the second line filled with a blue (#5B8DEF) to teal (#7FD1C8) gradient. Under the headline, one line of grey (#94A3B8) subtitle text: "You and your QA own every decision. The coding agent writes the plan, code, tests and evidence."
>
> Across the lower two thirds of the image, a horizontal five-stage track made of five rounded dark cards (#1E293F with a thin #334155 outline) joined by a thin gradient line, labelled in small white text: "Plan", "Implement", "Evidence", "Review", "Release". Each card carries a small filled gradient (blue to teal) chip along its bottom edge to show the coding agent's work: "plan + code", "tests", "artefacts", "release PR", "merge + verify". Between the cards, four small amber (#F5B642) diamond-shaped gate markers sit on the line, each labelled in tiny light text: "confirm the path", "approve high-risk plan", "UAT sign-off", "approve production". Two minimal, faceless, abstract human avatars drawn as simple geometric circle-and-shoulders icons, one labelled "Developer" and one "QA", sit above the track with thin amber lines pointing down to the gate markers. A small abstract geometric node icon labelled "Coding agent" sits below the track with thin teal lines to the five chips. Two faint concentric circles in the top right corner drawn in the blue-to-teal gradient at low opacity. Generous spacing, strong contrast, crisp edges, readable text, no clutter.

## Negative prompt (for models that take one)

Photograph, photorealistic, 3D render, glossy, gradients on text other than the one headline line, robots with faces, humanoid robots, stock-photo people, real faces, company logos, trademarks, watermarks, signatures, handwriting, extra words, misspelled text, garbled text, blurry text, low contrast, light background, neon glow, clip art.

## If the model garbles small text

Image models often misspell small labels. Use this fallback and add the words afterwards in a design tool or by writing an SVG, as with the other heroes:

> The same illustration with all text areas left blank: dark rounded cards, amber diamond gate markers, two faceless geometric avatars above the track and one geometric node icon below it, joined by thin teal and amber lines, and a clear empty area at the top left for a headline. No lettering anywhere.

Then add the headline, subtitle and labels listed above in the fonts and colours from the style section.
