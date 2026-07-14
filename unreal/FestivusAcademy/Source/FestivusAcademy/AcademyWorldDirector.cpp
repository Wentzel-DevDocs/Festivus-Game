#include "AcademyWorldDirector.h"

#include "Camera/CameraComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/PostProcessComponent.h"
#include "Components/SceneComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/TextRenderComponent.h"
#include "Engine/StaticMesh.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformMisc.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Math/RotationMatrix.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "TimerManager.h"
#include "UObject/ConstructorHelpers.h"
#include "UnrealClient.h"

namespace
{
const FTransform OverviewCameraTransform(
    FRotator(-3.5f, 0.0f, 0.0f),
    FVector(-930.0f, 0.0f, 365.0f));
constexpr float OverviewFOV = 66.0f;
constexpr float PortalFocusFOV = 56.0f;
constexpr float FocusDuration = 1.2f;
constexpr float ReturnDuration = 0.9f;
}

AAcademyWorldDirector::AAcademyWorldDirector()
{
    PrimaryActorTick.bCanEverTick = true;

    SceneRoot = CreateDefaultSubobject<USceneComponent>(TEXT("SceneRoot"));
    SetRootComponent(SceneRoot);

    static ConstructorHelpers::FObjectFinder<UStaticMesh> CubeAsset(TEXT("/Engine/BasicShapes/Cube.Cube"));
    static ConstructorHelpers::FObjectFinder<UStaticMesh> SphereAsset(TEXT("/Engine/BasicShapes/Sphere.Sphere"));
    static ConstructorHelpers::FObjectFinder<UMaterialInterface> TextMaterialAsset(
        TEXT("/Engine/EngineMaterials/UnlitText.UnlitText"));

    auto AddCube = [this](const TCHAR* Name, const FVector& Location, const FVector& Scale, UStaticMesh* Mesh)
    {
        UStaticMeshComponent* Component = CreateDefaultSubobject<UStaticMeshComponent>(Name);
        Component->SetupAttachment(SceneRoot);
        Component->SetRelativeLocation(Location);
        Component->SetRelativeScale3D(Scale);
        Component->SetStaticMesh(Mesh);
        Component->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        return Component;
    };

    UStaticMesh* Cube = CubeAsset.Succeeded() ? CubeAsset.Object : nullptr;
    UStaticMesh* Sphere = SphereAsset.Succeeded() ? SphereAsset.Object : nullptr;
    FloorMeshes.Add(AddCube(TEXT("Floor"), FVector(0, 0, -60), FVector(24, 14, 0.6f), Cube));
    ArchitectureMeshes.Add(AddCube(TEXT("BackWall"), FVector(1200, 0, 520), FVector(0.5f, 14, 6), Cube));
    ArchitectureMeshes.Add(AddCube(TEXT("LeftWall"), FVector(0, -1400, 520), FVector(24, 0.5f, 6), Cube));
    ArchitectureMeshes.Add(AddCube(TEXT("RightWall"), FVector(0, 1400, 520), FVector(24, 0.5f, 6), Cube));
    FrameMeshes.Add(AddCube(TEXT("CeilingBladeLeft"), FVector(120, -930, 940), FVector(19, 0.12f, 0.12f), Cube));
    FrameMeshes.Add(AddCube(TEXT("CeilingBladeRight"), FVector(120, 930, 940), FVector(19, 0.12f, 0.12f), Cube));
    FloorMeshes.Add(AddCube(TEXT("CenterDais"), FVector(360, 0, -8), FVector(5.0f, 3.0f, 0.16f), Cube));

    UTextRenderComponent* AcademyTitle = CreateDefaultSubobject<UTextRenderComponent>(TEXT("AcademyTitle"));
    AcademyTitle->SetupAttachment(SceneRoot);
    AcademyTitle->SetRelativeLocation(FVector(1110, 0, 865));
    AcademyTitle->SetRelativeRotation(FRotator(0, 180, 0));
    AcademyTitle->SetText(FText::FromString(TEXT("JUSTIN'S DEVELOPER ACADEMY")));
    AcademyTitle->SetHorizontalAlignment(EHTA_Center);
    AcademyTitle->SetWorldSize(76.0f);
    AcademyTitle->SetTextRenderColor(FColor(245, 250, 247));
    if (TextMaterialAsset.Succeeded()) AcademyTitle->SetTextMaterial(TextMaterialAsset.Object);

    const TCHAR* DoorNames[] = { TEXT("DoorNext"), TEXT("DoorSwift"), TEXT("DoorAndroid"), TEXT("DoorExpo") };
    const TCHAR* LabelNames[] = { TEXT("LabelNext"), TEXT("LabelSwift"), TEXT("LabelAndroid"), TEXT("LabelExpo") };
    const TCHAR* Labels[] = { TEXT("01  NEXT.JS"), TEXT("02  SWIFTUI"), TEXT("03  ANDROID"), TEXT("04  EXPO") };
    const float DoorY[] = { -750.0f, -250.0f, 250.0f, 750.0f };
    const FLinearColor PortalColors[] = {
        FLinearColor(0.16f, 1.0f, 0.52f),
        FLinearColor(0.20f, 0.55f, 1.0f),
        FLinearColor(0.64f, 1.0f, 0.20f),
        FLinearColor(0.68f, 0.40f, 1.0f)
    };

    for (int32 Index = 0; Index < 4; ++Index)
    {
        PortalPanels.Add(AddCube(DoorNames[Index], FVector(1140, DoorY[Index], 250), FVector(0.18f, 1.8f, 3.1f), Cube));
        PortalOrbs.Add(AddCube(
            *FString::Printf(TEXT("PortalOrb%d"), Index),
            FVector(1030, DoorY[Index], 760),
            FVector(0.62f),
            Sphere));
        FrameMeshes.Add(AddCube(*FString::Printf(TEXT("PortalFrameNear%d"), Index), FVector(1090, DoorY[Index] - 205, 250), FVector(0.14f, 0.14f, 3.25f), Cube));
        FrameMeshes.Add(AddCube(*FString::Printf(TEXT("PortalFrameFar%d"), Index), FVector(1090, DoorY[Index] + 205, 250), FVector(0.14f, 0.14f, 3.25f), Cube));
        FrameMeshes.Add(AddCube(*FString::Printf(TEXT("PortalFrameTop%d"), Index), FVector(1090, DoorY[Index], 575), FVector(0.14f, 2.2f, 0.14f), Cube));
        RunwayStrips.Add(AddCube(*FString::Printf(TEXT("Runway%d"), Index), FVector(460, DoorY[Index], -24), FVector(13.0f, 0.055f, 0.05f), Cube));

        UTextRenderComponent* Label = CreateDefaultSubobject<UTextRenderComponent>(LabelNames[Index]);
        Label->SetupAttachment(SceneRoot);
        Label->SetRelativeLocation(FVector(1110, DoorY[Index], 620));
        Label->SetRelativeRotation(FRotator(0, 180, 0));
        Label->SetText(FText::FromString(Labels[Index]));
        Label->SetHorizontalAlignment(EHTA_Center);
        Label->SetWorldSize(46.0f);
        Label->SetTextRenderColor(PortalColors[Index].ToFColor(true));
        if (TextMaterialAsset.Succeeded()) Label->SetTextMaterial(TextMaterialAsset.Object);

        UPointLightComponent* PortalLight = CreateDefaultSubobject<UPointLightComponent>(
            *FString::Printf(TEXT("PortalLight%d"), Index));
        PortalLight->SetupAttachment(SceneRoot);
        PortalLight->SetRelativeLocation(FVector(980, DoorY[Index], 315));
        PortalLight->Intensity = Index == 0 ? 4300.0f : 2800.0f;
        PortalLight->AttenuationRadius = 720.0f;
        PortalLight->SetLightColor(PortalColors[Index]);
        PortalLight->SetSourceRadius(110.0f);
        PortalLight->SetSoftSourceRadius(180.0f);
        PortalLight->SetSpecularScale(0.28f);
        PortalLight->bUseInverseSquaredFalloff = true;
        PortalLights.Add(PortalLight);
    }

    AcademyCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("AcademyCamera"));
    AcademyCamera->SetupAttachment(SceneRoot);
    AcademyCamera->SetRelativeLocation(FVector(-1550, 0, 445));
    AcademyCamera->SetRelativeRotation(FRotator(-3.5f, 0, 0));
    AcademyCamera->FieldOfView = 75.0f;
    AcademyCamera->SetAutoActivate(true);
    AcademyCamera->SetConstraintAspectRatio(false);
    AcademyCamera->SetAspectRatio(16.0f / 9.0f);
    AcademyCamera->bOverrideAspectRatioAxisConstraint = true;
    AcademyCamera->SetAspectRatioAxisConstraint(EAspectRatioAxisConstraint::AspectRatio_MaintainYFOV);

    USkyLightComponent* SkyLight = CreateDefaultSubobject<USkyLightComponent>(TEXT("SkyLight"));
    SkyLight->SetupAttachment(SceneRoot);
    SkyLight->Intensity = 0.10f;
    SkyLight->SetLightColor(FLinearColor(0.25f, 0.37f, 0.5f));

    UPointLightComponent* KeyLight = CreateDefaultSubobject<UPointLightComponent>(TEXT("KeyLight"));
    KeyLight->SetupAttachment(SceneRoot);
    KeyLight->SetRelativeLocation(FVector(250, -450, 620));
    KeyLight->Intensity = 1100.0f;
    KeyLight->AttenuationRadius = 1350.0f;
    KeyLight->SetLightColor(FLinearColor(0.22f, 0.82f, 0.53f));

    UPointLightComponent* WarmLight = CreateDefaultSubobject<UPointLightComponent>(TEXT("WarmLight"));
    WarmLight->SetupAttachment(SceneRoot);
    WarmLight->SetRelativeLocation(FVector(450, 650, 480));
    WarmLight->Intensity = 850.0f;
    WarmLight->AttenuationRadius = 1250.0f;
    WarmLight->SetLightColor(FLinearColor(1.0f, 0.46f, 0.16f));

    UExponentialHeightFogComponent* Fog = CreateDefaultSubobject<UExponentialHeightFogComponent>(TEXT("Atmosphere"));
    Fog->SetupAttachment(SceneRoot);
    Fog->FogDensity = 0.006f;
    Fog->FogHeightFalloff = 0.16f;
    Fog->SetFogInscatteringColor(FLinearColor(0.025f, 0.08f, 0.10f));
    Fog->bEnableVolumetricFog = true;
    Fog->VolumetricFogExtinctionScale = 0.65f;
    Fog->VolumetricFogDistance = 5000.0f;

    CinematicGrade = CreateDefaultSubobject<UPostProcessComponent>(TEXT("CinematicGrade"));
    CinematicGrade->SetupAttachment(SceneRoot);
    CinematicGrade->bUnbound = true;
    CinematicGrade->Settings.bOverride_BloomIntensity = true;
    CinematicGrade->Settings.BloomIntensity = 0.75f;
    CinematicGrade->Settings.bOverride_VignetteIntensity = true;
    CinematicGrade->Settings.VignetteIntensity = 0.34f;
    CinematicGrade->Settings.bOverride_AutoExposureBias = true;
    CinematicGrade->Settings.AutoExposureBias = -0.12f;
    CinematicGrade->Settings.bOverride_MotionBlurAmount = true;
    CinematicGrade->Settings.MotionBlurAmount = 0.10f;
}

