import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve("unreal/FestivusAcademy");
const requiredFiles = [
  "FestivusAcademy.uproject",
  "Config/DefaultEngine.ini",
  "Config/DefaultGame.ini",
  "Source/FestivusAcademy.Target.cs",
  "Source/FestivusAcademyEditor.Target.cs",
  "Source/FestivusAcademy/FestivusAcademy.Build.cs",
  "Source/FestivusAcademy/FestivusAcademy.cpp",
  "Source/FestivusAcademy/AcademyGameInstanceSubsystem.cpp",
  "Source/FestivusAcademy/AcademyHUDWidget.cpp",
  "Source/FestivusAcademy/AcademyWorldDirector.cpp",
  "Source/FestivusAcademy/AcademyPlayerController.cpp",
  "Source/FestivusAcademy/AcademyGameMode.cpp",
];

for (const file of requiredFiles) await access(resolve(root, file));

const projectPath = resolve(root, "FestivusAcademy.uproject");
const project = JSON.parse(await readFile(projectPath, "utf8")) as {
  Modules?: { Name?: string }[];
  Plugins?: { Name?: string; Enabled?: boolean }[];
};

if (!project.Modules?.some((module) => module.Name === "FestivusAcademy")) {
  throw new Error("FestivusAcademy runtime module is not registered");
}

if (
  !project.Plugins?.some(
    (plugin) => plugin.Name === "WebBrowserWidget" && plugin.Enabled === true,
  )
) {
  throw new Error("WebBrowserWidget must be enabled for web-delivered missions");
}

const config = await readFile(resolve(root, "Config/DefaultEngine.ini"), "utf8");
if (!config.includes("GlobalDefaultGameMode=/Script/FestivusAcademy.AcademyGameMode")) {
  throw new Error("AcademyGameMode is not configured as the global game mode");
}

console.log(`Unreal scaffold valid: ${requiredFiles.length} required files and project wiring present.`);
