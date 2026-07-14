#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "AcademyPlayerController.generated.h"

UCLASS()
class FESTIVUSACADEMY_API AAcademyPlayerController : public APlayerController
{
    GENERATED_BODY()

protected:
    virtual void BeginPlay() override;
};