void AAcademyWorldDirector::BeginPlay()
{
    Super::BeginPlay();
    ApplySurfaceTreatment();
    AcademyCamera->SetActive(true);
    SetReducedMotionEnabled(FParse::Param(FCommandLine::Get(), TEXT("AcademyReducedMotion")));

    if (FParse::Param(FCommandLine::Get(), TEXT("AcademyCapture")))
    {
        GetWorldTimerManager().SetTimer(
            CaptureTimer,
            this,
            &AAcademyWorldDirector::CaptureValidationScreenshot,
            6.0f,
            false);
    }
}

void AAcademyWorldDirector::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);

    PresentationTime += DeltaSeconds;
    switch (CameraState)
    {
    case ECameraState::Arrival:
        {
            const float ArrivalAlpha = FMath::InterpEaseOut(
                0.0f,
                1.0f,
                FMath::Clamp(PresentationTime / 4.5f, 0.0f, 1.0f),
                3.0f);
            const float CameraX = FMath::Lerp(-1550.0f, -930.0f, ArrivalAlpha);
            const float CameraY = bReducedMotionEnabled ? 0.0f : FMath::Sin(PresentationTime * 0.18f) * 22.0f;
            const float CameraZ = FMath::Lerp(445.0f, 365.0f, ArrivalAlpha) +
                (bReducedMotionEnabled ? 0.0f : FMath::Sin(PresentationTime * 0.25f) * 5.0f);
            AcademyCamera->SetRelativeLocation(FVector(CameraX, CameraY, CameraZ));
            AcademyCamera->SetRelativeRotation(FRotator(-3.5f, 0.0f, 0.0f));
            AcademyCamera->SetFieldOfView(FMath::Lerp(75.0f, OverviewFOV, ArrivalAlpha));
            if (ArrivalAlpha >= 1.0f)
            {
                CameraState = ECameraState::Overview;
                OverviewIdleTime = 0.0f;
            }
        }
        break;

    case ECameraState::Overview:
        {
            OverviewIdleTime += DeltaSeconds;
            const float DriftBlend = bReducedMotionEnabled
                ? 0.0f
                : FMath::Clamp(OverviewIdleTime / 1.5f, 0.0f, 1.0f);
            const FVector BaseLocation = OverviewCameraTransform.GetLocation();
            AcademyCamera->SetRelativeLocation(BaseLocation + FVector(
                0.0f,
                FMath::Sin(PresentationTime * 0.18f) * 22.0f * DriftBlend,
                FMath::Sin(PresentationTime * 0.25f) * 5.0f * DriftBlend));
            AcademyCamera->SetRelativeRotation(OverviewCameraTransform.Rotator());
            AcademyCamera->SetFieldOfView(OverviewFOV);
        }
        break;

    case ECameraState::Focusing:
    case ECameraState::Returning:
        UpdateCameraTransition(DeltaSeconds);
        break;

    case ECameraState::Focused:
        break;
    }

    UpdatePortalAtmosphere();
}

