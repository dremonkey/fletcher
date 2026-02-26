#!/usr/bin/env bun
// Interactive skill installer for Claude Code.
// Scans skills/*/SKILL.md, presents a multi-select menu,
// and symlinks selected skills into .claude/commands/.
//
// Usage: bun run skills:install

import * as p from "@clack/prompts";
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, unlinkSync, lstatSync } from "fs";
import { join, relative } from "path";

const ROOT = join(import.meta.dirname, "..");
const SKILLS_DIR = join(ROOT, "skills");
const COMMANDS_DIR = join(ROOT, ".claude", "commands");

interface Skill {
  name: string;
  dir: string;
  path: string;
  description: string;
}

function discoverSkills(): Skill[] {
  if (!existsSync(SKILLS_DIR)) return [];

  const entries = readdirSync(SKILLS_DIR, { withFileTypes: true });
  const skills: Skill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(SKILLS_DIR, entry.name, "SKILL.md");
    if (!existsSync(skillPath)) continue;

    const content = readFileSync(skillPath, "utf-8");
    const lines = content.split("\n");

    // Parse heading: "# /skill-name"
    const heading = lines[0]?.trim() ?? "";
    const nameMatch = heading.match(/^#\s+\/(.+)/);
    const name = nameMatch ? nameMatch[1] : entry.name;

    // Parse description: first non-empty line after heading
    let description = "";
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line) {
        description = line;
        break;
      }
    }

    skills.push({ name, dir: entry.name, path: skillPath, description });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

function cancelled(): never {
  p.cancel("Cancelled.");
  process.exit(0);
}

// ── Main ─────────────────────────────────────────────────────────────

p.intro("Claude Code Skills Installer");

const skills = discoverSkills();

if (skills.length === 0) {
  p.log.warn("No skills found in skills/*/SKILL.md");
  p.outro("Nothing to install.");
  process.exit(0);
}

const selected = await p.multiselect({
  message: "Which skills would you like to install?",
  options: skills.map((s) => ({
    value: s.dir,
    label: `/${s.name}`,
    hint: s.description,
  })),
  required: false,
});

if (p.isCancel(selected)) cancelled();

const selectedDirs = selected as string[];

if (selectedDirs.length === 0) {
  p.outro("No skills selected.");
  process.exit(0);
}

// Ensure .claude/commands/ exists
mkdirSync(COMMANDS_DIR, { recursive: true });

const installed: string[] = [];

for (const dir of selectedDirs) {
  const skill = skills.find((s) => s.dir === dir)!;
  const linkPath = join(COMMANDS_DIR, `${dir}.md`);
  const targetPath = relative(COMMANDS_DIR, skill.path);

  // Remove existing symlink/file if present
  if (existsSync(linkPath)) {
    try {
      unlinkSync(linkPath);
    } catch {}
  }

  symlinkSync(targetPath, linkPath);
  installed.push(`/${skill.name}`);
}

p.log.success(
  `Installed ${installed.length} skill${installed.length === 1 ? "" : "s"}:\n` +
    installed.map((s) => `  ${s}`).join("\n"),
);

p.outro("Skills are ready. Use them in Claude Code with their trigger commands.");
