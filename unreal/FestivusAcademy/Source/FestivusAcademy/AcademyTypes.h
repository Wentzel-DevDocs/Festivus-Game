#pragma once

#include "CoreMinimal.h"
#include "AcademyTypes.generated.h"

USTRUCT(BlueprintType)
struct FESTIVUSACADEMY_API FAcademyRoomSummary
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly, Category = "Academy")
    FString Slug;

    UPROPERTY(BlueprintReadOnly, Category = "Academy")
    int32 Order = 0;

    UPROPERTY(BlueprintReadOnly, Category = "Academy")
    FString Title;

    UPROPERTY(BlueprintReadOnly, Category = "Academy")
    FString ShortTitle;

    UPROPERTY(BlueprintReadOnly, Category = "Academy")
    FString Subtitle;

    UPROPERTY(BlueprintReadOnly, Category = "Academy")
    FString Status;

    UPROPERTY(BlueprintReadOnly, Category = "Academy")
    FString Accent;

    UPROPERTY(BlueprintReadOnly, Category = "Academy")
    int32 EstimatedMinutes = 0;

    UPROPERTY(BlueprintReadOnly, Category = "Academy")
    int32 MissionCount = 0;

    UPROPERTY(BlueprintReadOnly, Category = "Academy")
    TArray<FString> LearningOutcomes;
};
