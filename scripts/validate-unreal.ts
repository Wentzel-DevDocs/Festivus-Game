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
  "Source/FestivusAcademy/AcademyBrowserBridge.cpp",
  "Source/FestivusAcademy/AcademyHUDWidget.cpp",
  "Source/FestivusAcademy/AcademyWebBrowser.cpp",
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

const hudSource = await readFile(
  resolve(root, "Source/FestivusAcademy/AcademyHUDWidget.cpp"),
  "utf8",
);
for (const requiredContract of [
  "RebuildWidget()",
  "Academy embedded room reported hydrated and painted",
  "Browser->LoadURL(TEXT(\"about:blank\"))",
  "Browser->ShutdownBrowser()",
  "ViewState = EAcademyViewState::Failed",
  "keeping the safety cover while late recovery remains active",
]) {
  if (!hudSource.includes(requiredContract)) {
    throw new Error(`Missing native room lifecycle contract: ${requiredContract}`);
  }
}

const worldSource = await readFile(
  resolve(root, "Source/FestivusAcademy/AcademyWorldDirector.cpp"),
  "utf8",
);
if (
  !worldSource.includes(
    'SetReducedMotionEnabled(FParse::Param(FCommandLine::Get(), TEXT("AcademyReducedMotion")))',
  )
) {
  throw new Error("Reduced-motion mode must be applied before the first atrium tick");
}

const browserSource = await readFile(
  resolve(root, "Source/FestivusAcademy/AcademyWebBrowser.cpp"),
  "utf8",
);
if (!browserSource.includes('AcademyBridgeName = TEXT("academybridge")')) {
  throw new Error("Academy browser must expose only the dedicated readiness bridge");
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
