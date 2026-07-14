#include "AcademyHUDWidget.h"

#include "AcademyBrowserBridge.h"
#include "AcademyGameInstanceSubsystem.h"
#include "AcademyWebBrowser.h"
#include "AcademyWorldDirector.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Border.h"
#include "Components/Button.h"
#include "Components/ButtonSlot.h"
#include "Components/Overlay.h"
#include "Components/OverlaySlot.h"
#include "Components/SizeBox.h"
#include "Components/TextBlock.h"
#include "Components/VerticalBox.h"
#include "Components/VerticalBoxSlot.h"
#include "EngineUtils.h"
#include "FestivusAcademy.h"
#include "Misc/CommandLine.h"
#include "Misc/Guid.h"
#include "Misc/Parse.h"
#include "TimerManager.h"

namespace
{
void FillOverlay(UOverlaySlot* Slot)
{
    if (!Slot) return;
    Slot->SetHorizontalAlignment(HAlign_Fill);
    Slot->SetVerticalAlignment(VAlign_Fill);
}

AAcademyWorldDirector* FindWorldDirector(const UWorld* World)
{
    if (!World) return nullptr;
    const TActorIterator<AAcademyWorldDirector> Director(World);
    return Director ? *Director : nullptr;
}
}

TSharedRef<SWidget> UAcademyHUDWidget::RebuildWidget()
{
    if (!WidgetTree)
    {
        Initialize();
    }

    if (WidgetTree && !WidgetTree->RootWidget)
    {
        BuildWidgetTree();
    }

    return Super::RebuildWidget();
}

