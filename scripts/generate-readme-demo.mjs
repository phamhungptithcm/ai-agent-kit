import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const output = path.join(repositoryRoot, "docs", "assets", "bootstrap-demo.gif");
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ai-agent-kit-readme-demo-"));
const demoRepository = path.join(workspace, "demo-project");
const framesDirectory = path.join(workspace, "frames");
const WIDTH = 1200;
const HEIGHT = 675;
const SCALE = 3;
const GLYPHS = {
  " ": ["00000","00000","00000","00000","00000","00000","00000"],
  "?": ["01110","10001","00001","00110","00100","00000","00100"],
  "A": ["01110","10001","10001","11111","10001","10001","10001"],
  "B": ["11110","10001","10001","11110","10001","10001","11110"],
  "C": ["01111","10000","10000","10000","10000","10000","01111"],
  "D": ["11110","10001","10001","10001","10001","10001","11110"],
  "E": ["11111","10000","10000","11110","10000","10000","11111"],
  "F": ["11111","10000","10000","11110","10000","10000","10000"],
  "G": ["01111","10000","10000","10111","10001","10001","01111"],
  "H": ["10001","10001","10001","11111","10001","10001","10001"],
  "I": ["11111","00100","00100","00100","00100","00100","11111"],
  "J": ["00111","00010","00010","00010","10010","10010","01100"],
  "K": ["10001","10010","10100","11000","10100","10010","10001"],
  "L": ["10000","10000","10000","10000","10000","10000","11111"],
  "M": ["10001","11011","10101","10101","10001","10001","10001"],
  "N": ["10001","11001","10101","10011","10001","10001","10001"],
  "O": ["01110","10001","10001","10001","10001","10001","01110"],
  "P": ["11110","10001","10001","11110","10000","10000","10000"],
  "Q": ["01110","10001","10001","10001","10101","10010","01101"],
  "R": ["11110","10001","10001","11110","10100","10010","10001"],
  "S": ["01111","10000","10000","01110","00001","00001","11110"],
  "T": ["11111","00100","00100","00100","00100","00100","00100"],
  "U": ["10001","10001","10001","10001","10001","10001","01110"],
  "V": ["10001","10001","10001","10001","10001","01010","00100"],
  "W": ["10001","10001","10001","10101","10101","10101","01010"],
  "X": ["10001","10001","01010","00100","01010","10001","10001"],
  "Y": ["10001","10001","01010","00100","00100","00100","00100"],
  "Z": ["11111","00001","00010","00100","01000","10000","11111"],
  "0": ["01110","10001","10011","10101","11001","10001","01110"],
  "1": ["00100","01100","00100","00100","00100","00100","01110"],
  "2": ["01110","10001","00001","00010","00100","01000","11111"],
  "3": ["11110","00001","00001","01110","00001","00001","11110"],
  "4": ["00010","00110","01010","10010","11111","00010","00010"],
  "5": ["11111","10000","10000","11110","00001","00001","11110"],
  "6": ["01110","10000","10000","11110","10001","10001","01110"],
  "7": ["11111","00001","00010","00100","01000","01000","01000"],
  "8": ["01110","10001","10001","01110","10001","10001","01110"],
  "9": ["01110","10001","10001","01111","00001","00001","01110"],
  ".": ["00000","00000","00000","00000","00000","00110","00110"],
  ":": ["00000","00110","00110","00000","00110","00110","00000"],
  "/": ["00001","00010","00010","00100","01000","01000","10000"],
  "\\": ["10000","01000","01000","00100","00010","00010","00001"],
  "-": ["00000","00000","00000","11111","00000","00000","00000"],
  "_": ["00000","00000","00000","00000","00000","00000","11111"],
  "+": ["00000","00100","00100","11111","00100","00100","00000"],
  "=": ["00000","00000","11111","00000","11111","00000","00000"],
  ">": ["10000","01000","00100","00010","00100","01000","10000"],
  "$": ["00100","01111","10100","01110","00101","11110","00100"],
  "@": ["01110","10001","10111","10101","10111","10000","01110"],
  "'": ["00100","00100","00000","00000","00000","00000","00000"]
};

fs.mkdirSync(demoRepository, { recursive: true });
fs.mkdirSync(framesDirectory, { recursive: true });

function run(command, args, cwd = repositoryRoot) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return `${result.stdout}${result.stderr}`.replaceAll(demoRepository, "/demo/project");
}

run("git", ["init", "-q"], demoRepository);
run("git", ["config", "user.email", "demo@example.invalid"], demoRepository);
run("git", ["config", "user.name", "AI Agent Kit Demo"], demoRepository);
fs.writeFileSync(
  path.join(demoRepository, "package.json"),
  `${JSON.stringify({ name: "demo-project", private: true, scripts: { test: "node --test" } }, null, 2)}\n`
);
fs.writeFileSync(path.join(demoRepository, "README.md"), "# Demo Project\n");
run("git", ["add", "package.json", "README.md"], demoRepository);
run("git", ["commit", "-q", "-m", "chore: initialize demo"], demoRepository);

const cli = path.join(repositoryRoot, "dist", "bin", "ai-agent-kit.mjs");
const dryRun = run("node", [cli, "bootstrap", "--dry-run", "--target", demoRepository]);
const bootstrap = run("node", [cli, "bootstrap", "--target", demoRepository]);
const doctor = run("node", [cli, "doctor", "--target", demoRepository]);

