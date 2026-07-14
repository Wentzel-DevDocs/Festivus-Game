#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "AcademyHUDWidget.generated.h"

class UButton;
class UOverlay;
class UTextBlock;
class UVerticalBox;
class UWebBrowser;

/** Asset-free UMG shell so a fresh clone opens without binary .uasset files. */
UCLASS()
class FESTIVUSACADEMY_API UAcademyHUDWidget : public UUserWidget
{
    GENERATED_BODY()

protected:
    virtual void NativeConstruct() override;
    virtual void NativeDestruct() override;

private:
    UTextBlock* CreateText(const FString& Value, int32 Size, const FLinearColor& Color);
    UButton* CreateMenuButton(const FString& Label, const FLinearColor& Accent);
    void OpenExperience(const FString& Url);

    UFUNCTION()
    void OpenTeaser();

    UFUNCTION()
    void OpenNextRoom();

    UFUNCTION()
    void OpenSwiftUIRoom();

    UFUNCTION()
    void OpenAndroidRoom();

    UFUNCTION()
    void OpenExpoRoom();

    UFUNCTION()
    void CloseExperience();

    UFUNCTION()
    void HandleCatalogLoaded(bool bSucceeded);

    UPROPERTY(Transient)
    TObjectPtr<UOverlay> ExperienceLayer;

    UPROPERTY(Transient)
    TObjectPtr<UWebBrowser> Browser;

    UPROPERTY(Transient)
    TObjectPtr<UTextBlock> StatusText;
};