void UAcademyHUDWidget::BuildWidgetTree()
{
    UE_LOG(LogFestivusAcademy, Display, TEXT("Academy native HUD building its UMG tree before Slate rebuild."));

    UOverlay* Root = WidgetTree->ConstructWidget<UOverlay>(UOverlay::StaticClass(), TEXT("AcademyRoot"));
    WidgetTree->RootWidget = Root;

    HubLayer = WidgetTree->ConstructWidget<UOverlay>(UOverlay::StaticClass(), TEXT("HubLayer"));
    FillOverlay(Root->AddChildToOverlay(HubLayer));

    UBorder* Dimmer = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("Dimmer"));
    Dimmer->SetBrushColor(FLinearColor(0.005f, 0.012f, 0.022f, 0.28f));
    FillOverlay(HubLayer->AddChildToOverlay(Dimmer));

    USizeBox* MenuWidth = WidgetTree->ConstructWidget<USizeBox>(USizeBox::StaticClass(), TEXT("MenuWidth"));
    MenuWidth->SetWidthOverride(640.0f);
    UOverlaySlot* MenuWidthSlot = HubLayer->AddChildToOverlay(MenuWidth);
    MenuWidthSlot->SetHorizontalAlignment(HAlign_Left);
    MenuWidthSlot->SetVerticalAlignment(VAlign_Center);
    MenuWidthSlot->SetPadding(FMargin(48.0f, 28.0f));

    UBorder* MenuBorder = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("MenuBorder"));
    MenuBorder->SetBrushColor(FLinearColor(0.012f, 0.026f, 0.045f, 0.91f));
    MenuBorder->SetPadding(FMargin(38.0f));
    MenuWidth->SetContent(MenuBorder);

    UVerticalBox* Menu = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), TEXT("AcademyMenu"));
    MenuBorder->SetContent(Menu);

    UTextBlock* Eyebrow = CreateText(TEXT("THE FEATS WERE ONLY THE ENTRANCE EXAM"), 16, FLinearColor(0.91f, 0.66f, 0.25f));
    Menu->AddChildToVerticalBox(Eyebrow)->SetPadding(FMargin(0, 0, 0, 10));

    UTextBlock* Title = CreateText(TEXT("JUSTIN'S\nDEVELOPER ACADEMY"), 43, FLinearColor(0.94f, 0.97f, 0.95f));
    Menu->AddChildToVerticalBox(Title)->SetPadding(FMargin(0, 0, 0, 12));

    UTextBlock* Description = CreateText(
        TEXT("Enter a technology room, repair a production system, and learn the decisions behind a multiplayer SaaS game."),
        20,
        FLinearColor(0.68f, 0.74f, 0.78f));
    Menu->AddChildToVerticalBox(Description)->SetPadding(FMargin(0, 0, 0, 24));

    UButton* TeaserButton = CreateMenuButton(TEXT("PLAY THE CINEMATIC TEASER"), FLinearColor(0.91f, 0.66f, 0.25f));
    TeaserButton->OnClicked.AddDynamic(this, &UAcademyHUDWidget::OpenTeaser);
    Menu->AddChildToVerticalBox(TeaserButton)->SetPadding(FMargin(0, 0, 0, 10));

    NextRoomButton = CreateMenuButton(TEXT("ROOM 01  ·  NEXT.JS + REACT + NODE  ·  ENTER"), FLinearColor(0.26f, 0.78f, 0.48f));
    NextRoomButton->OnClicked.AddDynamic(this, &UAcademyHUDWidget::OpenNextRoom);
    Menu->AddChildToVerticalBox(NextRoomButton)->SetPadding(FMargin(0, 0, 0, 8));

    UButton* SwiftButton = CreateMenuButton(TEXT("ROOM 02  ·  SWIFTUI  ·  LOCKED"), FLinearColor(0.43f, 0.72f, 1.0f));
    SwiftButton->SetIsEnabled(false);
    Menu->AddChildToVerticalBox(SwiftButton)->SetPadding(FMargin(0, 0, 0, 8));

    UButton* AndroidButton = CreateMenuButton(TEXT("ROOM 03  ·  ANDROID + KOTLIN  ·  LOCKED"), FLinearColor(0.64f, 0.84f, 0.37f));
    AndroidButton->SetIsEnabled(false);
    Menu->AddChildToVerticalBox(AndroidButton)->SetPadding(FMargin(0, 0, 0, 8));

    UButton* ExpoButton = CreateMenuButton(TEXT("ROOM 04  ·  EXPO  ·  LOCKED"), FLinearColor(0.78f, 0.71f, 1.0f));
    ExpoButton->SetIsEnabled(false);
    Menu->AddChildToVerticalBox(ExpoButton)->SetPadding(FMargin(0, 0, 0, 18));

    StatusText = CreateText(TEXT("CONNECTING TO CURRICULUM SERVICE…"), 14, FLinearColor(0.52f, 0.58f, 0.62f));
    Menu->AddChildToVerticalBox(StatusText);

    ExperienceLayer = WidgetTree->ConstructWidget<UOverlay>(UOverlay::StaticClass(), TEXT("ExperienceLayer"));
    ExperienceLayer->SetVisibility(ESlateVisibility::Collapsed);
    FillOverlay(Root->AddChildToOverlay(ExperienceLayer));

    BrowserBridge = NewObject<UAcademyBrowserBridge>(this, TEXT("AcademyBrowserBridge"));
    BrowserBridge->Initialize(this);
    BrowserHost = WidgetTree->ConstructWidget<UOverlay>(UOverlay::StaticClass(), TEXT("BrowserHost"));
    FillOverlay(ExperienceLayer->AddChildToOverlay(BrowserHost));
    CreateBrowser();

    TransitionLayer = WidgetTree->ConstructWidget<UOverlay>(UOverlay::StaticClass(), TEXT("TransitionLayer"));
    TransitionLayer->SetVisibility(ESlateVisibility::Collapsed);
    FillOverlay(Root->AddChildToOverlay(TransitionLayer));

    TransitionShade = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("TransitionShade"));
    TransitionShade->SetBrushColor(FLinearColor(0.002f, 0.012f, 0.018f, 0.62f));
    FillOverlay(TransitionLayer->AddChildToOverlay(TransitionShade));

    USizeBox* TransitionWidth = WidgetTree->ConstructWidget<USizeBox>(USizeBox::StaticClass(), TEXT("TransitionWidth"));
    TransitionWidth->SetWidthOverride(560.0f);
    UOverlaySlot* TransitionWidthSlot = TransitionLayer->AddChildToOverlay(TransitionWidth);
    TransitionWidthSlot->SetHorizontalAlignment(HAlign_Center);
    TransitionWidthSlot->SetVerticalAlignment(VAlign_Center);
    TransitionWidthSlot->SetPadding(FMargin(28.0f));

    UBorder* TransitionPanel = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("TransitionPanel"));
    TransitionPanel->SetBrushColor(FLinearColor(0.008f, 0.032f, 0.035f, 0.96f));
    TransitionPanel->SetPadding(FMargin(34.0f));
    TransitionWidth->SetContent(TransitionPanel);

    UVerticalBox* TransitionContent = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), TEXT("TransitionContent"));
    TransitionPanel->SetContent(TransitionContent);
    UTextBlock* TransitionEyebrow = CreateText(TEXT("ROOM 01  //  REACTOR GATE"), 14, FLinearColor(0.26f, 0.78f, 0.48f));
    TransitionEyebrow->SetJustification(ETextJustify::Center);
    TransitionContent->AddChildToVerticalBox(TransitionEyebrow)->SetPadding(FMargin(0, 0, 0, 12));
    UTextBlock* TransitionTitle = CreateText(TEXT("ENTERING NEXT.JS SYSTEMS"), 32, FLinearColor(0.94f, 0.97f, 0.95f));
    TransitionTitle->SetJustification(ETextJustify::Center);
    TransitionContent->AddChildToVerticalBox(TransitionTitle)->SetPadding(FMargin(0, 0, 0, 12));
    TransitionStatusText = CreateText(TEXT("CHARGING PORTAL  ·  ALIGNING REACTOR GATE"), 15, FLinearColor(0.67f, 0.76f, 0.78f));
    TransitionStatusText->SetJustification(ETextJustify::Center);
    TransitionContent->AddChildToVerticalBox(TransitionStatusText);

    NavigationLayer = WidgetTree->ConstructWidget<UOverlay>(UOverlay::StaticClass(), TEXT("NavigationLayer"));
    NavigationLayer->SetVisibility(ESlateVisibility::Collapsed);
    FillOverlay(Root->AddChildToOverlay(NavigationLayer));
    CloseButton = CreateMenuButton(TEXT("← RETURN TO ACADEMY HUB"), FLinearColor(0.91f, 0.66f, 0.25f));
    CloseButton->OnClicked.AddDynamic(this, &UAcademyHUDWidget::CloseExperience);
    UOverlaySlot* CloseSlot = NavigationLayer->AddChildToOverlay(CloseButton);
    CloseSlot->SetHorizontalAlignment(HAlign_Right);
    CloseSlot->SetVerticalAlignment(VAlign_Top);
    CloseSlot->SetPadding(FMargin(18.0f));
}

