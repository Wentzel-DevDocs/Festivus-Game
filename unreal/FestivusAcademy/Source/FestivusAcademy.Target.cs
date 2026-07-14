using UnrealBuildTool;
using System.Collections.Generic;

public class FestivusAcademyTarget : TargetRules
{
    public FestivusAcademyTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.V7;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("FestivusAcademy");
    }
}
