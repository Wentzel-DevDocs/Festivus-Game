#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "AcademyWorldDirector.generated.h"

class UCameraComponent;
class UMaterialInstanceDynamic;
class UPointLightComponent;
class UPostProcessComponent;
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

    UFUNCTION(BlueprintCallable, Category = "Academy|Camera")
    bool FocusPortal(int32 PortalIndex);

    UFUNCTION(BlueprintCallable, Category = "Academy|Camera")
    void ReturnToOverview();

    UFUNCTION(BlueprintCallable, Category = "Academy|Accessibility")
    void SetReducedMotionEnabled(bool bEnabled);

protected:
    virtual void BeginPlay() override;

private:
    enum class ECameraState : uint8
    {
        Arrival,
        Overview,
        Focusing,
        Focused,
        Returning
    };

    void ApplySurfaceTreatment();
    void CaptureValidationScreenshot();
    void ExitAfterCapture();
    void BeginCameraTransition(
        ECameraState NewState,
        const FTransform& TargetTransform,
        float TargetFOV,
        float Duration);
    void UpdateCameraTransition(float DeltaSeconds);
    void FinishCameraTransition();
    void UpdatePortalAtmosphere();

    UPROPERTY(VisibleAnywhere)
    TObjectPtr<USceneComponent> SceneRoot;

    UPROPERTY(VisibleAnywhere)
    TObjectPtr<UCameraComponent> AcademyCamera;

    UPROPERTY(VisibleAnywhere)
    TObjectPtr<UPostProcessComponent> CinematicGrade;

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
    float OverviewIdleTime = 0.0f;
    float PortalFocusAlpha = 0.0f;
    ECameraState CameraState = ECameraState::Arrival;
    FTransform TransitionStartTransform;
    FTransform TransitionTargetTransform;
    float TransitionStartFOV = 66.0f;
    float TransitionTargetFOV = 66.0f;
    float TransitionElapsed = 0.0f;
    float TransitionDuration = 0.0f;
    int32 ActivePortalIndex = INDEX_NONE;
    bool bReducedMotionEnabled = false;
};
