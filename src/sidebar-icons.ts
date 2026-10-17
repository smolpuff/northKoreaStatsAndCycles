import { navigationShapes, duotoneNavigationShapes } from "./fontawesome-navigation";
import { iconPalette } from "./icon-palette";

// Native Pro duotone layers where supplied; free icons use matching separately shaded parts.
export function sidebarArtwork(name: string, id: string): string {
  const prefix = `navigation-${id}`;
  const path = (d: string, shade: string) => `<path style="fill:url(#${prefix}-${shade})" d="${d}"/>`;
  const aliases: Record<string, string> = {
    home: "house", overview: "ranking-star", stats: "ranking-star",
    racecycles: "repeat", history: "clock-rotate-left", overlays: "layer-group",
    lumia: "layer-group", twitch: "twitch", logs: "file-lines", settings: "gear",
  };
  const shape = navigationShapes[aliases[name] ?? "house"];
  let viewBox = shape.viewBox;
  let artwork = path(shape.path, "secondary");
  let clips = "";
  const part = (region: string, shade: string, key: string) => {
    clips += `<clipPath id="${prefix}-${key}">${region}</clipPath>`;
    return `<g clip-path="url(#${prefix}-${key})">${path(shape.path, shade)}</g>`;
  };
  const rect = (x: number, y: number, width: number, height: number) =>
    `<rect x="${x}" y="${y}" width="${width}" height="${height}"/>`;
  switch (name) {
    case "streamdeck":
      viewBox = "0 0 256 256";
      artwork = path("M32 32h192a16 16 0 0 1 16 16v144a16 16 0 0 1-16 16H32a16 16 0 0 1-16-16V48a16 16 0 0 1 16-16Z", "secondary") +
        path("M48 64h32v32H48Zm64 0h32v32h-32Zm64 0h32v32h-32ZM48 128h32v32H48Zm64 0h32v32h-32Zm64 0h32v32h-32Z", "primary") +
        path("M80 224h96v16H80Z", "cool");
      break;
    case "discord":
      viewBox = "0 0 256 256";
      artwork = path("M58 48c22-10 42-14 58-15l6 13h12l6-13c16 1 36 5 58 15 28 40 40 82 42 130-24 21-46 30-68 35l-13-20c10-3 19-7 27-12-37 15-79 15-116 0 8 5 17 9 27 12l-13 20c-22-5-44-14-68-35 2-48 14-90 42-130Z", "primary") +
        path("M140 33c16 1 36 5 58 15 28 40 40 82 42 130-24 21-46 30-68 35l-13-20c10-3 19-7 27-12-19 8-38 11-58 11V46h6Z", "cool") +
        path("M83 106a17 21 0 1 0 0 42 17 21 0 1 0 0-42Zm90 0a17 21 0 1 0 0 42 17 21 0 1 0 0-42Z", "secondary");
      break;
    case "lumia":
      // Broad bulb facets stay legible at sidebar size; use the same gradients as the other icons.
      viewBox = "0 0 256 256";
      artwork = path("M128 12C77 12 40 48 40 96c0 33 18 55 36 77 9 11 14 20 15 31h74c1-11 6-20 15-31 18-22 36-44 36-77 0-48-37-84-88-84Z", "primary") +
        path("M128 12c51 0 88 36 88 84 0 33-18 55-36 77-9 11-14 20-15 31h-37v-47c28-27 43-44 43-65 0-29-16-52-43-80Z", "secondary") +
        path("M91 210h74v12H91Zm8 18h58v5c0 12-13 19-29 19s-29-7-29-19Z", "cool") +
        path("M128 55c-24 0-42 17-42 40 0 17 8 31 20 31 14 0 22-15 22-33a8 8 0 0 0-16 0c0 14-4 17-6 17-3 0-4-9-4-15 0-14 10-24 26-24s26 10 26 25c0 15-13 31-29 49-13 16-24 31-26 45h17c2-10 10-22 22-35 18-21 32-39 32-59 0-24-17-41-42-41Z", "bright");
      break;
    case "twitch":
      artwork += part(rect(225, 90, 185, 130), "bright", "eyes") +
        part('<path d="M24 0H140V421H24Z"/>', "primary", "side");
      break;
    case "home":
      // Glass marble with an inset star and reflected glint.
      viewBox = "0 0 640 640";
      artwork = path("M320 64a256 256 0 1 1 0 512 256 256 0 0 1 0-512Z", "marble-shell") +
        path("M320 170 356 267 459 275 379 342 406 442 320 382 234 442 261 342 181 275 284 267Z", "marble-star") +
        path("M155 224C174 178 210 143 253 126C266 121 278 131 278 143C278 151 273 158 266 161C228 176 200 204 184 241C179 252 166 255 157 246C152 240 152 231 155 224ZM131 281a16 16 0 1 1 32 0 16 16 0 0 1-32 0Z", "marble-glint");
      break;
    case "logs":
      artwork += part(rect(224, 0, 160, 160), "primary", "fold");
      artwork += path("M112 256h160a16 16 0 0 1 0 32H112a16 16 0 0 1 0-32Zm0 64h160a16 16 0 0 1 0 32H112a16 16 0 0 1 0-32Zm0 64h160a16 16 0 0 1 0 32H112a16 16 0 0 1 0-32Z", "bright");
      break;
    case "settings":
      artwork += part('<path d="M0 0H512L256 256Z"/>', "primary", "top") +
        part('<path d="M512 0V512H256V256Z"/>', "cool", "right");
      break;

  }
  const duotone = duotoneNavigationShapes[name === "stats" ? "overview" : name];
  if (duotone) {
    viewBox = duotone.viewBox;
    clips = "";
    artwork = duotone.layers.map(layer => path(layer.path,
      name === "overlays" ? (layer.secondary ? "secondary" : "primary") :
        (layer.secondary ? "primary" : "secondary"),
    )).join("");
    const blueParts: Record<string, string> = {
      overview: rect(440, 440, 200, 160), stats: rect(440, 440, 200, 160),
      racecycles: rect(415, 64, 160, 193),
      history: rect(48, 112, 177, 177),
      overlays: rect(0, 400, 640, 240),
      streamer: '<path d="M0 240H97V320H0ZM543 240H640V320H543Z"/>',
    };
    if (blueParts[name]) {
      clips = `<clipPath id="${prefix}-blue-part">${blueParts[name]}</clipPath>`;
      artwork += `<g clip-path="url(#${prefix}-blue-part)">${duotone.layers.map(layer => path(layer.path, "cool")).join("")}</g>`;
    }
  }
  const gradients = [
    ["primary", ...iconPalette.primary, "0", "0", "1", "1"],
    ["secondary", ...iconPalette.secondary, "0", "0", "0.3", "1"],
    ["cool", ...iconPalette.cool, "1", "0", "0", "1"],
    ["bright", ...iconPalette.bright, "0", "0", "1", "1"],
    ...(name === "home" ? [
      ["marble-shell", "#ff78bd", "#d92a83", "0", "0", "1", "1"],
      ["marble-star", "#ffe17a", "#f5a12b", "0", "0", "0.7", "1"],
      ["marble-glint", "#d6f5ff", "#88cce9", "0", "0", "0.7", "1"],
    ] : []),
  ].map(([key, start, end, x1, y1, x2, y2]) =>
    `<linearGradient id="${prefix}-${key}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient>`,
  ).join("");
  return `<svg class="sidebar-artwork" viewBox="${viewBox}" aria-hidden="true" style="fill:none"><defs>${gradients}${clips}</defs>${artwork}</svg>`;
}