void UAcademyHUDWidget::CreateBrowser()
{
    if (Browser || !BrowserHost || !WidgetTree || !BrowserBridge)
    {
        return;
    }

    Browser = WidgetTree->ConstructWidget<UAcademyWebBrowser>(UAcademyWebBrowser::StaticClass());
    Browser->SetAcademyBridge(BrowserBridge);
    Browser->OnUrlChanged.AddUniqueDynamic(this, &UAcademyHUDWidget::HandleBrowserUrlChanged);
    FillOverlay(BrowserHost->AddChildToOverlay(Browser));
}

void UAcademyHUDWidget::DestroyBrowser()
{
    if (!Browser)
    {
        return;
    }

    Browser->OnUrlChanged.RemoveDynamic(this, &UAcademyHUDWidget::HandleBrowserUrlChanged);
    if (BrowserHost)
    {
        BrowserHost->RemoveChild(Browser);
    }
    Browser->ShutdownBrowser();
    Browser = nullptr;
    UE_LOG(LogFestivusAcademy, Display, TEXT("Academy browser resources released."));
}

void UAcademyHUDWidget::NativeConstruct()
{
    Super::NativeConstruct();
    UE_LOG(LogFestivusAcademy, Display, TEXT("Academy native HUD attached to Slate and ready for input."));
    SetIsFocusable(true);
    bReducedMotion = FParse::Param(FCommandLine::Get(), TEXT("AcademyReducedMotion"));
    if (NextRoomButton)
    {
        NextRoomButton->SetKeyboardFocus();
    }

    if (UAcademyGameInstanceSubsystem* Academy = GetGameInstance()->GetSubsystem<UAcademyGameInstanceSubsystem>())
    {
        Academy->OnCatalogLoaded.AddDynamic(this, &UAcademyHUDWidget::HandleCatalogLoaded);
        if (Academy->GetRooms().Num() > 0)
        {
            HandleCatalogLoaded(true);
        }
    }

    if (FParse::Param(FCommandLine::Get(), TEXT("AcademyAutoEnter")) && GetWorld())
    {
        int32 RequestedLoops = 1;
        FParse::Value(FCommandLine::Get(), TEXT("AcademyAutoLoops="), RequestedLoops);
        AutomationLoopsRemaining = FMath::Clamp(RequestedLoops, 1, 3);
        GetWorld()->GetTimerManager().SetTimer(
            AutomationTimer,
            this,
            &UAcademyHUDWidget::OpenNextRoom,
            1.0f,
            false);
    }
}

