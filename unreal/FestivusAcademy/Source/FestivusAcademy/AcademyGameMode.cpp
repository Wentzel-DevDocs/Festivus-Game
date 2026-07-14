#include "AcademyGameMode.h"

#include "AcademyPlayerController.h"
#include "AcademyWorldDirector.h"
#include "EngineUtils.h"

AAcademyGameMode::AAcademyGameMode()
{
    DefaultPawnClass = nullptr;
    PlayerControllerClass = AAcademyPlayerController::StaticClass();
}

void AAcademyGameMode::StartPlay()
{
    bool bHasWorldDirector = false;
    for (TActorIterator<AAcademyWorldDirector> It(GetWorld()); It; ++It)
    {
        bHasWorldDirector = true;
        break;
    }

    if (!bHasWorldDirector)
    {
        GetWorld()->SpawnActor<AAcademyWorldDirector>(AAcademyWorldDirector::StaticClass(), FTransform::Identity);
    }

    Super::StartPlay();
}
