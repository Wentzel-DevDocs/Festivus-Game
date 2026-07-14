#pragma once

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "AcademyBrowserBridge.generated.h"

class UAcademyHUDWidget;

/** Minimal, nonce-gated surface exposed to the embedded curriculum page. */
UCLASS()
class FESTIVUSACADEMY_API UAcademyBrowserBridge : public UObject
{
    GENERATED_BODY()

public:
    void Initialize(UAcademyHUDWidget* InOwner);

    UFUNCTION()
    void Ready(const FString& EntryToken);

private:
    UPROPERTY(Transient)
    TWeakObjectPtr<UAcademyHUDWidget> Owner;
};