void UAcademyHUDWidget::NativeDestruct()
{
    ClearTransitionTimers();
    DestroyBrowser();
    if (GetGameInstance())
    {
        if (UAcademyGameInstanceSubsystem* Academy = GetGameInstance()->GetSubsystem<UAcademyGameInstanceSubsystem>())
        {
            Academy->OnCatalogLoaded.RemoveDynamic(this, &UAcademyHUDWidget::HandleCatalogLoaded);
        }
    }
    Super::NativeDestruct();
}

UTextBlock* UAcademyHUDWidget::CreateText(const FString& Value, int32 Size, const FLinearColor& Color)
{
    UTextBlock* Text = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass());
    Text->SetText(FText::FromString(Value));
    Text->SetColorAndOpacity(FSlateColor(Color));
    Text->SetAutoWrapText(true);
    FSlateFontInfo Font = Text->GetFont();
    Font.Size = Size;
    Text->SetFont(Font);
    return Text;
}

UButton* UAcademyHUDWidget::CreateMenuButton(const FString& Label, const FLinearColor& Accent)
{
    UButton* Button = WidgetTree->ConstructWidget<UButton>(UButton::StaticClass());
    Button->SetBackgroundColor(FLinearColor(Accent.R * 0.18f, Accent.G * 0.18f, Accent.B * 0.18f, 0.98f));
    Button->SetToolTipText(FText::FromString(Label));
    UTextBlock* Text = CreateText(Label, 16, Accent);
    Text->SetJustification(ETextJustify::Center);
    Button->SetContent(Text);
    if (UButtonSlot* ButtonSlot = Cast<UButtonSlot>(Text->Slot))
    {
        ButtonSlot->SetPadding(FMargin(18.0f, 13.0f));
        ButtonSlot->SetHorizontalAlignment(HAlign_Fill);
        ButtonSlot->SetVerticalAlignment(VAlign_Center);
    }
    return Button;
}

void UAcademyHUDWidget::OpenExperience(const FString& Url)
{
    CreateBrowser();
    if (!Browser || !ExperienceLayer || ViewState != EAcademyViewState::Hub) return;
    ViewState = EAcademyViewState::InRoom;
    if (HubLayer) HubLayer->SetVisibility(ESlateVisibility::Collapsed);
    if (TransitionLayer) TransitionLayer->SetVisibility(ESlateVisibility::Collapsed);
    Browser->SetRenderOpacity(1.0f);
    Browser->SetIsEnabled(true);
    if (CloseButton) CloseButton->SetVisibility(ESlateVisibility::Visible);
    if (NavigationLayer) NavigationLayer->SetVisibility(ESlateVisibility::Visible);
    Browser->LoadURL(Url);
    ExperienceLayer->SetVisibility(ESlateVisibility::Visible);
}

