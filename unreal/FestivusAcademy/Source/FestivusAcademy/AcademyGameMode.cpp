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
    const TActorIterator<AAcademyWorldDirector> WorldDirector(GetWorld());
    const bool bHasWorldDirector = static_cast<bool>(WorldDirector);

    if (!bHasWorldDirector)
    {
        GetWorld()->SpawnActor<AAcademyWorldDirector>(AAcademyWorldDirector::StaticClass(), FTransform::Identity);
    }

    Super::StartPlay();
}
