import * as p from "@clack/prompts";
import { discoverSkills, getInstalledSkills, installSkills } from "./install-skills";

export async function manageSkills(): Promise<void> {
  const skills = discoverSkills();

  if (skills.length === 0) {
    p.log.warn("No skills found in skills/*/SKILL.md");
    return;
  }

  const alreadyInstalled = getInstalledSkills(skills);
  const allInstalled = skills.every((s) => alreadyInstalled.has(s.dir));

  if (allInstalled) {
    p.log.success(`All ${skills.length} skills are already installed.`);
    return;
  }

  const notInstalledCount = skills.filter((s) => !alreadyInstalled.has(s.dir)).length;

  const selected = await p.multiselect({
    message: `Which skills to install? (${notInstalledCount} new available)`,
    options: skills.map((s) => ({
      value: s.dir,
      label: alreadyInstalled.has(s.dir) ? `/${s.name} (installed)` : `/${s.name}`,
      hint: s.description,
    })),
    initialValues: [...alreadyInstalled],
    required: false,
  });

  if (p.isCancel(selected)) return;

  const selectedDirs = selected as string[];
  if (selectedDirs.length === 0) return;

  // Only install skills that aren't already installed (or re-install if user wants)
  const installed = installSkills(selectedDirs, skills);
  const newCount = installed.filter((s) => {
    const skillName = s.slice(1); // remove leading /
    const skill = skills.find((sk) => sk.name === skillName);
    return skill && !alreadyInstalled.has(skill.dir);
  }).length;

  if (newCount > 0) {
    p.log.success(
      `Installed ${newCount} new skill${newCount === 1 ? "" : "s"}: ` +
        installed.filter((s) => {
          const skillName = s.slice(1);
          const skill = skills.find((sk) => sk.name === skillName);
          return skill && !alreadyInstalled.has(skill.dir);
        }).join(", "),
    );
  } else {
    p.log.info("All selected skills were already installed.");
  }
}