void UAcademyHUDWidget::BeginNextRoomTransition(const FString& Url)
{
    CreateBrowser();
    if (!Browser || !ExperienceLayer || !TransitionLayer || ViewState != EAcademyViewState::Hub)
    {
        return;
    }

    ClearTransitionTimers();
    ViewState = EAcademyViewState::Traveling;
    bTravelFinished = bReducedMotion;
    bRoomReady = false;
    PendingEntryToken = FGuid::NewGuid().ToString(EGuidFormats::Digits);
    PendingRoomUrl = Url;
    const FString Separator = Url.Contains(TEXT("?")) ? TEXT("&") : TEXT("?");
    PendingEntryUrl = Url + Separator + TEXT("entry=") + PendingEntryToken;

    if (HubLayer) HubLayer->SetVisibility(ESlateVisibility::Collapsed);
    ExperienceLayer->SetVisibility(ESlateVisibility::Collapsed);
    Browser->SetRenderOpacity(1.0f);
    Browser->SetIsEnabled(false);
    if (CloseButton) CloseButton->SetVisibility(ESlateVisibility::Collapsed);
    if (NavigationLayer) NavigationLayer->SetVisibility(ESlateVisibility::Collapsed);
    TransitionLayer->SetVisibility(ESlateVisibility::Visible);
    TransitionLayer->SetRenderOpacity(1.0f);
    if (TransitionShade)
    {
        TransitionShade->SetBrushColor(FLinearColor(0.002f, 0.012f, 0.018f, 0.62f));
    }
    if (TransitionStatusText)
    {
        TransitionStatusText->SetText(FText::FromString(
            bReducedMotion
                ? TEXT("ALIGNING REACTOR GATE  ·  REDUCED MOTION")
                : TEXT("CHARGING PORTAL  ·  ALIGNING REACTOR GATE")));
    }

    if (AAcademyWorldDirector* Director = FindWorldDirector(GetWorld()))
    {
        Director->SetReducedMotionEnabled(bReducedMotion);
        Director->FocusPortal(0);
    }

    if (bTravelFinished)
    {
        HandleTravelFinished();
    }
    else if (GetWorld())
    {
        GetWorld()->GetTimerManager().SetTimer(
            TravelTimer,
            this,
            &UAcademyHUDWidget::HandleTravelFinished,
            1.2f,
            false);
    }

    UE_LOG(LogFestivusAcademy, Display, TEXT("Academy portal entry started for %s."), *PendingRoomUrl);
}

void UAcademyHUDWidget::OpenTeaser()
{
    if (UAcademyGameInstanceSubsystem* Academy = GetGameInstance()->GetSubsystem<UAcademyGameInstanceSubsystem>())
        OpenExperience(Academy->GetTeaserUrl());
}

void UAcademyHUDWidget::OpenNextRoom()
{
    if (UAcademyGameInstanceSubsystem* Academy = GetGameInstance()->GetSubsystem<UAcademyGameInstanceSubsystem>())
        BeginNextRoomTransition(Academy->GetRoomUrl(TEXT("nextjs-react-node")));
}

void UAcademyHUDWidget::OpenSwiftUIRoom()
{
    if (UAcademyGameInstanceSubsystem* Academy = GetGameInstance()->GetSubsystem<UAcademyGameInstanceSubsystem>())
        OpenExperience(Academy->GetRoomUrl(TEXT("swiftui")));
}

void UAcademyHUDWidget::OpenAndroidRoom()
{
    if (UAcademyGameInstanceSubsystem* Academy = GetGameInstance()->GetSubsystem<UAcademyGameInstanceSubsystem>())
        OpenExperience(Academy->GetRoomUrl(TEXT("android-kotlin")));
}

void UAcademyHUDWidget::OpenExpoRoom()
{
    if (UAcademyGameInstanceSubsystem* Academy = GetGameInstance()->GetSubsystem<UAcademyGameInstanceSubsystem>())
        OpenExperience(Academy->GetRoomUrl(TEXT("expo")));
}

