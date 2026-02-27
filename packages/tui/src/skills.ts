import * as p from "@clack/prompts";
import { discoverSkills, installSkills } from "./install-skills";

export async function manageSkills(): Promise<void> {
  const skills = discoverSkills();

  if (skills.length === 0) {
    p.log.warn("No skills found in skills/*/SKILL.md");
    return;
  }

  const selected = await p.multiselect({
    message: "Which skills to install?",
    options: skills.map((s) => ({
      value: s.dir,
      label: `/${s.name}`,
      hint: s.description,
    })),
    required: false,
  });

  if (p.isCancel(selected)) return;

  const selectedDirs = selected as string[];
  if (selectedDirs.length === 0) return;

  const installed = installSkills(selectedDirs, skills);
  p.log.success(
    `Installed ${installed.length} skill${installed.length === 1 ? "" : "s"}: ` +
      installed.join(", "),
  );
}
