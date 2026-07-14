#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "AcademyHUDWidget.generated.h"

class UAcademyBrowserBridge;
class UAcademyWebBrowser;
class UBorder;
class UButton;
class UOverlay;
class UTextBlock;
class UVerticalBox;

enum class EAcademyViewState : uint8
{
    Hub,
    Traveling,
    WaitingForRoom,
    Failed,
    InRoom,
    Returning
};

/** Asset-free UMG shell so a fresh clone opens without binary .uasset files. */
UCLASS()
class FESTIVUSACADEMY_API UAcademyHUDWidget : public UUserWidget
{
    GENERATED_BODY()

public:
    /** Called only by the token-gated UObject exposed to the embedded page. */
    void HandleBrowserBridgeReady(const FString& EntryToken);

protected:
    virtual TSharedRef<SWidget> RebuildWidget() override;
    virtual void NativeConstruct() override;
    virtual void NativeDestruct() override;

private:
    void BuildWidgetTree();
    void CreateBrowser();
    void DestroyBrowser();
    UTextBlock* CreateText(const FString& Value, int32 Size, const FLinearColor& Color);
    UButton* CreateMenuButton(const FString& Label, const FLinearColor& Accent);
    void OpenExperience(const FString& Url);
    void BeginNextRoomTransition(const FString& Url);
    void HandleTravelFinished();
    void HandleRoomTimeout();
    void ProbeBrowserReadiness();
    void RevealRoom();
    void FinishReturnToHub();
    void ClearTransitionTimers();

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

    UFUNCTION()
    void HandleBrowserUrlChanged(const FText& NewUrl);

    UPROPERTY(Transient)
    TObjectPtr<UOverlay> HubLayer;

    UPROPERTY(Transient)
    TObjectPtr<UOverlay> ExperienceLayer;

    UPROPERTY(Transient)
    TObjectPtr<UOverlay> TransitionLayer;

    UPROPERTY(Transient)
    TObjectPtr<UOverlay> BrowserHost;

    UPROPERTY(Transient)
    TObjectPtr<UOverlay> NavigationLayer;

    UPROPERTY(Transient)
    TObjectPtr<UBorder> TransitionShade;

    UPROPERTY(Transient)
    TObjectPtr<UAcademyWebBrowser> Browser;

    UPROPERTY(Transient)
    TObjectPtr<UAcademyBrowserBridge> BrowserBridge;

    UPROPERTY(Transient)
    TObjectPtr<UButton> NextRoomButton;

    UPROPERTY(Transient)
    TObjectPtr<UButton> CloseButton;

    UPROPERTY(Transient)
    TObjectPtr<UTextBlock> TransitionStatusText;

    UPROPERTY(Transient)
    TObjectPtr<UTextBlock> StatusText;

    EAcademyViewState ViewState = EAcademyViewState::Hub;
    FString PendingEntryToken;
    FString PendingRoomUrl;
    FString PendingEntryUrl;
    bool bTravelFinished = false;
    bool bRoomReady = false;
    bool bReducedMotion = false;
    int32 AutomationLoopsRemaining = 0;
    FTimerHandle TravelTimer;
    FTimerHandle RoomTimeoutTimer;
    FTimerHandle ReturnTimer;
    FTimerHandle AutomationTimer;
    FTimerHandle BrowserProbeTimer;
};