void UAcademyHUDWidget::CloseExperience()
{
    if (!Browser || !ExperienceLayer || !TransitionLayer ||
        (ViewState != EAcademyViewState::InRoom && ViewState != EAcademyViewState::Failed))
    {
        return;
    }

    ClearTransitionTimers();
    ViewState = EAcademyViewState::Returning;
    PendingEntryToken.Reset();
    PendingRoomUrl.Reset();
    PendingEntryUrl.Reset();
    Browser->SetIsEnabled(false);
    Browser->SetRenderOpacity(1.0f);
    if (CloseButton) CloseButton->SetVisibility(ESlateVisibility::Collapsed);
    if (NavigationLayer) NavigationLayer->SetVisibility(ESlateVisibility::Collapsed);
    TransitionLayer->SetVisibility(ESlateVisibility::Visible);
    TransitionLayer->SetRenderOpacity(1.0f);
    if (TransitionShade)
    {
        TransitionShade->SetBrushColor(FLinearColor(0.002f, 0.012f, 0.018f, 0.98f));
    }
    if (TransitionStatusText)
    {
        TransitionStatusText->SetText(FText::FromString(TEXT("CLOSING ROOM SYSTEMS  ·  RETURNING TO ATRIUM")));
    }

    // Keep the browser in the Slate tree long enough for WKWebView to process
    // the queued navigation and release the room's timers, sockets, and media.
    Browser->LoadURL(TEXT("about:blank"));
    UE_LOG(LogFestivusAcademy, Display,
        TEXT("Academy room shutdown started; browser navigating to about:blank."));
    if (AAcademyWorldDirector* Director = FindWorldDirector(GetWorld()))
    {
        Director->ReturnToOverview();
    }

    if (GetWorld())
    {
        GetWorld()->GetTimerManager().SetTimer(
            ReturnTimer,
            this,
            &UAcademyHUDWidget::FinishReturnToHub,
            bReducedMotion ? 0.12f : 0.9f,
            false);
    }
}

void UAcademyHUDWidget::HandleBrowserBridgeReady(const FString& EntryToken)
{
    if ((ViewState != EAcademyViewState::Traveling && ViewState != EAcademyViewState::WaitingForRoom &&
         ViewState != EAcademyViewState::Failed) ||
        EntryToken.IsEmpty() || EntryToken != PendingEntryToken || !Browser)
    {
        return;
    }

    const FString CurrentUrl = Browser->GetUrl();
    FString CurrentDocumentUrl = CurrentUrl;
    int32 FragmentIndex = INDEX_NONE;
    if (CurrentDocumentUrl.FindChar(TEXT('#'), FragmentIndex))
    {
        CurrentDocumentUrl.LeftInline(FragmentIndex);
    }
    if (CurrentDocumentUrl != PendingEntryUrl)
    {
        UE_LOG(LogFestivusAcademy, Warning,
            TEXT("Academy ignored a readiness signal from an unexpected page: %s"),
            *CurrentUrl);
        return;
    }

    bRoomReady = true;
    UE_LOG(LogFestivusAcademy, Display, TEXT("Academy embedded room reported hydrated and painted."));
    if (bTravelFinished)
    {
        RevealRoom();
    }
}

void UAcademyHUDWidget::HandleBrowserUrlChanged(const FText& NewUrl)
{
    if ((ViewState != EAcademyViewState::Traveling && ViewState != EAcademyViewState::WaitingForRoom &&
         ViewState != EAcademyViewState::Failed) ||
        PendingEntryToken.IsEmpty())
    {
        return;
    }

    const FString ReadyFragment = TEXT("#academy-ready-") + PendingEntryToken;
    if (NewUrl.ToString().EndsWith(ReadyFragment))
    {
        UE_LOG(LogFestivusAcademy, Display, TEXT("Academy embedded room readiness hash received."));
        HandleBrowserBridgeReady(PendingEntryToken);
    }
}

