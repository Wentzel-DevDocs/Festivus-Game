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
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "TimerManager.h"
#include "UObject/ConstructorHelpers.h"
#include "UnrealClient.h"

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

    UPostProcessComponent* Grade = CreateDefaultSubobject<UPostProcessComponent>(TEXT("CinematicGrade"));
    Grade->SetupAttachment(SceneRoot);
    Grade->bUnbound = true;
    Grade->Settings.bOverride_BloomIntensity = true;
    Grade->Settings.BloomIntensity = 0.75f;
    Grade->Settings.bOverride_VignetteIntensity = true;
    Grade->Settings.VignetteIntensity = 0.34f;
    Grade->Settings.bOverride_AutoExposureBias = true;
    Grade->Settings.AutoExposureBias = -0.12f;
}

void AAcademyWorldDirector::BeginPlay()
{
    Super::BeginPlay();
    ApplySurfaceTreatment();

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
    const float ArrivalAlpha = FMath::InterpEaseOut(0.0f, 1.0f, FMath::Clamp(PresentationTime / 4.5f, 0.0f, 1.0f), 3.0f);
    const float CameraX = FMath::Lerp(-1550.0f, -930.0f, ArrivalAlpha);
    const float CameraY = FMath::Sin(PresentationTime * 0.18f) * 22.0f;
    const float CameraZ = FMath::Lerp(445.0f, 365.0f, ArrivalAlpha) + FMath::Sin(PresentationTime * 0.25f) * 5.0f;
    AcademyCamera->SetRelativeLocation(FVector(CameraX, CameraY, CameraZ));
    AcademyCamera->FieldOfView = FMath::Lerp(75.0f, 66.0f, ArrivalAlpha);

    for (int32 Index = 0; Index < PortalLights.Num(); ++Index)
    {
        if (UPointLightComponent* PortalLight = PortalLights[Index])
        {
            const float BaseIntensity = Index == 0 ? 4300.0f : 2800.0f;
            const float Pulse = 0.86f + FMath::Sin(PresentationTime * 1.25f + Index * 1.4f) * 0.14f;
            PortalLight->SetIntensity(BaseIntensity * Pulse);
        }

        if (PortalOrbs.IsValidIndex(Index) && PortalOrbs[Index])
        {
            const float Bob = FMath::Sin(PresentationTime * 0.72f + Index * 1.3f) * 18.0f;
            PortalOrbs[Index]->SetRelativeLocation(FVector(1030, -750.0f + Index * 500.0f, 760.0f + Bob));
            PortalOrbs[Index]->SetRelativeRotation(FRotator(
                PresentationTime * 18.0f,
                PresentationTime * 31.0f + Index * 45.0f,
                0.0f));
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
