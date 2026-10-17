import paper from "paper";

// Stream Deck's SVG renderer ignores clipPath. Resolve the sidebar's clipped
// layers to ordinary vector paths at packaging time, without rasterizing them.
export function streamDeckArtwork(svg) {
  paper.setup(new paper.Size(640, 640));
  const attribute = (source, name) => source.match(new RegExp(`${name}="([^"]+)"`))?.[1];
  const clips = new Map();
  svg = svg.replace(/<clipPath id="([^"]+)">([\s\S]*?)<\/clipPath>/g, (_, id, region) => {
    let clip;
    if (region.startsWith("<rect")) {
      clip = new paper.Path.Rectangle(new paper.Rectangle(...["x", "y", "width", "height"].map(key => Number(attribute(region, key)))));
    } else {
      clip = new paper.CompoundPath(attribute(region, "d"));
    }
    clips.set(id, clip);
    return "";
  });
  let serial = 0;
  const definitions = [];
  svg = svg.replace(/<g clip-path="url\(#([^)]+)\)">([\s\S]*?)<\/g>/g, (_, id, content) => {
    const clip = clips.get(id);
    if (!clip) throw new Error(`Unknown sidebar clip: ${id}`);
    return content.replace(/<path\b[^>]*\/>/g, element => {
      const original = new paper.CompoundPath(attribute(element, "d"));
      const intersection = original.intersect(clip, { insert: false });
      if (intersection.isEmpty()) return "";
      const gradientId = element.match(/fill:(?:url\(#)([^)]+)/)?.[1];
      const gradient = svg.match(new RegExp(`<linearGradient id="${gradientId}"[^>]*>[\\s\\S]*?<\\/linearGradient>`))?.[0];
      if (!gradient) throw new Error(`Unknown sidebar gradient: ${gradientId}`);
      const bounds = original.bounds;
      const newId = `${gradientId}-resolved-${serial++}`;
      let resolved = gradient.replace(`id="${gradientId}"`, `id="${newId}" gradientUnits="userSpaceOnUse"`);
      for (const [coordinate, origin, extent] of [["x1", bounds.x, bounds.width], ["x2", bounds.x, bounds.width], ["y1", bounds.y, bounds.height], ["y2", bounds.y, bounds.height]]) {
        resolved = resolved.replace(new RegExp(`${coordinate}="([^"]+)"`), (_, value) => `${coordinate}="${origin + Number(value) * extent}"`);
      }
      definitions.push(resolved);
      return `<path fill="url(#${newId})" d="${intersection.pathData}"/>`;
    });
  });
  svg = svg.replace("</defs>", `${definitions.join("")}</defs>`).replace(/style="fill:([^"]+)"/g, 'fill="$1"');
  paper.project.remove();
  return svg;
}
