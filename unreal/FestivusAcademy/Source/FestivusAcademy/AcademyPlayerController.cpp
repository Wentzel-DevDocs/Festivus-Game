#include "AcademyPlayerController.h"

#include "AcademyHUDWidget.h"
#include "AcademyWorldDirector.h"
#include "Blueprint/UserWidget.h"
#include "EngineUtils.h"
#include "FestivusAcademy.h"

void AAcademyPlayerController::BeginPlay()
{
    Super::BeginPlay();

    bShowMouseCursor = true;
    SetInputMode(FInputModeUIOnly());

    AcademyHUD = CreateWidget<UAcademyHUDWidget>(this, UAcademyHUDWidget::StaticClass());
    if (AcademyHUD)
    {
        AcademyHUD->AddToViewport(100);
        UE_LOG(LogFestivusAcademy, Display, TEXT("Academy native HUD added to the player viewport."));
    }
    else
    {
        UE_LOG(LogFestivusAcademy, Error, TEXT("Academy native HUD could not be created."));
    }

    const TActorIterator<AAcademyWorldDirector> WorldDirector(GetWorld());
    if (WorldDirector)
    {
        SetViewTarget(*WorldDirector);
    }
}
