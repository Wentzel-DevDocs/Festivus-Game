using UnrealBuildTool;
using System.Collections.Generic;

public class FestivusAcademyEditorTarget : TargetRules
{
    public FestivusAcademyEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.V5;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("FestivusAcademy");
    }
}
