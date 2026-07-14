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

    for (TActorIterator<AAcademyWorldDirector> It(GetWorld()); It; ++It)
    {
        SetViewTarget(*It);
        break;
    }
}
