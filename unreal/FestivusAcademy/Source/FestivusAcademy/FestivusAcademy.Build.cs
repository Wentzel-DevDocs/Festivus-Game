using UnrealBuildTool;

public class FestivusAcademy : ModuleRules
{
    public FestivusAcademy(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new[]
        {
            "Core",
            "CoreUObject",
            "Engine",
            "InputCore",
            "UMG",
            "HTTP",
            "Json",
            "JsonUtilities",
            "WebBrowserWidget"
        });

        PrivateDependencyModuleNames.AddRange(new[]
        {
            "Slate",
            "SlateCore",
            "WebBrowser"
        });
    }
}
