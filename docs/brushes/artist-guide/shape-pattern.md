# Shape Pattern

**Preset:** `shape-fill`

**Role:** closed forms filled with structural mark systems

Shape Pattern fills a drawn region with hatching, triangulation, contours,
stipple, noise, Sierra texture, directional dashes, or flow lines. It is less
about “colouring in” than choosing what physical or conceptual rule lives
inside a silhouette.

## Shared controls

| Control | Effect and use |
| --- | --- |
| Strategy | Hatch, Delaunay, Contour, Stipple, Noise, Sierra, Dashes, or Flow. The strategy is the material logic of the form. |
| Sample | Pulls colour information from the canvas. Use it to make the pattern inherit local light and colour. |
| Background | Includes a background fill behind the generated marks. Off keeps the form porous. |
| Pixel perfect | Preserves crisp pixel placement. On is graphic; off can integrate more naturally with soft imagery. |
| Fill Lostedge | Weakens the generated strategy at the boundary so parts of the form merge with the surroundings. |
| Show Outline | Draws the enclosing silhouette. Use it when containment matters; hide it when the fill alone should imply the form. |
| Dither / Algorithm / Pattern | Adds a second spatial texture where supported. Avoid competing equally with the selected fill strategy. |
| Res / Pres Res / Max | Sets dither-cell size and optional pressure response. |
| Dither Lostedge | Fades the optional dither at its edge. This is a separate setting from the fill strategy's Lostedge control even though the UI uses the same label. |
| Smoosh | Smooths pressure-linked cell transitions where available. |

## Strategy controls

### Hatch

| Control | Range and meaning |
| --- | --- |
| Spacing | 1–200; distance between hatch lines. |
| Spacing Jitter | 0–1; irregularity in that interval. |
| Line Width | 0.25–6; visual weight of each hatch. |
| Segments | 1–24; breaks the hatch into shorter units. |
| Organic Wobble | 0–1; departs from mechanical straightness. |

Use Hatch for drawing, engraving, labour, shadow direction, or cloth. Keep its
angle and density related to the surface being described.

### Delaunay

| Control | Range and meaning |
| --- | --- |
| Spacing | 6–200; distance between triangulation points. |
| Jitter | 0–1; point-position irregularity. |
| Line Width | 0.2–6; triangle edge weight. |
| Variation | 0–1.5; variation across the triangulated field. |
| Seed | 0–999; reproduces a particular structure. |

Use Delaunay for fracture, mesh, networks, crystals, mapping, or a body reduced
to connected decisions.

### Contour

| Control | Range and meaning |
| --- | --- |
| Spacing | 2–400; interval between nested contours. |
| Variance | 0–1; irregularity between levels. |
| S Wobble | 0–1; organic deviation in contour shape. |
| Line Width | 0.2–6; weight of each contour. |

Use Contour for topology, growth rings, pressure, radiation, or repeated echoes
of a silhouette.

### Stipple

| Control | Range and meaning |
| --- | --- |
| Spacing | 2–200; average distance between dots. |
| Wobble | 0–1; placement irregularity. |
| Dot Scale | 0.5–5; size of each dot. |

Use Stipple for porous shadow, skin, dust, distance, or accumulated time.
Density should support value structure before surface interest.

### Noise

| Control | Range and meaning |
| --- | --- |
| Pixel Size | 0.1–4; base noise-cell scale. |
| White Bias | 0–1; balance toward light cells. |
| Speck Size | 0.2–4; scale of individual specks. |
| Organic Randomness | 0–1; departure from uniform noise. |
| Seed | 0–4096; reproduces an arrangement. |

Use Noise for static, decay, fog, contamination, signal loss, or nonhuman
surface. White Bias is a value control, not merely a texture control.

### Sierra

| Control | Range and meaning |
| --- | --- |
| Density | 0–1; amount of dithered material. |
| Resolution | 1–16; scale of the Sierra structure. |

Use Sierra for a direct print/digital tonal field. Its limited controls make it
good when the shape, rather than the generator, should remain dominant.

### Dashes

| Control | Range and meaning |
| --- | --- |
| Spacing | 2–200; distance between dashes. |
| Dash length | 2–200; base length of each mark. |
| Length jitter | 0–1; variation in dash length. |
| Dash Weight | 0.2–8; base line weight. |
| Weight jitter | 0–1; variation in dash weight. |
| Scatter | 0–120; displacement from the directional field. |
| Near falloff | 0.15–4; response near a field source. |
| Far falloff | 0.15–5; response farther from it. |
| Direction | 0–180°; dominant dash orientation. |
| Drift amount | 0–90°; angular deviation through the field. |
| Drift scale | 10–900; spatial scale of that directional drift. |
| Seed | 0–4096; reproduces the arrangement. |

Use Dashes for fur, rain, crowds, wind, handwriting-like fields, or forces
passing through a body. Direction and falloff should describe the force before
jitter decorates it.

### Flow

| Control | Range and meaning |
| --- | --- |
| Seed spacing | 4–200; density of starting points. |
| Step size | 0.25–20; distance advanced per flow calculation. |
| Max length | 10–600; longest generated path. |

Use Flow for currents, hair, magnetic fields, migration, water, or attention.
Fewer long lines reveal global movement; many short lines become texture.

## Painting with it

- Pick the strategy by what the form is made of or subjected to, not by which
  thumbnail looks most complex.
- Tune density at full-composition scale. A pattern that is beautiful while
  zoomed in may collapse into noise in the whole painting.
- Reuse a seed when the generated arrangement becomes an authored decision.
- Let Show Outline answer a compositional question: is this a contained object,
  or a field whose boundary the viewer must infer?

Avoid stacking high dither activity, high strategy variation, background fill,
and a heavy outline by default. Choose one dominant structure and make the
others support it.