function selectedLines(text, patterns, limit = 12) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => patterns.some((pattern) => pattern.test(line)))
    .slice(0, limit);
}

const dryRunLines = selectedLines(dryRun, [
  /AI Agent Kit Bootstrap/,
  /^Repository:/,
  /^Preset:/,
  /^Detected profile:/,
  /^No files were modified/,
  /^No Git operations/
]);
const bootstrapLines = selectedLines(bootstrap, [
  /AI Agent Kit Bootstrap/,
  /^Repository:/,
  /^Preset:/,
  /^Configuration:/,
  /^CodeGraph:/,
  /^CocoIndex:/,
  /source code was modified/,
  /Git operations/
]);
const doctorLines = selectedLines(doctor, [
  /AI Agent Kit Doctor/,
  /^Repository:/,
  /^CORE_/,
  /^GOVERNED_/,
  /^CodeGraph:/,
  /^CocoIndex:/,
  /^Next action:/
]);

const installed = [
  ".ai/",
  ".claude/",
  ".codex/",
  ".agents/",
  "AGENTS.md",
  "CLAUDE.md",
  "AI_AGENT_TEAM_GUIDE.md"
].filter((entry) => fs.existsSync(path.join(demoRepository, entry.replace(/\/$/, ""))));

const frames = [
  [
    "AI AGENT KIT 0.4.0",
    "",
    "$ npx @hunpeolabs/ai-agent-kit@0.4.0 bootstrap --dry-run",
    "",
    "Preview the governed repository contract before writing."
  ],
  [
    "$ bootstrap --dry-run",
    "",
    ...dryRunLines,
    "",
    "✓ Preview only"
  ],
  [
    "$ bootstrap --preset governed",
    "",
    ...bootstrapLines,
    "",
    "✓ Application source remains unchanged"
  ],
  [
    "$ generated contract",
    "",
    ...installed.map((entry) => `✓ ${entry}`),
    "",
    "Rules · profiles · skills · prompts · templates · guards"
  ],
  [
    "$ ai-agent-kit doctor",
    "",
    ...doctorLines,
    "",
    "Readiness is explicit. Missing tools fail closed."
  ],
  [
    "ONE REPOSITORY. ONE ENGINEERING CONTRACT.",
    "",
    "Claude Code + OpenAI Codex",
    "Repository intelligence",
    "Approval boundaries",
    "Reviewable evidence",
    "",
    "github.com/phamhungptithcm/ai-agent-kit"
  ]
];

function fill(image, x, y, width, height, color) {
  for (let row = Math.max(0, y); row < Math.min(HEIGHT, y + height); row += 1) {
    for (let column = Math.max(0, x); column < Math.min(WIDTH, x + width); column += 1) {
      const offset = (row * WIDTH + column) * 3;
      image[offset] = color[0];
      image[offset + 1] = color[1];
      image[offset + 2] = color[2];
    }
  }
}

function drawText(image, value, x, y, color) {
  let cursor = x;
  const normalized = value.toUpperCase().replaceAll("✓", "+").replaceAll("·", "+").slice(0, 62);
  for (const character of normalized) {
    const glyph = GLYPHS[character] ?? GLYPHS["?"];
    glyph.forEach((row, rowIndex) => {
      [...row].forEach((pixel, columnIndex) => {
        if (pixel === "1") fill(image, cursor + columnIndex * SCALE, y + rowIndex * SCALE, SCALE, SCALE, color);
      });
    });
    cursor += 6 * SCALE;
  }
}

function renderFrame(lines, index) {
  const imageFile = path.join(framesDirectory, `frame-${String(index).padStart(2, "0")}.ppm`);
  const image = Buffer.alloc(WIDTH * HEIGHT * 3);
  fill(image, 0, 0, WIDTH, HEIGHT, [11, 16, 32]);
  fill(image, 28, 28, WIDTH - 56, HEIGHT - 56, [17, 24, 43]);
  fill(image, 28, 28, WIDTH - 56, 5, [41, 52, 81]);
  lines.slice(0, 17).forEach((line, lineIndex) => {
    const color = line.startsWith("$")
      ? [121, 192, 255]
      : line.startsWith("+")
        ? [74, 222, 128]
        : lineIndex === 0
          ? [196, 181, 253]
          : [215, 224, 242];
    drawText(image, line, 58, 58 + lineIndex * 34, color);
  });
  fs.writeFileSync(imageFile, Buffer.concat([Buffer.from(`P6\n${WIDTH} ${HEIGHT}\n255\n`), image]));
  return imageFile;
}

const images = frames.map(renderFrame);
const concatFile = path.join(workspace, "frames.txt");
fs.writeFileSync(
  concatFile,
  `${images.map((image) => `file '${image}'\nduration 2.2`).join("\n")}\nfile '${images.at(-1)}'\nduration 3\n`
);
fs.mkdirSync(path.dirname(output), { recursive: true });
run("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  concatFile,
  "-vf",
  "fps=10,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer",
  "-loop",
  "0",
  "-y",
  output
]);

console.log(`README demo generated from real bootstrap output: ${output}`);