bool AAcademyWorldDirector::FocusPortal(int32 PortalIndex)
{
    if (!AcademyCamera || !PortalPanels.IsValidIndex(PortalIndex) || !PortalPanels[PortalIndex])
    {
        return false;
    }

    ActivePortalIndex = PortalIndex;
    const FVector PortalCenter = PortalPanels[PortalIndex]->GetRelativeLocation();
    const FVector FocusLocation = PortalCenter + FVector(-1420.0f, 90.0f, 110.0f);
    const FVector LookAt = PortalCenter + FVector(0.0f, 0.0f, 90.0f);
    const FQuat FocusRotation = FRotationMatrix::MakeFromX(LookAt - FocusLocation).ToQuat();
    BeginCameraTransition(
        ECameraState::Focusing,
        FTransform(FocusRotation, FocusLocation),
        PortalFocusFOV,
        FocusDuration);
    return true;
}

void AAcademyWorldDirector::ReturnToOverview()
{
    if (!AcademyCamera)
    {
        return;
    }

    BeginCameraTransition(
        ECameraState::Returning,
        OverviewCameraTransform,
        OverviewFOV,
        ReturnDuration);
}

void AAcademyWorldDirector::SetReducedMotionEnabled(bool bEnabled)
{
    bReducedMotionEnabled = bEnabled;
    if (CinematicGrade)
    {
        CinematicGrade->Settings.MotionBlurAmount = bEnabled ? 0.0f : 0.10f;
    }

    if (bEnabled && CameraState == ECameraState::Arrival)
    {
        AcademyCamera->SetRelativeTransform(OverviewCameraTransform);
        AcademyCamera->SetFieldOfView(OverviewFOV);
        CameraState = ECameraState::Overview;
        OverviewIdleTime = 0.0f;
    }
    else if (bEnabled && (CameraState == ECameraState::Focusing || CameraState == ECameraState::Returning))
    {
        AcademyCamera->SetRelativeTransform(TransitionTargetTransform);
        AcademyCamera->SetFieldOfView(TransitionTargetFOV);
        PortalFocusAlpha = CameraState == ECameraState::Returning ? 0.0f : 1.0f;
        FinishCameraTransition();
    }
}