void UAcademyHUDWidget::HandleTravelFinished()
{
    if (ViewState != EAcademyViewState::Traveling)
    {
        return;
    }

    bTravelFinished = true;
    ViewState = EAcademyViewState::WaitingForRoom;
    if (ExperienceLayer) ExperienceLayer->SetVisibility(ESlateVisibility::Visible);
    if (TransitionShade)
    {
        TransitionShade->SetBrushColor(FLinearColor(0.002f, 0.012f, 0.018f, 0.98f));
    }
    if (Browser && !PendingEntryUrl.IsEmpty())
    {
        Browser->SetRenderOpacity(1.0f);
        Browser->LoadURL(PendingEntryUrl);
    }
    if (TransitionStatusText)
    {
        TransitionStatusText->SetText(FText::FromString(
            bRoomReady
                ? TEXT("MISSION SYSTEMS READY  ·  OPENING ROOM")
                : TEXT("PORTAL LOCKED  ·  SYNCING MISSION SYSTEMS")));
    }
    if (bRoomReady)
    {
        RevealRoom();
    }
    else if (GetWorld())
    {
        GetWorld()->GetTimerManager().SetTimer(
            BrowserProbeTimer,
            this,
            &UAcademyHUDWidget::ProbeBrowserReadiness,
            0.25f,
            true,
            0.5f);
        GetWorld()->GetTimerManager().SetTimer(
            RoomTimeoutTimer,
            this,
            &UAcademyHUDWidget::HandleRoomTimeout,
            8.0f,
            false);
    }
}

void UAcademyHUDWidget::ProbeBrowserReadiness()
{
    if (!Browser || PendingEntryToken.IsEmpty() ||
        (ViewState != EAcademyViewState::WaitingForRoom && ViewState != EAcademyViewState::Failed))
    {
        return;
    }

    const FString Script = FString::Printf(
        TEXT("(()=>{const r=document.querySelector('[data-academy-hydrated=\"true\"]');")
        TEXT("const b=window.ue&&window.ue.academybridge;")
        TEXT("if(r&&b&&typeof b.ready==='function'){b.ready('%s');}})();"),
        *PendingEntryToken);
    Browser->ExecuteJavascript(Script);
}

void UAcademyHUDWidget::HandleRoomTimeout()
{
    if (ViewState != EAcademyViewState::Traveling && ViewState != EAcademyViewState::WaitingForRoom)
    {
        return;
    }

    ViewState = EAcademyViewState::Failed;
    bTravelFinished = true;
    if (GetWorld())
    {
        GetWorld()->GetTimerManager().ClearTimer(RoomTimeoutTimer);
    }
    if (Browser) Browser->SetIsEnabled(false);
    if (TransitionLayer)
    {
        TransitionLayer->SetVisibility(ESlateVisibility::Visible);
        TransitionLayer->SetRenderOpacity(1.0f);
    }
    if (TransitionShade)
    {
        TransitionShade->SetBrushColor(FLinearColor(0.002f, 0.012f, 0.018f, 0.98f));
    }
    if (TransitionStatusText)
    {
        TransitionStatusText->SetText(FText::FromString(
            TEXT("ROOM LINK DELAYED  ·  START THE WEB SERVICE OR RETURN TO HUB")));
    }
    if (CloseButton)
    {
        CloseButton->SetVisibility(ESlateVisibility::Visible);
        CloseButton->SetKeyboardFocus();
    }
    if (NavigationLayer) NavigationLayer->SetVisibility(ESlateVisibility::Visible);
    UE_LOG(LogFestivusAcademy, Warning,
        TEXT("Academy room readiness timed out at %s; keeping the safety cover while late recovery remains active."),
        Browser ? *Browser->GetUrl() : TEXT("no browser"));
}

