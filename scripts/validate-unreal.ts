import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve("unreal/FestivusAcademy");
const requiredFiles = [
  "FestivusAcademy.uproject",
  "Config/DefaultEngine.ini",
  "Config/DefaultGame.ini",
  "Content/Maps/AcademyAtrium.umap",
  "Tools/create_academy_map.py",
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
  EngineAssociation?: string;
  Modules?: { Name?: string }[];
  Plugins?: { Name?: string; Enabled?: boolean }[];
};

if (project.EngineAssociation !== "5.8") {
  throw new Error("FestivusAcademy must target the installed Unreal Engine 5.8 toolchain");
}

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

if (
  !project.Plugins?.some(
    (plugin) => plugin.Name === "PythonScriptPlugin" && plugin.Enabled === true,
  )
) {
  throw new Error("PythonScriptPlugin must be enabled for reproducible editor authoring");
}

const config = await readFile(resolve(root, "Config/DefaultEngine.ini"), "utf8");
if (!config.includes("GlobalDefaultGameMode=/Script/FestivusAcademy.AcademyGameMode")) {
  throw new Error("AcademyGameMode is not configured as the global game mode");
}
for (const mapSetting of [
  "GameDefaultMap=/Game/Maps/AcademyAtrium",
  "EditorStartupMap=/Game/Maps/AcademyAtrium",
  "r.GenerateMeshDistanceFields=True",
]) {
  if (!config.includes(mapSetting)) {
    throw new Error(`Missing durable academy map setting: ${mapSetting}`);
  }
}

const gameConfig = await readFile(resolve(root, "Config/DefaultGame.ini"), "utf8");
if (!gameConfig.includes('ApiBaseUrl="http://localhost:3000"')) {
  throw new Error("Academy ApiBaseUrl must be quoted so Unreal does not treat // as an INI comment");
}

for (const target of [
  "Source/FestivusAcademy.Target.cs",
  "Source/FestivusAcademyEditor.Target.cs",
]) {
  const source = await readFile(resolve(root, target), "utf8");
  if (!source.includes("DefaultBuildSettings = BuildSettingsVersion.V7")) {
    throw new Error(`${target} must use Unreal 5.8 BuildSettingsVersion.V7`);
  }
}

console.log(`Unreal scaffold valid: ${requiredFiles.length} required files and project wiring present.`);
