# Vessel & Goblet

I made Vessel because I wanted a drawing app that behaved like my own brain.

Most tools make me choose. Pixel art over here. Painting over there. Animation somewhere else. Export as a final flattening step.

I wanted those things in one surface. I wanted them to be native.

`[VIDEO: quick montage of Vessel editing and Goblet playback]`

## The Editor And The Player

Vessel and Goblet are two parts of the same system.

Vessel is the authoring environment: brushes, layers, shapes, dithering, color cycling, export. Goblet is the runtime and player, where the exported image state runs.

Export is not flattening. It is state transfer. The animation, timing, dithering, and playback remain intact.

`[VIDEO: Vessel editing, export handoff, Goblet playback]`

## Low Resolution Meets High Resolution

I had never really used an app that mixed low-resolution pixel artwork with high-resolution brushes in the way I wanted.

That tension is the point. The pixel grid gives the image its bones. The brush gives it touch. I wanted marks that felt physical but still resolved into a low-resolution image structure.

Pressure is the key. It changes resolution while drawing, so coarse and fine marks stop being separate modes. They become one act of drawing.

`[VIDEO: pressure changing resolution inside and around a shape]`

## Shape Making

Shape-making is how I see the world. I break things down into masses, then give those masses tone and texture.

In Vessel, shapes are not just selections. They are drawable, fillable, animatable, maskable image structures.

I make the shape first. Once it is finished, I can use pressure to increase or decrease the dithering resolution of the fill. The fill is not just poured in. I can push it coarse or fine with the same physical logic as drawing.

Dithering is not a texture I add at the end. It decides how tone breaks, how color argues with itself, how a fill becomes alive.

`[VIDEO: drawing a shape, then using pressure to change the dither fill resolution]`

## Color Cycling

Color cycling pushes a range of colors from a palette through the same pixel. The pixel does not move, but the color changes make it feel like something is moving.

That is the trick: movement without moving geometry. It lets the image move without becoming a normal video timeline.

Strokes can color cycle. Shapes can color cycle. Either one can be flat or dithered. The animation can move inward through the shape, or along the stroke.

The motion is not just color sliding around. It is palette, structure, texture, state, and timing working together.

`[VIDEO: stroke color cycling, shape color cycling, flat vs dithered, inset vs along-stroke animation]`

## Conclusion

Vessel is where I build the image. Goblet is where the image keeps running.

The project is not a general-purpose drawing app, and it is not a retro filter. It is a system for making animated low-resolution image states. In those images, brushwork, dithering, palette motion, shape fills, pressure, timing, and playback all belong to the image itself.

`[VIDEO: final Goblet output, no UI]`
