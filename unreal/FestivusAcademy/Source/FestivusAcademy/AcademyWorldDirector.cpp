#include "AcademyWorldDirector.h"

#include "Camera/CameraComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/SceneComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/TextRenderComponent.h"
#include "Engine/StaticMesh.h"
#include "UObject/ConstructorHelpers.h"

AAcademyWorldDirector::AAcademyWorldDirector()
{
    PrimaryActorTick.bCanEverTick = false;

    SceneRoot = CreateDefaultSubobject<USceneComponent>(TEXT("SceneRoot"));
    SetRootComponent(SceneRoot);

    static ConstructorHelpers::FObjectFinder<UStaticMesh> CubeAsset(TEXT("/Engine/BasicShapes/Cube.Cube"));

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
    AddCube(TEXT("Floor"), FVector(0, 0, -60), FVector(24, 14, 0.6f), Cube);
    AddCube(TEXT("BackWall"), FVector(1200, 0, 520), FVector(0.5f, 14, 6), Cube);
    AddCube(TEXT("LeftWall"), FVector(0, -1400, 520), FVector(24, 0.5f, 6), Cube);
    AddCube(TEXT("RightWall"), FVector(0, 1400, 520), FVector(24, 0.5f, 6), Cube);

    const TCHAR* DoorNames[] = { TEXT("DoorNext"), TEXT("DoorSwift"), TEXT("DoorAndroid"), TEXT("DoorExpo") };
    const TCHAR* LabelNames[] = { TEXT("LabelNext"), TEXT("LabelSwift"), TEXT("LabelAndroid"), TEXT("LabelExpo") };
    const TCHAR* Labels[] = { TEXT("01  NEXT.JS"), TEXT("02  SWIFTUI"), TEXT("03  ANDROID"), TEXT("04  EXPO") };
    const float DoorY[] = { -750.0f, -250.0f, 250.0f, 750.0f };

    for (int32 Index = 0; Index < 4; ++Index)
    {
        AddCube(DoorNames[Index], FVector(1140, DoorY[Index], 250), FVector(0.18f, 1.8f, 3.1f), Cube);

        UTextRenderComponent* Label = CreateDefaultSubobject<UTextRenderComponent>(LabelNames[Index]);
        Label->SetupAttachment(SceneRoot);
        Label->SetRelativeLocation(FVector(1110, DoorY[Index], 620));
        Label->SetRelativeRotation(FRotator(0, 180, 0));
        Label->SetText(FText::FromString(Labels[Index]));
        Label->SetHorizontalAlignment(EHTA_Center);
        Label->SetWorldSize(46.0f);
        Label->SetTextRenderColor(Index == 0 ? FColor(67, 199, 122) : FColor(135, 147, 158));
    }

    AcademyCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("AcademyCamera"));
    AcademyCamera->SetupAttachment(SceneRoot);
    AcademyCamera->SetRelativeLocation(FVector(-1250, 0, 390));
    AcademyCamera->SetRelativeRotation(FRotator(-2, 0, 0));
    AcademyCamera->FieldOfView = 72.0f;

    USkyLightComponent* SkyLight = CreateDefaultSubobject<USkyLightComponent>(TEXT("SkyLight"));
    SkyLight->SetupAttachment(SceneRoot);
    SkyLight->Intensity = 0.65f;
    SkyLight->SetLightColor(FLinearColor(0.25f, 0.37f, 0.5f));

    UPointLightComponent* KeyLight = CreateDefaultSubobject<UPointLightComponent>(TEXT("KeyLight"));
    KeyLight->SetupAttachment(SceneRoot);
    KeyLight->SetRelativeLocation(FVector(250, -450, 620));
    KeyLight->Intensity = 6200.0f;
    KeyLight->AttenuationRadius = 2400.0f;
    KeyLight->SetLightColor(FLinearColor(0.22f, 0.82f, 0.53f));

    UPointLightComponent* WarmLight = CreateDefaultSubobject<UPointLightComponent>(TEXT("WarmLight"));
    WarmLight->SetupAttachment(SceneRoot);
    WarmLight->SetRelativeLocation(FVector(450, 650, 480));
    WarmLight->Intensity = 4200.0f;
    WarmLight->AttenuationRadius = 1900.0f;
    WarmLight->SetLightColor(FLinearColor(1.0f, 0.46f, 0.16f));

    UExponentialHeightFogComponent* Fog = CreateDefaultSubobject<UExponentialHeightFogComponent>(TEXT("Atmosphere"));
    Fog->SetupAttachment(SceneRoot);
    Fog->FogDensity = 0.018f;
    Fog->FogHeightFalloff = 0.16f;
    Fog->SetFogInscatteringColor(FLinearColor(0.025f, 0.08f, 0.10f));
}
