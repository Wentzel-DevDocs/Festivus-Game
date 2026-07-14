#include "AcademyPlayerController.h"

#include "AcademyHUDWidget.h"
#include "AcademyWorldDirector.h"
#include "Blueprint/UserWidget.h"
#include "EngineUtils.h"

void AAcademyPlayerController::BeginPlay()
{
    Super::BeginPlay();

    bShowMouseCursor = true;
    SetInputMode(FInputModeUIOnly());

    UAcademyHUDWidget* AcademyHUD = CreateWidget<UAcademyHUDWidget>(this, UAcademyHUDWidget::StaticClass());
    if (AcademyHUD)
    {
        AcademyHUD->AddToViewport(100);
    }

    const TActorIterator<AAcademyWorldDirector> WorldDirector(GetWorld());
    if (WorldDirector)
    {
        SetViewTarget(*WorldDirector);
    }
}
