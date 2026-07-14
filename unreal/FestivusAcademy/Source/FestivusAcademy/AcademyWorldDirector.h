#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "AcademyWorldDirector.generated.h"

class UCameraComponent;
class USceneComponent;

/** Procedural academy atrium; no binary map or marketplace asset required. */
UCLASS()
class FESTIVUSACADEMY_API AAcademyWorldDirector : public AActor
{
    GENERATED_BODY()

public:
    AAcademyWorldDirector();

private:
    UPROPERTY(VisibleAnywhere)
    TObjectPtr<USceneComponent> SceneRoot;

    UPROPERTY(VisibleAnywhere)
    TObjectPtr<UCameraComponent> AcademyCamera;
};