void UAcademyHUDWidget::RevealRoom()
{
    if (!Browser || !ExperienceLayer || !TransitionLayer ||
        (ViewState != EAcademyViewState::Traveling && ViewState != EAcademyViewState::WaitingForRoom &&
         ViewState != EAcademyViewState::Failed))
    {
        return;
    }

    ClearTransitionTimers();
    ViewState = EAcademyViewState::InRoom;
    Browser->SetRenderOpacity(1.0f);
    Browser->SetIsEnabled(true);
    if (CloseButton) CloseButton->SetVisibility(ESlateVisibility::Visible);
    if (NavigationLayer) NavigationLayer->SetVisibility(ESlateVisibility::Visible);
    TransitionLayer->SetRenderOpacity(0.0f);
    TransitionLayer->SetVisibility(ESlateVisibility::HitTestInvisible);
    TransitionLayer->InvalidateLayoutAndVolatility();
    Browser->SetKeyboardFocus();

    if (FParse::Param(FCommandLine::Get(), TEXT("AcademyAutoReturn")) && GetWorld())
    {
        GetWorld()->GetTimerManager().SetTimer(
            AutomationTimer,
            this,
            &UAcademyHUDWidget::CloseExperience,
            2.0f,
            false);
    }
}

void UAcademyHUDWidget::FinishReturnToHub()
{
    if (ViewState != EAcademyViewState::Returning)
    {
        return;
    }

    ViewState = EAcademyViewState::Hub;
    DestroyBrowser();
    if (ExperienceLayer) ExperienceLayer->SetVisibility(ESlateVisibility::Collapsed);
    if (TransitionLayer)
    {
        TransitionLayer->SetVisibility(ESlateVisibility::Collapsed);
        TransitionLayer->SetRenderOpacity(1.0f);
    }
    if (HubLayer) HubLayer->SetVisibility(ESlateVisibility::Visible);
    if (NavigationLayer) NavigationLayer->SetVisibility(ESlateVisibility::Collapsed);
    if (NextRoomButton) NextRoomButton->SetKeyboardFocus();
    UE_LOG(LogFestivusAcademy, Display, TEXT("Academy return complete; atrium input restored."));

    if (FParse::Param(FCommandLine::Get(), TEXT("AcademyAutoEnter")) &&
        FParse::Param(FCommandLine::Get(), TEXT("AcademyAutoReturn")) &&
        AutomationLoopsRemaining > 1 && GetWorld())
    {
        --AutomationLoopsRemaining;
        GetWorld()->GetTimerManager().SetTimer(
            AutomationTimer,
            this,
            &UAcademyHUDWidget::OpenNextRoom,
            0.8f,
            false);
    }
    else
    {
        AutomationLoopsRemaining = 0;
    }
}

void UAcademyHUDWidget::ClearTransitionTimers()
{
    if (!GetWorld()) return;
    FTimerManager& Timers = GetWorld()->GetTimerManager();
    Timers.ClearTimer(TravelTimer);
    Timers.ClearTimer(RoomTimeoutTimer);
    Timers.ClearTimer(ReturnTimer);
    Timers.ClearTimer(AutomationTimer);
    Timers.ClearTimer(BrowserProbeTimer);
}

void UAcademyHUDWidget::HandleCatalogLoaded(bool bSucceeded)
{
    if (!StatusText) return;
    if (bSucceeded)
    {
        const UAcademyGameInstanceSubsystem* Academy = GetGameInstance()->GetSubsystem<UAcademyGameInstanceSubsystem>();
        const int32 RoomCount = Academy ? Academy->GetRooms().Num() : 0;
        StatusText->SetText(FText::FromString(FString::Printf(TEXT("CURRICULUM ONLINE  ·  %d ROOMS  ·  WEB-DELIVERED"), RoomCount)));
        StatusText->SetColorAndOpacity(FSlateColor(FLinearColor(0.26f, 0.78f, 0.48f)));
    }
    else
    {
        StatusText->SetText(FText::FromString(TEXT("CURRICULUM SERVICE OFFLINE  ·  START PNPM DEV  ·  ROOM LINKS STILL AVAILABLE")));
        StatusText->SetColorAndOpacity(FSlateColor(FLinearColor(0.91f, 0.66f, 0.25f)));
    }
}
