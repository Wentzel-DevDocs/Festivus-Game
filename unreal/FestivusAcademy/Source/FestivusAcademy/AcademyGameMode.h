#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "AcademyGameMode.generated.h"

UCLASS()
class FESTIVUSACADEMY_API AAcademyGameMode : public AGameModeBase
{
    GENERATED_BODY()

public:
    AAcademyGameMode();
    virtual void StartPlay() override;
};
