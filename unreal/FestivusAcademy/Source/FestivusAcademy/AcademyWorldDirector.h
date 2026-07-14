#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "AcademyWorldDirector.generated.h"

class UCameraComponent;
class UMaterialInstanceDynamic;
class UPointLightComponent;
class USceneComponent;
class UStaticMeshComponent;

/** Native, procedural academy atrium with a short cinematic arrival. */
UCLASS()
class FESTIVUSACADEMY_API AAcademyWorldDirector : public AActor
{
    GENERATED_BODY()

public:
    AAcademyWorldDirector();

    virtual void Tick(float DeltaSeconds) override;

protected:
    virtual void BeginPlay() override;

private:
    void ApplySurfaceTreatment();
    void CaptureValidationScreenshot();
    void ExitAfterCapture();

    UPROPERTY(VisibleAnywhere)
    TObjectPtr<USceneComponent> SceneRoot;

    UPROPERTY(VisibleAnywhere)
    TObjectPtr<UCameraComponent> AcademyCamera;

    UPROPERTY(VisibleAnywhere)
    TArray<TObjectPtr<UPointLightComponent>> PortalLights;

    UPROPERTY(VisibleAnywhere)
    TArray<TObjectPtr<UStaticMeshComponent>> ArchitectureMeshes;

    UPROPERTY(VisibleAnywhere)
    TArray<TObjectPtr<UStaticMeshComponent>> FloorMeshes;

    UPROPERTY(VisibleAnywhere)
    TArray<TObjectPtr<UStaticMeshComponent>> FrameMeshes;

    UPROPERTY(VisibleAnywhere)
    TArray<TObjectPtr<UStaticMeshComponent>> PortalPanels;

    UPROPERTY(VisibleAnywhere)
    TArray<TObjectPtr<UStaticMeshComponent>> PortalOrbs;

    UPROPERTY(VisibleAnywhere)
    TArray<TObjectPtr<UStaticMeshComponent>> RunwayStrips;

    UPROPERTY(Transient)
    TArray<TObjectPtr<UMaterialInstanceDynamic>> RuntimeMaterials;

    FTimerHandle CaptureTimer;
    FTimerHandle ExitTimer;
    float PresentationTime = 0.0f;
};
