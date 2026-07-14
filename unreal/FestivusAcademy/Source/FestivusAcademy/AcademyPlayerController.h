#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "AcademyPlayerController.generated.h"

class UAcademyHUDWidget;

UCLASS()
class FESTIVUSACADEMY_API AAcademyPlayerController : public APlayerController
{
    GENERATED_BODY()

protected:
    virtual void BeginPlay() override;

private:
    UPROPERTY(Transient)
    TObjectPtr<UAcademyHUDWidget> AcademyHUD;
};