void AAcademyWorldDirector::BeginCameraTransition(
    ECameraState NewState,
    const FTransform& TargetTransform,
    float TargetFOV,
    float Duration)
{
    TransitionStartTransform = AcademyCamera->GetRelativeTransform();
    TransitionTargetTransform = TargetTransform;
    TransitionStartFOV = AcademyCamera->FieldOfView;
    TransitionTargetFOV = TargetFOV;
    TransitionElapsed = 0.0f;
    TransitionDuration = bReducedMotionEnabled ? 0.0f : Duration;
    CameraState = NewState;

    if (TransitionDuration <= KINDA_SMALL_NUMBER)
    {
        AcademyCamera->SetRelativeTransform(TransitionTargetTransform);
        AcademyCamera->SetFieldOfView(TransitionTargetFOV);
        PortalFocusAlpha = CameraState == ECameraState::Returning ? 0.0f : 1.0f;
        FinishCameraTransition();
    }
}

void AAcademyWorldDirector::UpdateCameraTransition(float DeltaSeconds)
{
    TransitionElapsed += DeltaSeconds;
    const float Alpha = FMath::Clamp(
        TransitionElapsed / FMath::Max(TransitionDuration, KINDA_SMALL_NUMBER),
        0.0f,
        1.0f);
    const float Eased = FMath::InterpEaseInOut(0.0f, 1.0f, Alpha, 2.0f);
    const FVector Location = FMath::Lerp(
        TransitionStartTransform.GetLocation(),
        TransitionTargetTransform.GetLocation(),
        Eased);
    const FQuat Rotation = FQuat::Slerp(
        TransitionStartTransform.GetRotation(),
        TransitionTargetTransform.GetRotation(),
        Eased);

    AcademyCamera->SetRelativeLocationAndRotation(Location, Rotation);
    AcademyCamera->SetFieldOfView(FMath::Lerp(TransitionStartFOV, TransitionTargetFOV, Eased));
    PortalFocusAlpha = CameraState == ECameraState::Returning ? 1.0f - Eased : Eased;

    if (Alpha >= 1.0f)
    {
        FinishCameraTransition();
    }
}

void AAcademyWorldDirector::FinishCameraTransition()
{
    if (CameraState == ECameraState::Focusing)
    {
        CameraState = ECameraState::Focused;
        PortalFocusAlpha = 1.0f;
    }
    else if (CameraState == ECameraState::Returning)
    {
        CameraState = ECameraState::Overview;
        PortalFocusAlpha = 0.0f;
        ActivePortalIndex = INDEX_NONE;
        OverviewIdleTime = 0.0f;
    }
}

void AAcademyWorldDirector::UpdatePortalAtmosphere()
{
    for (int32 Index = 0; Index < PortalLights.Num(); ++Index)
    {
        const bool bSelected = Index == ActivePortalIndex;
        if (UPointLightComponent* PortalLight = PortalLights[Index])
        {
            const float BaseIntensity = Index == 0 ? 4300.0f : 2800.0f;
            const float Pulse = bReducedMotionEnabled
                ? 1.0f
                : 0.86f + FMath::Sin(PresentationTime * 1.25f + Index * 1.4f) * 0.14f;
            const float FocusMultiplier = bSelected
                ? FMath::Lerp(1.0f, 1.85f, PortalFocusAlpha)
                : FMath::Lerp(1.0f, 0.52f, PortalFocusAlpha);
            PortalLight->SetIntensity(BaseIntensity * Pulse * FocusMultiplier);
        }

        if (PortalOrbs.IsValidIndex(Index) && PortalOrbs[Index])
        {
            const float Bob = bReducedMotionEnabled
                ? 0.0f
                : FMath::Sin(PresentationTime * 0.72f + Index * 1.3f) * 18.0f;
            PortalOrbs[Index]->SetRelativeLocation(FVector(1030, -750.0f + Index * 500.0f, 760.0f + Bob));
            PortalOrbs[Index]->SetRelativeRotation(bReducedMotionEnabled
                ? FRotator::ZeroRotator
                : FRotator(PresentationTime * 18.0f, PresentationTime * 31.0f + Index * 45.0f, 0.0f));
            const float ScaleMultiplier = bSelected
                ? FMath::Lerp(1.0f, 1.35f, PortalFocusAlpha)
                : FMath::Lerp(1.0f, 0.88f, PortalFocusAlpha);
            PortalOrbs[Index]->SetRelativeScale3D(FVector(0.62f * ScaleMultiplier));
        }
    }
}

void AAcademyWorldDirector::ApplySurfaceTreatment()
{
    UMaterialInterface* BaseMaterial = LoadObject<UMaterialInterface>(
        nullptr,
        TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
    if (!BaseMaterial)
    {
        return;
    }

    auto CreateMaterial = [this, BaseMaterial](const TCHAR* Name, const FLinearColor& Color, float Metallic, float Roughness)
    {
        UMaterialInstanceDynamic* Material = UMaterialInstanceDynamic::Create(BaseMaterial, this, FName(Name));
        Material->SetVectorParameterValue(TEXT("Color"), Color);
        Material->SetScalarParameterValue(TEXT("Metallic"), Metallic);
        Material->SetScalarParameterValue(TEXT("Roughness"), Roughness);
        RuntimeMaterials.Add(Material);
        return Material;
    };

    UMaterialInstanceDynamic* Architecture = CreateMaterial(
        TEXT("ArchitectureMaterial"), FLinearColor(0.006f, 0.014f, 0.025f), 0.18f, 0.44f);
    UMaterialInstanceDynamic* Floor = CreateMaterial(
        TEXT("FloorMaterial"), FLinearColor(0.004f, 0.008f, 0.014f), 0.64f, 0.24f);
    UMaterialInstanceDynamic* Frames = CreateMaterial(
        TEXT("FrameMaterial"), FLinearColor(0.025f, 0.035f, 0.048f), 0.82f, 0.18f);

    for (UStaticMeshComponent* Mesh : ArchitectureMeshes) Mesh->SetMaterial(0, Architecture);
    for (UStaticMeshComponent* Mesh : FloorMeshes) Mesh->SetMaterial(0, Floor);
    for (UStaticMeshComponent* Mesh : FrameMeshes) Mesh->SetMaterial(0, Frames);

    const FLinearColor PortalColors[] = {
        FLinearColor(0.035f, 0.32f, 0.14f),
        FLinearColor(0.03f, 0.15f, 0.38f),
        FLinearColor(0.20f, 0.32f, 0.035f),
        FLinearColor(0.18f, 0.07f, 0.34f)
    };
    for (int32 Index = 0; Index < PortalPanels.Num(); ++Index)
    {
        UMaterialInstanceDynamic* Portal = CreateMaterial(
            *FString::Printf(TEXT("PortalMaterial%d"), Index),
            PortalColors[Index],
            0.28f,
            0.22f);
        PortalPanels[Index]->SetMaterial(0, Portal);
        if (PortalOrbs.IsValidIndex(Index)) PortalOrbs[Index]->SetMaterial(0, Portal);

        UMaterialInstanceDynamic* Runway = CreateMaterial(
            *FString::Printf(TEXT("RunwayMaterial%d"), Index),
            PortalColors[Index] * 0.65f,
            0.55f,
            0.28f);
        RunwayStrips[Index]->SetMaterial(0, Runway);
    }
}

void AAcademyWorldDirector::CaptureValidationScreenshot()
{
    const FString CaptureDirectory = FPaths::Combine(
        FPaths::ProjectSavedDir(),
        TEXT("Screenshots/Mac"));
    IFileManager::Get().MakeDirectory(*CaptureDirectory, true);

    const FString SceneCapturePath = FPaths::Combine(CaptureDirectory, TEXT("AcademyAtrium.png"));
    FScreenshotRequest::RequestScreenshot(SceneCapturePath, true, false);
    UE_LOG(LogTemp, Display, TEXT("Academy validation screenshot requested: %s"), *SceneCapturePath);

    GetWorldTimerManager().SetTimer(
        ExitTimer,
        this,
        &AAcademyWorldDirector::ExitAfterCapture,
        2.0f,
        false);
}

void AAcademyWorldDirector::ExitAfterCapture()
{
    FPlatformMisc::RequestExit(false);
}
